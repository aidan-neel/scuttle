import type { Database } from "bun:sqlite";
import type { CompactThreadResult, Thread, ThreadTurn } from "@scuttle/contracts";
import { listMemories, readAgentByPrimaryThreadId } from "./agent/agentStore.ts";
import { listDelegations, listIssues } from "./agent/agentWorkStore.ts";
import { readThreadById, readTurnsForThread } from "./threadStore.ts";

const MAX_SUMMARY_CHARS = 8_000;
const MAX_TURNS_IN_HANDOFF = 12;

const singleLine = (text: string, maxChars: number): string => {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 3)}...`;
};

const truncateBlock = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;

export const buildCompactionSummary = (input: {
  readonly db: Database;
  readonly thread: Thread;
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly focus?: string;
}): string => {
  const { db, thread, turns, focus } = input;
  const currentEpoch = thread.sessionEpoch ?? 0;
  const epochTurns = turns.filter((t) => (t.sessionEpoch ?? 0) === currentEpoch);
  const recentTurns = epochTurns.slice(-MAX_TURNS_IN_HANDOFF);

  const sections: string[] = [
    `Session handoff (epoch ${currentEpoch} -> ${currentEpoch + 1})`,
    `Thread: ${thread.title} (${thread.projectName}, branch ${thread.branch}, runtime ${thread.runtime})`,
  ];

  if (focus && focus.trim().length > 0) {
    sections.push(`Focus: ${singleLine(focus, 400)}`);
  }

  if (thread.activeSummary && thread.activeSummary.trim().length > 0) {
    sections.push("", "Prior Handoff:", truncateBlock(thread.activeSummary.trim(), 1_400));
  }

  if (recentTurns.length > 0) {
    sections.push("", `Recent Turns (${epochTurns.length} in epoch ${currentEpoch}):`);
    for (const turn of recentTurns) {
      sections.push(`- User: ${singleLine(turn.userMessage, 240)}`);
      if (turn.assistantMessage.trim().length > 0) {
        sections.push(`  Assistant: ${singleLine(turn.assistantMessage, 320)}`);
      } else if (turn.error) {
        sections.push(`  Error (${turn.status}): ${singleLine(turn.error, 200)}`);
      }
      if (turn.activities.length > 0) {
        const labels = turn.activities.slice(-5).map((a) => a.label);
        sections.push(`  Tools: ${labels.join(", ")}`);
      }
    }
  } else {
    sections.push("", `Recent Turns: (none in epoch ${currentEpoch})`);
  }

  const agent = readAgentByPrimaryThreadId(db, thread.id);
  if (agent) {
    const pinnedMemories = listMemories(db, agent.id, 50)
      .filter((m) => m.pinned)
      .slice(0, 6);
    if (pinnedMemories.length > 0) {
      sections.push("", "Pinned Memories:");
      for (const mem of pinnedMemories) {
        sections.push(`- [${mem.category}] ${mem.title}: ${singleLine(mem.content, 200)}`);
      }
    }

    const relevantDelegations = listDelegations(db, agent.id, 30).filter(
      (d) => d.status === "running" || d.parentNotifiedAt === undefined,
    );
    if (relevantDelegations.length > 0) {
      sections.push("", "Active & Unnotified Delegations:");
      for (const d of relevantDelegations.slice(0, 10)) {
        const pr = d.prUrl ? ` (${d.prUrl})` : "";
        const summary = d.resultSummary ? ` — ${singleLine(d.resultSummary, 160)}` : "";
        sections.push(`- [${d.status}] ${d.title}${pr}${summary}`);
      }
    }

    const openIssues = listIssues(db, agent.id)
      .filter((i) => i.state !== "done" && i.state !== "canceled")
      .slice(0, 10);
    if (openIssues.length > 0) {
      sections.push("", "Open Issues:");
      for (const issue of openIssues) {
        const pr = issue.prUrl ? ` (${issue.prUrl})` : "";
        sections.push(`- [${issue.state}] ${issue.key}: ${issue.title}${pr}`);
      }
    }
  }

  return truncateBlock(sections.join("\n"), MAX_SUMMARY_CHARS);
};

export const rolloverThreadSession = (input: {
  readonly db: Database;
  readonly thread: Thread;
  readonly focus?: string;
  readonly forceSummary?: boolean;
}): CompactThreadResult => {
  const { db, thread, focus, forceSummary = false } = input;
  const currentEpoch = thread.sessionEpoch ?? 0;
  const turns = readTurnsForThread(db, thread);
  const currentEpochTurns = turns.filter((t) => (t.sessionEpoch ?? 0) === currentEpoch);

  const summary =
    currentEpochTurns.length > 0 || forceSummary
      ? buildCompactionSummary({ db, thread, turns, ...(focus ? { focus } : {}) })
      : (thread.activeSummary ?? "");

  const nextEpoch = currentEpoch + 1;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE threads
     SET session_epoch = ?,
         active_summary = ?,
         provider_session_id = NULL,
         last_context_hash = NULL,
         last_usage_json = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(nextEpoch, summary.length > 0 ? summary : null, now, thread.id);

  const updated = readThreadById(db, thread.id) ?? {
    ...thread,
    sessionEpoch: nextEpoch,
    ...(summary.length > 0 ? { activeSummary: summary } : {}),
    updatedAt: now,
  };

  return {
    thread: updated,
    summary,
    sessionEpoch: nextEpoch,
  };
};

export const maybeRolloverThreadSession = (input: {
  readonly db: Database;
  readonly thread: Thread;
  readonly shouldRollover: boolean;
}): { readonly thread: Thread; readonly rolledOver: boolean } => {
  if (!input.shouldRollover) return { thread: input.thread, rolledOver: false };
  const turns = readTurnsForThread(input.db, input.thread);
  const hasSessionWithTurns = turns.length > 0 || input.thread.providerSessionId !== undefined;
  if (!hasSessionWithTurns) return { thread: input.thread, rolledOver: false };
  const result = rolloverThreadSession({ db: input.db, thread: input.thread });
  return { thread: result.thread, rolledOver: true };
};

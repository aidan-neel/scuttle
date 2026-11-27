import type { Database } from "bun:sqlite";
import type { CompactThreadResult, Thread, ThreadTurn } from "@scuttle/contracts";
import { listMemories, readAgentByPrimaryThreadId } from "./agent/agentStore.ts";
import { listDelegations, listIssues } from "./agent/agentWorkStore.ts";
import { readThreadById, readTurnsForThread } from "./threadStore.ts";

const MAX_SUMMARY_CHARS = 8_000;
const MAX_TURNS_IN_HANDOFF = 12;
const PRIOR_HANDOFF_BUDGET = 1_200;
const MEMORIES_BUDGET = 1_200;
const DELEGATIONS_BUDGET = 1_100;
const ISSUES_BUDGET = 1_100;

const singleLine = (text: string, maxChars: number): string => {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 3)}...`;
};

const truncateBlock = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;

const formatSectionWithBudget = (
  heading: string,
  lines: ReadonlyArray<string>,
  maxChars: number,
): string => {
  if (lines.length === 0) return "";
  const kept: string[] = [heading];
  let used = heading.length;
  for (const line of lines) {
    const nextLen = used + 1 + line.length;
    if (nextLen <= maxChars) {
      kept.push(line);
      used = nextLen;
      continue;
    }
    if (kept.length === 1) {
      const remaining = Math.max(40, maxChars - used - 1);
      kept.push(truncateBlock(line, remaining));
    }
    break;
  }
  return kept.join("\n");
};

const formatTurnBlock = (turn: ThreadTurn): string => {
  const lines = [`- User: ${singleLine(turn.userMessage, 240)}`];
  if (turn.assistantMessage.trim().length > 0) {
    lines.push(`  Assistant: ${singleLine(turn.assistantMessage, 320)}`);
  } else if (turn.error) {
    lines.push(`  Error (${turn.status}): ${singleLine(turn.error, 200)}`);
  }
  if (turn.activities.length > 0) {
    const labels = turn.activities.slice(-5).map((a) => a.label);
    lines.push(`  Tools: ${labels.join(", ")}`);
  }
  return lines.join("\n");
};

const formatRecentTurnsSection = (
  epochTurns: ReadonlyArray<ThreadTurn>,
  currentEpoch: number,
  budget: number,
): string => {
  if (epochTurns.length === 0) {
    return `Recent Turns: (none in epoch ${currentEpoch})`;
  }
  const heading = `Recent Turns (${epochTurns.length} in epoch ${currentEpoch}):`;
  const candidates = epochTurns.slice(-MAX_TURNS_IN_HANDOFF);
  const kept: string[] = [];
  let used = heading.length;

  for (let idx = candidates.length - 1; idx >= 0; idx -= 1) {
    const block = formatTurnBlock(candidates[idx]!);
    const nextLen = used + 1 + block.length;
    if (nextLen <= budget) {
      kept.unshift(block);
      used = nextLen;
      continue;
    }
    if (kept.length === 0) {
      const remaining = Math.max(120, budget - heading.length - 1);
      kept.unshift(truncateBlock(block, remaining));
    }
    break;
  }
  return `${heading}\n${kept.join("\n")}`;
};

const preserveExistingSummary = (existingSummary: string, focus?: string): string => {
  const trimmedFocus = focus ? singleLine(focus, 400) : "";
  if (trimmedFocus.length === 0) return existingSummary;
  const focusLine = `Focus: ${trimmedFocus}`;
  if (existingSummary.includes(focusLine)) return existingSummary;
  const lines = existingSummary.split("\n");
  const focusIdx = lines.findIndex((line) => line.startsWith("Focus: "));
  if (focusIdx !== -1) {
    lines[focusIdx] = focusLine;
    return lines.join("\n");
  }
  const threadIdx = lines.findIndex((line) => line.startsWith("Thread: "));
  if (threadIdx !== -1) {
    lines.splice(threadIdx + 1, 0, focusLine);
    return lines.join("\n");
  }
  return `${focusLine}\n${existingSummary}`;
};

export const buildCompactionSummary = (input: {
  readonly db: Database;
  readonly thread: Thread;
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly focus?: string;
}): string => {
  const { db, thread, turns, focus } = input;
  const currentEpoch = thread.sessionEpoch ?? 0;
  const epochTurns = turns.filter((t) => (t.sessionEpoch ?? 0) === currentEpoch);

  const headerLines = [
    `Session handoff (epoch ${currentEpoch} -> ${currentEpoch + 1})`,
    `Thread: ${singleLine(thread.title, 120)} (${singleLine(thread.projectName, 60)}, branch ${singleLine(thread.branch, 80)}, runtime ${thread.runtime})`,
  ];
  if (focus && focus.trim().length > 0) {
    headerLines.push(`Focus: ${singleLine(focus, 400)}`);
  }
  const headerSection = headerLines.join("\n");

  const priorHandoffSection =
    thread.activeSummary && thread.activeSummary.trim().length > 0
      ? `Prior Handoff:\n${truncateBlock(thread.activeSummary.trim(), PRIOR_HANDOFF_BUDGET - "Prior Handoff:\n".length)}`
      : "";

  let memoriesSection = "";
  let delegationsSection = "";
  let issuesSection = "";

  const agent = readAgentByPrimaryThreadId(db, thread.id);
  if (agent) {
    const pinnedMemories = listMemories(db, agent.id, 50)
      .filter((m) => m.pinned)
      .slice(0, 6);
    memoriesSection = formatSectionWithBudget(
      "Pinned Memories:",
      pinnedMemories.map(
        (mem) => `- [${mem.category}] ${mem.title}: ${singleLine(mem.content, 200)}`,
      ),
      MEMORIES_BUDGET,
    );

    const relevantDelegations = listDelegations(db, agent.id, 30)
      .filter(
        (d) =>
          d.status === "running" ||
          d.status === "waiting_parent" ||
          d.parentNotifiedAt === undefined,
      )
      .slice(0, 10);
    delegationsSection = formatSectionWithBudget(
      "Active & Unnotified Delegations:",
      relevantDelegations.map((d) => {
        const pr = d.prUrl ? ` (${d.prUrl})` : "";
        const summary = d.resultSummary ? ` — ${singleLine(d.resultSummary, 160)}` : "";
        return `- [${d.status}] ${d.title}${pr}${summary}`;
      }),
      DELEGATIONS_BUDGET,
    );

    const openIssues = listIssues(db, agent.id)
      .filter((i) => i.state !== "done" && i.state !== "canceled")
      .slice(0, 10);
    issuesSection = formatSectionWithBudget(
      "Open Issues:",
      openIssues.map((issue) => {
        const pr = issue.prUrl ? ` (${issue.prUrl})` : "";
        return `- [${issue.state}] ${issue.key}: ${issue.title}${pr}`;
      }),
      ISSUES_BUDGET,
    );
  }

  const fixedSections = [
    headerSection,
    priorHandoffSection,
    memoriesSection,
    delegationsSection,
    issuesSection,
  ].filter((s) => s.length > 0);
  const fixedChars = fixedSections.reduce((sum, s) => sum + s.length, 0) + fixedSections.length * 2;
  const turnsBudget = Math.max(800, MAX_SUMMARY_CHARS - fixedChars);
  const turnsSection = formatRecentTurnsSection(epochTurns, currentEpoch, turnsBudget);

  const combined = [
    headerSection,
    priorHandoffSection,
    turnsSection,
    memoriesSection,
    delegationsSection,
    issuesSection,
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  return truncateBlock(combined, MAX_SUMMARY_CHARS);
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
  const existingSummary = thread.activeSummary?.trim() ?? "";

  let summary: string;
  if (currentEpochTurns.length > 0) {
    summary = buildCompactionSummary({ db, thread, turns, ...(focus ? { focus } : {}) });
  } else if (existingSummary.length > 0) {
    summary = preserveExistingSummary(thread.activeSummary!, focus);
  } else if (forceSummary) {
    summary = buildCompactionSummary({ db, thread, turns, ...(focus ? { focus } : {}) });
  } else {
    summary = "";
  }

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

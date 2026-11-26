import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentDelegation,
  AgentMemory,
  AgentModelRole,
  Thread,
} from "@scuttle/contracts";
import type * as EventBus from "../EventBus.ts";
import {
  listMemories,
  readAgentByPrimaryThreadId,
  recordMemoryAccess,
  searchMemories,
} from "./agentStore.ts";
import {
  listDelegations,
  listIssues,
  listUnnotifiedSettledDelegations,
  markDelegationsParentNotified,
  readActiveDelegationByChildThread,
  readAgentIdForThread,
  readDelegationById,
} from "./agentWorkStore.ts";
import {
  hasCompletedTurnInEpoch,
  readThreadContextHash,
  updateThreadContextHash,
} from "../threadStore.ts";

const ROLES: ReadonlyArray<AgentModelRole> = [
  "agent",
  "workhorse",
  "design",
  "review",
  "fast",
  "large",
];

const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;

const formatModelStack = (agent: Agent): string => {
  const lines = ROLES.map((role) => {
    const sel = agent.modelStack[role];
    if (!sel) return null;
    return `- ${role}: ${sel.providerKind}/${sel.model}${sel.effort ? ` (${sel.effort})` : ""}`;
  }).filter((line): line is string => line !== null);
  if (lines.length === 0) {
    const d = agent.modelSelection;
    return `- default: ${d.providerKind}/${d.model}${d.effort ? ` (${d.effort})` : ""}`;
  }
  return lines.join("\n");
};

const selectPinnedMemories = (db: Database, agentId: string): ReadonlyArray<AgentMemory> =>
  listMemories(db, agentId, 50)
    .filter((m) => m.pinned)
    .slice(0, 6);

const formatMemoryLines = (memories: ReadonlyArray<AgentMemory>): string =>
  memories.length > 0
    ? memories
        .map(
          (m) =>
            `- [${m.category}${m.pinned ? ", pinned" : ""}] (${m.id}) ${m.title}: ${truncate(m.content, 240)}`,
        )
        .join("\n")
    : "(none yet)";

const buildStableContextWithIds = (input: {
  readonly db: Database;
  readonly agent: Agent;
  readonly apiBaseUrl: string;
}): { readonly text: string; readonly memoryIds: ReadonlyArray<string> } => {
  const { db, agent, apiBaseUrl } = input;
  const pinnedMemories = selectPinnedMemories(db, agent.id);
  const purposeLine =
    agent.purpose.trim().length > 0
      ? truncate(agent.purpose, 400)
      : "(not set yet — once the user tells you your purpose, save it via PATCH)";
  const agentBase = `${apiBaseUrl}/api/agents/${agent.id}`;

  const text = [
    "<scuttle_agent_context>",
    `Agent: ${agent.name} (${agent.id})`,
    `Project: ${agent.projectName} (${agent.projectPath})`,
    `Purpose: ${purposeLine}`,
    "",
    "Instructions (instructionsMd):",
    truncate(agent.instructionsMd, 4000),
    "",
    "Model Stack:",
    formatModelStack(agent),
    "",
    "Pinned Invariants:",
    formatMemoryLines(pinnedMemories),
    "",
    "Scuttle Agent REST Bridge (also exported as SCUTTLE_API_URL and SCUTTLE_AGENT_ID):",
    `- Search/retrieve memories on demand: curl -sS "${agentBase}/memories?q=<query>"`,
    `- Update agent profile (name, purpose, instructionsMd, modelStack): curl -sS -X PATCH "${agentBase}" -H "Content-Type: application/json" -d '{"purpose":"...","instructionsMd":"..."}'`,
    `- List available providers and models: curl -sS "${apiBaseUrl}/api/providers"`,
    `- Save memory: curl -sS -X POST "${agentBase}/memories" -H "Content-Type: application/json" -d '{"category":"fact","title":"...","content":"...","pinned":false,"source":"agent"}'`,
    `- Delegate worker: curl -sS -X POST "${agentBase}/delegations" -H "Content-Type: application/json" -d '{"role":"workhorse","kind":"pr","title":"...","brief":"...","runtime":"worktree"}'`,
    `- Create/update issue: POST "${agentBase}/issues" or PATCH "${agentBase}/issues/<issueId>"`,
    `- Trigger check-in: POST "${agentBase}/checkins"`,
    "</scuttle_agent_context>",
  ].join("\n");

  return { text, memoryIds: pinnedMemories.map((m) => m.id) };
};

export const buildAgentStableContext = (input: {
  readonly db: Database;
  readonly agent: Agent;
  readonly apiBaseUrl: string;
}): string => buildStableContextWithIds(input).text;

export const computeAgentContextHash = (stableBlock: string): string =>
  createHash("sha256").update(stableBlock).digest("hex").slice(0, 16);

const formatSettledDelegation = (d: AgentDelegation): string =>
  `- [${d.status}] ${d.title} (${d.id})${d.prUrl ? ` PR: ${d.prUrl}` : ""}${d.resultSummary ? ` — ${truncate(d.resultSummary, 240)}` : ""}`;

const assembleAgentDelta = (input: {
  readonly db: Database;
  readonly agentId: string;
  readonly profileHash: string;
}): { readonly header: string; readonly surfacedDelegations: ReadonlyArray<AgentDelegation> } => {
  const { db, agentId, profileHash } = input;
  const unnotified = listUnnotifiedSettledDelegations(db, agentId);
  const runningCount = listDelegations(db, agentId, 100).filter(
    (d) => d.status === "running" || d.status === "waiting_parent",
  ).length;
  const openIssueCount = listIssues(db, agentId).filter(
    (i) => i.state !== "done" && i.state !== "canceled",
  ).length;

  if (unnotified.length === 0 && runningCount === 0 && openIssueCount === 0) {
    return { header: "", surfacedDelegations: [] };
  }

  const lines: string[] = [`<scuttle_agent_delta profileHash="${profileHash}">`];
  if (unnotified.length > 0) {
    lines.push("Newly settled delegations:");
    for (const d of unnotified) {
      lines.push(formatSettledDelegation(d));
    }
  }
  lines.push(`Running delegations: ${runningCount}`);
  lines.push(`Open issues: ${openIssueCount}`);
  lines.push("</scuttle_agent_delta>");

  return { header: lines.join("\n"), surfacedDelegations: unnotified };
};

export const buildAgentDeltaHeader = (input: {
  readonly db: Database;
  readonly agentId: string;
  readonly profileHash: string;
}): string => assembleAgentDelta(input).header;

export const buildAgentContextBlock = (input: {
  readonly db: Database;
  readonly agent: Agent;
  readonly userPrompt: string;
  readonly apiBaseUrl: string;
}): string => {
  const { db, agent, userPrompt, apiBaseUrl } = input;
  const { text: stable, memoryIds: pinnedIds } = buildStableContextWithIds({
    db,
    agent,
    apiBaseUrl,
  });
  const profileHash = computeAgentContextHash(stable);
  const matched =
    userPrompt.trim().length > 0
      ? searchMemories(db, agent.id, userPrompt, 4, { excludePinned: true })
      : [];
  const accessedIds = [...pinnedIds, ...matched.map((m) => m.id)];
  if (accessedIds.length > 0) {
    recordMemoryAccess(db, accessedIds, new Date().toISOString());
  }

  const parts = [stable];
  if (matched.length > 0) {
    parts.push(`Query-matched memories:\n${formatMemoryLines(matched)}`);
  }
  const deltaHeader = buildAgentDeltaHeader({ db, agentId: agent.id, profileHash });
  if (deltaHeader.length > 0) {
    parts.push(deltaHeader);
  }
  return parts.join("\n\n");
};

export const formatSessionHandoff = (activeSummary: string): string =>
  `<scuttle_session_handoff>\n${activeSummary}\n</scuttle_session_handoff>`;

export interface WrappedThreadPrompt {
  readonly prompt: string;
  readonly freshSessionPrompt?: string;
  readonly agentId?: string;
  readonly delegationId?: string;
  readonly pendingContextHash?: string;
  readonly pendingNotifiedDelegationIds: ReadonlyArray<string>;
  readonly pendingAccessedMemoryIds: ReadonlyArray<string>;
}

export const wrapPromptForThread = (input: {
  readonly db: Database;
  readonly thread: Thread;
  readonly userPrompt: string;
  readonly apiBaseUrl: string;
}): WrappedThreadPrompt => {
  const { db, thread, userPrompt, apiBaseUrl } = input;
  const agent = readAgentByPrimaryThreadId(db, thread.id);
  const sessionEpoch = thread.sessionEpoch ?? 0;
  const hasCompletedTurn = hasCompletedTurnInEpoch(db, thread.id, sessionEpoch);
  const isResumedSession = Boolean(thread.providerSessionId);
  const isFreshProviderSession = !isResumedSession || !hasCompletedTurn;
  const activeSummary = thread.activeSummary?.trim() ?? "";
  const handoff = activeSummary.length > 0 ? formatSessionHandoff(activeSummary) : "";

  if (agent === null) {
    const activeDelegation = readActiveDelegationByChildThread(db, thread.id);
    const agentId = activeDelegation?.agentId ?? readAgentIdForThread(db, thread.id) ?? undefined;
    const delegationId = activeDelegation?.id;
    const prompt =
      isFreshProviderSession && handoff.length > 0 ? `${handoff}\n\n${userPrompt}` : userPrompt;
    const freshSessionPrompt =
      isResumedSession && handoff.length > 0 ? `${handoff}\n\n${userPrompt}` : undefined;
    return {
      prompt,
      ...(freshSessionPrompt !== undefined ? { freshSessionPrompt } : {}),
      ...(agentId ? { agentId } : {}),
      ...(delegationId ? { delegationId } : {}),
      pendingNotifiedDelegationIds: [],
      pendingAccessedMemoryIds: [],
    };
  }

  const { text: stable, memoryIds: pinnedIds } = buildStableContextWithIds({
    db,
    agent,
    apiBaseUrl,
  });
  const profileHash = computeAgentContextHash(stable);
  const previousHash = readThreadContextHash(db, thread.id);
  const needsFullContext = isFreshProviderSession || previousHash !== profileHash;
  const delta = assembleAgentDelta({ db, agentId: agent.id, profileHash });

  const sections: string[] = [];
  if (needsFullContext) {
    sections.push(stable);
    if (isFreshProviderSession && handoff.length > 0) sections.push(handoff);
  }
  if (delta.header.length > 0) {
    sections.push(delta.header);
  }
  sections.push(userPrompt);

  const freshSessionPrompt = isResumedSession
    ? [
        stable,
        ...(handoff.length > 0 ? [handoff] : []),
        ...(delta.header.length > 0 ? [delta.header] : []),
        userPrompt,
      ].join("\n\n")
    : undefined;

  return {
    prompt: sections.join("\n\n"),
    ...(freshSessionPrompt !== undefined ? { freshSessionPrompt } : {}),
    agentId: agent.id,
    ...(needsFullContext ? { pendingContextHash: profileHash } : {}),
    pendingNotifiedDelegationIds: delta.surfacedDelegations.map((d) => d.id),
    pendingAccessedMemoryIds: needsFullContext ? pinnedIds : [],
  };
};

export const commitTurnContextEffects = (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly threadId: string;
  readonly sessionEpoch: number;
  readonly completedAt: string;
  readonly agentId?: string;
  readonly pendingContextHash?: string;
  readonly pendingNotifiedDelegationIds?: ReadonlyArray<string>;
  readonly pendingAccessedMemoryIds?: ReadonlyArray<string>;
}): void => {
  const {
    db,
    eventBus,
    threadId,
    sessionEpoch,
    completedAt,
    agentId,
    pendingContextHash,
    pendingNotifiedDelegationIds,
    pendingAccessedMemoryIds,
  } = input;
  if (pendingContextHash !== undefined) {
    updateThreadContextHash(db, threadId, pendingContextHash, sessionEpoch);
  }
  if (pendingAccessedMemoryIds && pendingAccessedMemoryIds.length > 0) {
    recordMemoryAccess(db, pendingAccessedMemoryIds, completedAt);
  }
  if (pendingNotifiedDelegationIds && pendingNotifiedDelegationIds.length > 0) {
    markDelegationsParentNotified(db, pendingNotifiedDelegationIds, completedAt);
    if (agentId) {
      for (const id of pendingNotifiedDelegationIds) {
        const delegation = readDelegationById(db, agentId, id);
        if (delegation) {
          eventBus.publishSync({ kind: "agent.delegation.upserted", delegation });
        }
      }
    }
  }
};

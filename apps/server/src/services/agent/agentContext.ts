import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  formatResolvedModelTiers,
  resolveEffectiveModelTiers,
  type Agent,
  type AgentDelegation,
  type AgentMemory,
  type AgentModelRole,
  type ResolvedModelTiers,
  type Thread,
} from "@scuttle/contracts";
import type * as EventBus from "../EventBus.ts";
import { readScopedModelTierConfigs } from "../ModelTierService.ts";
import {
  getCachedVendoredSkills,
  looksLikeSkillInvocation,
  matchSkillInvocation,
} from "../SkillService.ts";
import {
  hasCompletedTurnInEpoch,
  readThreadContextHash,
  updateThreadContextHash,
} from "../threadStore.ts";
import {
  listMemories,
  readAgentByPrimaryThreadId,
  recordMemoryAccess,
  searchMemories,
} from "./agentStore.ts";
import {
  listDelegations,
  listDelegationsByParentThread,
  listIssuesAssignedToAgent,
  listRecentUserIssueActivities,
  listUnnotifiedSettledDelegations,
  listUnnotifiedSettledDelegationsByParentThread,
  markDelegationsParentNotified,
  readActiveDelegationByChildThread,
  readAgentIdForThread,
  readDelegationByDelegationId,
} from "./agentWorkStore.ts";

export const AGENT_VOICE_GUIDELINES = [
  "Write like a sharp teammate sending a tight status update or reply, never an essay or assistant boilerplate.",
  "Lead with the real state or answer in the first sentence. Skip greetings, cheerleading, throat-clearing, repeating the user's request, and sign-offs ('Let me know if you need anything else!').",
  "Keep sentences short, plain, and direct. Use contractions naturally ('I'd', 'It'll', 'didn't').",
  "Weave concrete identifiers (short commit SHAs, branch names, PR/issue keys, file paths) inline in prose instead of dumping markdown tables or layers of headings.",
  "Use compact bold lead-ins (e.g. 'Waiting on you:', 'Blocked:', 'Backlog:') and tight numbered items only when there are distinct decisions or items; for simple replies, 1-3 plain sentences is enough.",
  "When a decision is needed, give your concrete call ('I'd go with X. Say the word and I'll start.') and explicitly note anything you left untouched.",
  "No emojis, no filler, no fluff.",
].join("\n- ");

const ROLES: ReadonlyArray<AgentModelRole> = [
  "nano",
  "small",
  "medium",
  "large",
  "xlarge",
  "max",
  "design",
  "agent",
  "workhorse",
  "review",
  "fast",
];

const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;

const formatModelStack = (agent: Agent, resolvedTiers: ResolvedModelTiers): string => {
  const tierBlock = formatResolvedModelTiers(resolvedTiers);
  const legacyLines = ROLES.map((role) => {
    const sel = agent.modelStack[role];
    return sel
      ? `- ${role}: ${sel.providerKind}/${sel.model}${sel.effort ? ` (${sel.effort})` : ""}`
      : null;
  }).filter((line): line is string => line !== null);
  return legacyLines.length === 0
    ? tierBlock
    : `${tierBlock}\nAgent role overrides:\n${legacyLines.join("\n")}`;
};

const formatSkillPreamble = (input: {
  readonly skillsRoot: string;
  readonly prompt: string;
  readonly resolvedTiers: ResolvedModelTiers;
}): string => {
  if (!looksLikeSkillInvocation(input.prompt)) return input.prompt;
  const invocation = matchSkillInvocation(getCachedVendoredSkills(input.skillsRoot), input.prompt);
  if (invocation === null) return input.prompt;
  const { skill, remainder } = invocation;
  const header = [
    `<scuttle_skill command="${skill.command}" name="${skill.name}" path="${skill.path}" root="${input.skillsRoot}">`,
    `Read and follow the skill instructions at \`${skill.path}\`.`,
    `Vendored sibling skills live at \`${input.skillsRoot}/skills/<name>/SKILL.md\`, subagent definitions at \`${input.skillsRoot}/agents/\`, and standards at \`${input.skillsRoot}/AGENTS.md\`.`,
    "",
    "Effective Scuttle model stack (Agent -> Project -> Global):",
    formatResolvedModelTiers(input.resolvedTiers),
    "</scuttle_skill>",
  ].join("\n");
  return remainder.length > 0 ? `${header}\n\n${remainder}` : header;
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
  const resolvedTiers = resolveEffectiveModelTiers(readScopedModelTierConfigs(db), {
    projectId: agent.projectId,
    agentId: agent.id,
  });
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
    "Default messaging style (unless overridden by instructionsMd below):",
    `- ${AGENT_VOICE_GUIDELINES}`,
    "",
    "Instructions (instructionsMd):",
    truncate(agent.instructionsMd, 4000),
    "",
    "Model Stack (Agent -> Project -> Global):",
    formatModelStack(agent, resolvedTiers),
    "",
    "Pinned Invariants:",
    formatMemoryLines(pinnedMemories),
    "",
    "Scuttle Agent REST Bridge (also exported as SCUTTLE_API_URL, SCUTTLE_AGENT_ID, SCUTTLE_SKILLS_DIR):",
    `- Search/retrieve memories on demand: curl -sS "${agentBase}/memories?q=<query>"`,
    `- Update agent profile (name, purpose, instructionsMd, modelStack): curl -sS -X PATCH "${agentBase}" -H "Content-Type: application/json" -d '{"purpose":"...","instructionsMd":"..."}'`,
    `- List available providers and models: curl -sS "${apiBaseUrl}/api/providers"`,
    `- List vendored /scuttle:* skills: curl -sS "${apiBaseUrl}/api/skills"`,
    `- Read or update scoped model tiers (global/project/agent): GET/PUT "${apiBaseUrl}/api/model-tiers"`,
    `- Save memory: curl -sS -X POST "${agentBase}/memories" -H "Content-Type: application/json" -d '{"category":"fact","title":"...","content":"...","pinned":false,"source":"agent"}'`,
    `- Delegate worker (role: nano|small|medium|large|xlarge|max|design|workhorse|review|fast): curl -sS -X POST "${agentBase}/delegations" -H "Content-Type: application/json" -d '{"role":"medium","kind":"pr","title":"...","brief":"...","runtime":"worktree"}'`,
    `- List issues: curl -sS "${agentBase}/issues" (or all workspace issues: "${apiBaseUrl}/api/issues")`,
    `- Create/update issue (always include "actor":"agent"; states: needs_you|in_review|in_progress|waiting|todo|backlog|done|canceled; priority: urgent|high|normal|low|none; assignee: {"kind":"unassigned"}|{"kind":"user"}|{"kind":"agent","agentId":"${agent.id}"}): POST "${agentBase}/issues" or PATCH "${agentBase}/issues/<issueId>"`,
    `- Escalate an issue to the user: PATCH "${agentBase}/issues/<issueId>" with '{"state":"needs_you","assignee":{"kind":"user"},"actor":"agent"}' and leave a clear comment via POST "${agentBase}/issues/<issueId>/comments" with '{"body":"...","actor":"agent"}'`,
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
  const openIssues = listIssuesAssignedToAgent(db, agentId).filter(
    (i) => i.state !== "done" && i.state !== "canceled",
  );
  const assignedToMe = openIssues.filter(
    (i) => i.assignee.kind === "agent" && i.assignee.agentId === agentId,
  );
  const needsYouIssues = openIssues.filter((i) => i.state === "needs_you");
  const recentUserUpdates = listRecentUserIssueActivities(db, agentId, 4);
  if (unnotified.length === 0 && runningCount === 0 && openIssues.length === 0)
    return { header: "", surfacedDelegations: [] };
  const lines: string[] = [`<scuttle_agent_delta profileHash="${profileHash}">`];
  if (unnotified.length > 0) {
    lines.push("Newly settled delegations:");
    for (const d of unnotified) lines.push(formatSettledDelegation(d));
  }
  lines.push(`Running delegations: ${runningCount}`, `Open issues: ${openIssues.length}`);
  if (assignedToMe.length > 0) {
    lines.push("Issues assigned to you:");
    for (const issue of assignedToMe.slice(0, 6))
      lines.push(
        `- ${issue.key} [${issue.state}, ${issue.priority}] (${issue.id}): ${truncate(issue.title, 120)}`,
      );
  }
  if (needsYouIssues.length > 0) {
    lines.push("Issues waiting on user (needs_you):");
    for (const issue of needsYouIssues.slice(0, 4))
      lines.push(`- ${issue.key} (${issue.id}): ${truncate(issue.title, 120)}`);
  }
  if (recentUserUpdates.length > 0) {
    lines.push("Recent user issue updates:");
    for (const item of recentUserUpdates)
      lines.push(
        `- ${item.issueKey} (${item.activity.kind}): ${truncate(item.activity.body, 140)}`,
      );
  }
  lines.push("</scuttle_agent_delta>");
  return { header: lines.join("\n"), surfacedDelegations: unnotified };
};

const assembleThreadDelta = (
  db: Database,
  threadId: string,
): { readonly header: string; readonly surfacedDelegations: ReadonlyArray<AgentDelegation> } => {
  const unnotified = listUnnotifiedSettledDelegationsByParentThread(db, threadId);
  const runningCount = listDelegationsByParentThread(db, threadId, 100).filter(
    (d) => d.status === "running" || d.status === "waiting_parent",
  ).length;
  if (unnotified.length === 0 && runningCount === 0) return { header: "", surfacedDelegations: [] };
  const lines: string[] = [`<scuttle_thread_delta threadId="${threadId}">`];
  if (unnotified.length > 0) {
    lines.push("Newly settled child delegations:");
    for (const d of unnotified) lines.push(formatSettledDelegation(d));
  }
  lines.push(`Active child delegations: ${runningCount}`, "</scuttle_thread_delta>");
  return { header: lines.join("\n"), surfacedDelegations: unnotified };
};

const formatChildDelegationContext = (delegation: AgentDelegation): string =>
  [
    `<scuttle_delegation_context delegationId="${delegation.id}" parentThreadId="${delegation.parentThreadId}" role="${delegation.role}" kind="${delegation.kind}">`,
    ...(delegation.maxBounces > 0
      ? [
          `Bounce-back to parent thread (budget ${delegation.maxBounces}): POST $SCUTTLE_API_URL/api/delegations/$SCUTTLE_DELEGATION_ID/ask (poll GET $SCUTTLE_API_URL/api/delegations/$SCUTTLE_DELEGATION_ID/questions).`,
        ]
      : []),
    "Scuttle MCP tools (when available): scuttle_delegate_task, scuttle_task_status, scuttle_perf_query, scuttle_viz_render.",
    "</scuttle_delegation_context>",
  ].join("\n");

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
  if (accessedIds.length > 0) recordMemoryAccess(db, accessedIds, new Date().toISOString());
  const parts = [stable];
  if (matched.length > 0) parts.push(`Query-matched memories:\n${formatMemoryLines(matched)}`);
  const deltaHeader = buildAgentDeltaHeader({ db, agentId: agent.id, profileHash });
  if (deltaHeader.length > 0) parts.push(deltaHeader);
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
  readonly skillsRoot?: string | undefined;
}): WrappedThreadPrompt => {
  const { db, thread, userPrompt, apiBaseUrl, skillsRoot } = input;
  const agent = readAgentByPrimaryThreadId(db, thread.id);
  const resolvedTiers = resolveEffectiveModelTiers(readScopedModelTierConfigs(db), {
    projectId: thread.projectId,
    ...(agent ? { agentId: agent.id } : {}),
  });
  const effectiveUserPrompt = skillsRoot
    ? formatSkillPreamble({ skillsRoot, prompt: userPrompt, resolvedTiers })
    : userPrompt;
  const hasCompletedTurn = hasCompletedTurnInEpoch(db, thread.id, thread.sessionEpoch ?? 0);
  const isResumedSession = Boolean(thread.providerSessionId);
  const isFreshProviderSession = !isResumedSession || !hasCompletedTurn;
  const activeSummary = thread.activeSummary?.trim() ?? "";
  const handoff = activeSummary.length > 0 ? formatSessionHandoff(activeSummary) : "";

  if (agent === null) {
    const activeDelegation = readActiveDelegationByChildThread(db, thread.id);
    const agentId = activeDelegation?.agentId ?? readAgentIdForThread(db, thread.id) ?? undefined;
    const threadDelta = assembleThreadDelta(db, thread.id);
    const childContext = activeDelegation ? formatChildDelegationContext(activeDelegation) : "";
    const sections = [
      ...(isFreshProviderSession && childContext.length > 0 ? [childContext] : []),
      ...(isFreshProviderSession && handoff.length > 0 ? [handoff] : []),
      ...(threadDelta.header.length > 0 ? [threadDelta.header] : []),
      effectiveUserPrompt,
    ];
    const freshSections = [
      ...(childContext.length > 0 ? [childContext] : []),
      ...(handoff.length > 0 ? [handoff] : []),
      ...(threadDelta.header.length > 0 ? [threadDelta.header] : []),
      effectiveUserPrompt,
    ];
    return {
      prompt: sections.join("\n\n"),
      ...(isResumedSession && freshSections.length > 1
        ? { freshSessionPrompt: freshSections.join("\n\n") }
        : {}),
      ...(agentId ? { agentId } : {}),
      ...(activeDelegation ? { delegationId: activeDelegation.id } : {}),
      pendingNotifiedDelegationIds: threadDelta.surfacedDelegations.map((d) => d.id),
      pendingAccessedMemoryIds: [],
    };
  }

  const { text: stable, memoryIds: pinnedIds } = buildStableContextWithIds({
    db,
    agent,
    apiBaseUrl,
  });
  const profileHash = computeAgentContextHash(stable);
  const needsFullContext =
    isFreshProviderSession || readThreadContextHash(db, thread.id) !== profileHash;
  const delta = assembleAgentDelta({ db, agentId: agent.id, profileHash });
  const sections = [
    ...(needsFullContext
      ? [stable, ...(isFreshProviderSession && handoff.length > 0 ? [handoff] : [])]
      : []),
    ...(delta.header.length > 0 ? [delta.header] : []),
    effectiveUserPrompt,
  ];
  const freshSessionPrompt = isResumedSession
    ? [
        stable,
        ...(handoff.length > 0 ? [handoff] : []),
        ...(delta.header.length > 0 ? [delta.header] : []),
        effectiveUserPrompt,
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
    pendingContextHash,
    pendingNotifiedDelegationIds,
    pendingAccessedMemoryIds,
  } = input;
  if (pendingContextHash !== undefined)
    updateThreadContextHash(db, threadId, pendingContextHash, sessionEpoch);
  if (pendingAccessedMemoryIds && pendingAccessedMemoryIds.length > 0)
    recordMemoryAccess(db, pendingAccessedMemoryIds, completedAt);
  if (pendingNotifiedDelegationIds && pendingNotifiedDelegationIds.length > 0) {
    markDelegationsParentNotified(db, pendingNotifiedDelegationIds, completedAt);
    for (const id of pendingNotifiedDelegationIds) {
      const delegation = readDelegationByDelegationId(db, id);
      if (delegation) eventBus.publishSync({ kind: "agent.delegation.upserted", delegation });
    }
  }
};

import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentCheckIn,
  AgentDelegationKind,
  AgentIssue,
  AgentMemory,
  AgentModelRole,
  ModelSelection,
  Project,
  ProviderSnapshot,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { listMemories, readAgentByPrimaryThreadId, searchMemories } from "./agentStore.ts";
import { listDelegations, listIssues } from "./agentWorkStore.ts";

const FALLBACK_SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};

export const pickDefaultModelSelection = (
  snapshots: ReadonlyArray<ProviderSnapshot>,
): ModelSelection => {
  const ready =
    snapshots.find((p) => p.enabled && p.status === "ready" && p.models.length > 0) ??
    snapshots.find((p) => p.enabled && p.models.length > 0) ??
    snapshots[0];
  if (!ready) return FALLBACK_SELECTION;
  const model =
    ready.models.find((m) => m.slug === ready.defaultModel) ??
    ready.models.find((m) => m.isDefault) ??
    ready.models[0];
  if (!model) return FALLBACK_SELECTION;
  const effort =
    ready.defaultEffort && model.efforts.includes(ready.defaultEffort)
      ? ready.defaultEffort
      : (model.defaultEffort ?? model.efforts[0]);
  return {
    providerId: ready.id,
    providerKind: ready.kind,
    model: model.slug,
    ...(effort ? { effort } : {}),
  };
};

export const defaultPurpose = (project: Pick<Project, "name" | "path">): string =>
  `Persistent Captain for ${project.name} (${project.path}). Maintains project memory, triages issues, and delegates focused tasks and PRs.`;

const ROLES: ReadonlyArray<AgentModelRole> = [
  "captain",
  "workhorse",
  "design",
  "review",
  "fast",
  "large",
];

export const defaultInstructionsMd = (
  projectName: string,
  projectPath: string,
): string => `# ${projectName} Captain Skill

You are the persistent single-source Captain Agent for **${projectName}** (\`${projectPath}\`).

## Responsibilities
1. **Maintain Durable Memory**: Record important facts, architectural decisions, repo conventions, and PR/issue context so future turns start informed. Pin critical invariants.
2. **Coordinate Work**: Triage issues, break large tasks into focused sub-tasks, and delegate execution to worker threads instead of crowding your own primary thread.
3. **Delegation Roles**:
   - \`captain\`: Planning, triage, architecture, synthesis
   - \`workhorse\`: Feature implementation, bug fixes, tests
   - \`design\`: Frontend, UI/UX, styling, layout work
   - \`review\`: Code review, verification, blast-radius checks
   - \`fast\`: Quick searches, small edits, summaries
   - \`large\`: Deep reasoning, complex refactors
4. **E2E PR Workflow**:
   - Prefer \`worktree\` runtime so each PR task works on an isolated branch.
   - Implement cleanly, run tests/lint/typecheck, commit with clear messages, push, and open a ready-for-review PR.
   - Report the PR URL and verification results back cleanly.`;

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

const selectContextMemories = (
  db: Database,
  agentId: string,
  userPrompt: string,
): ReadonlyArray<AgentMemory> => {
  const all = listMemories(db, agentId, 50);
  const pinned = all.filter((m) => m.pinned).slice(0, 6);
  const matched = searchMemories(db, agentId, userPrompt, 8);
  const combined: AgentMemory[] = [];
  const seen = new Set<string>();
  for (const mem of [...pinned, ...matched]) {
    if (seen.has(mem.id) || combined.length >= 10) continue;
    seen.add(mem.id);
    combined.push(mem);
  }
  return combined;
};

export const buildCaptainContextBlock = (input: {
  readonly db: Database;
  readonly agent: Agent;
  readonly userPrompt: string;
  readonly apiBaseUrl: string;
}): string => {
  const { db, agent, userPrompt, apiBaseUrl } = input;
  const memories = selectContextMemories(db, agent.id, userPrompt);
  const delegations = listDelegations(db, agent.id, 10).filter((d) => d.status === "running");
  const openIssues = listIssues(db, agent.id)
    .filter((issue) => issue.state !== "done" && issue.state !== "canceled")
    .slice(0, 12);

  const memoryLines =
    memories.length > 0
      ? memories
          .map(
            (m) =>
              `- [${m.category}${m.pinned ? ", pinned" : ""}] (${m.id}) ${m.title}: ${truncate(m.content, 240)}`,
          )
          .join("\n")
      : "(none yet)";

  const delegationLines =
    delegations.length > 0
      ? delegations
          .map((d) => `- [${d.role}/${d.kind}] (${d.id}) ${d.title} -> thread ${d.childThreadId}`)
          .join("\n")
      : "(none running)";

  const issueLines =
    openIssues.length > 0
      ? openIssues
          .map(
            (i) =>
              `- [${i.state}] ${i.key} (${i.id}): ${i.title}${i.prUrl ? ` (PR: ${i.prUrl})` : ""}`,
          )
          .join("\n")
      : "(none open)";

  const agentBase = `${apiBaseUrl}/api/agents/${agent.id}`;
  return [
    "<scuttle_agent_context>",
    `Agent: ${agent.name} (${agent.id})`,
    `Project: ${agent.projectName} (${agent.projectPath})`,
    `Purpose: ${truncate(agent.purpose, 400)}`,
    "",
    "Setup Skill (instructionsMd):",
    truncate(agent.instructionsMd, 4000),
    "",
    "Model Stack:",
    formatModelStack(agent),
    "",
    "Memories (pinned + query-matched):",
    memoryLines,
    "",
    "Active Delegations:",
    delegationLines,
    "",
    "Open Issues:",
    issueLines,
    "",
    "Scuttle Agent REST Bridge (also exported as SCUTTLE_API_URL and SCUTTLE_AGENT_ID):",
    `- Save memory: curl -sS -X POST "${agentBase}/memories" -H "Content-Type: application/json" -d '{"category":"fact","title":"...","content":"...","pinned":false,"source":"agent"}'`,
    `- Update setup skill/modelStack: curl -sS -X PATCH "${agentBase}" -H "Content-Type: application/json" -d '{"instructionsMd":"..."}'`,
    `- Delegate worker: curl -sS -X POST "${agentBase}/delegations" -H "Content-Type: application/json" -d '{"role":"workhorse","kind":"pr","title":"...","brief":"...","runtime":"worktree"}'`,
    `- Create/update issue: POST "${agentBase}/issues" or PATCH "${agentBase}/issues/<issueId>"`,
    `- Trigger check-in: POST "${agentBase}/checkins"`,
    "</scuttle_agent_context>",
  ].join("\n");
};

export const maybeWrapCaptainPrompt = (
  db: Database,
  threadId: string,
  userPrompt: string,
  apiBaseUrl: string,
): { readonly prompt: string; readonly agentId?: string } => {
  const agent = readAgentByPrimaryThreadId(db, threadId);
  if (agent !== null) {
    const context = buildCaptainContextBlock({ db, agent, userPrompt, apiBaseUrl });
    return { prompt: `${context}\n\n${userPrompt}`, agentId: agent.id };
  }
  const child = db
    .query<{ readonly agent_id: string }, [string]>(
      "SELECT agent_id FROM agent_delegations WHERE child_thread_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(threadId);
  return child ? { prompt: userPrompt, agentId: child.agent_id } : { prompt: userPrompt };
};

export const buildDelegationBrief = (input: {
  readonly agent: Agent;
  readonly role: AgentModelRole;
  readonly kind: AgentDelegationKind;
  readonly title: string;
  readonly brief: string;
  readonly pinnedMemories: ReadonlyArray<AgentMemory>;
  readonly issue?: AgentIssue | null;
}): string => {
  const sections: string[] = [
    `You are a delegated **${input.role}** worker for Captain **${input.agent.name}** on project **${input.agent.projectName}** (\`${input.agent.projectPath}\`).`,
    `Task (${input.kind}): ${input.title}`,
    "",
    "## Brief",
    input.brief,
  ];

  if (input.issue) {
    sections.push(
      "",
      `## Linked Issue (${input.issue.key})`,
      `Title: ${input.issue.title}`,
      ...(input.issue.description.trim().length > 0
        ? [`Description: ${input.issue.description}`]
        : []),
      ...(input.issue.externalUrl ? [`URL: ${input.issue.externalUrl}`] : []),
    );
  }

  if (input.pinnedMemories.length > 0) {
    sections.push(
      "",
      "## Key Project Memories",
      ...input.pinnedMemories
        .slice(0, 6)
        .map((m) => `- [${m.category}] ${m.title}: ${truncate(m.content, 240)}`),
    );
  }

  if (input.kind === "pr") {
    sections.push(
      "",
      "## E2E PR Workflow",
      "1. Work cleanly in this branch/worktree, make focused edits, and run the project's verification checks (tests, lint, typecheck).",
      "2. Commit your changes with a clear commit message and push the branch.",
      "3. Open a ready-for-review pull request (e.g. via `gh pr create` or Scuttle's git PR endpoint) and include the final PR URL and verification output in your response.",
    );
  }

  return sections.join("\n");
};

export const buildSetupStartPrompt = (agent: Agent, extraInstructions?: string): string => {
  const lines = [
    `Please run initial Captain setup for **${agent.name}** in \`${agent.projectPath}\`.`,
    "",
    "1. Inspect the repository layout, README/AGENTS.md, package/build scripts, test commands, and git remotes.",
    '2. Save 3-6 concise, high-value memories (architecture, test/check commands, key conventions) via the Scuttle Agent memories API (`POST /api/agents/$SCUTTLE_AGENT_ID/memories` with `source: "agent"` and `pinned: true` for invariants).',
    "3. Refine your setup skill (`instructionsMd` via `PATCH /api/agents/$SCUTTLE_AGENT_ID`) if repo-specific commands or guidelines should be added.",
    "4. Summarize what you discovered and saved.",
  ];
  if (extraInstructions && extraInstructions.trim().length > 0) {
    lines.push("", `Additional user guidance: ${extraInstructions.trim()}`);
  }
  return lines.join("\n");
};

export const buildCheckInPrompt = (checkIn: AgentCheckIn, focus?: string): string => {
  const lines = [
    "Review this automated check-in digest and surface any blockers, next actions, or PRs needing review:",
    "",
    checkIn.summary,
  ];
  if (focus && focus.trim().length > 0) {
    lines.push("", `Focus area: ${focus.trim()}`);
  }
  return lines.join("\n");
};

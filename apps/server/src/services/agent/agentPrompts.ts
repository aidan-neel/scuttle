import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentCheckIn,
  AgentDelegationKind,
  AgentIssue,
  AgentMemory,
  AgentModelRole,
  ModelSelection,
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

export const formatAgentName = (projectName: string): string => {
  const words = projectName
    .trim()
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : "Agent";
};

const ROLES: ReadonlyArray<AgentModelRole> = [
  "agent",
  "workhorse",
  "design",
  "review",
  "fast",
  "large",
];

export const defaultInstructionsMd = (
  agentName: string,
  projectName: string,
  projectPath: string,
): string => `# ${agentName}

You are **${agentName}**, a persistent Agent for **${projectName}** (\`${projectPath}\`).

## Responsibilities
1. **Configure Yourself Through Chat**: Whenever the user tells you your purpose, name, working rules, or preferred model roster, persist those updates immediately with \`PATCH $SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID\` and save durable facts to memory.
2. **Maintain Durable Memory**: Record important facts, architectural decisions, repo conventions, and PR/issue context so future turns start informed. Pin critical invariants.
3. **Coordinate Work**: Triage issues, break large tasks into focused sub-tasks, and delegate execution to worker threads instead of crowding your own primary thread.
4. **Delegation Roles**:
   - \`agent\`: Primary conversation, planning, triage, synthesis
   - \`workhorse\`: Feature implementation, bug fixes, tests
   - \`design\`: Frontend, UI/UX, styling, layout work
   - \`review\`: Code review, verification, blast-radius checks
   - \`fast\`: Quick searches, small edits, summaries
   - \`large\`: Deep reasoning, complex refactors
5. **E2E PR Workflow**:
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

export const buildAgentContextBlock = (input: {
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

  const purposeLine =
    agent.purpose.trim().length > 0
      ? truncate(agent.purpose, 400)
      : "(not set yet — once the user tells you your purpose, save it via PATCH)";

  const agentBase = `${apiBaseUrl}/api/agents/${agent.id}`;
  return [
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
    `- Update agent profile (name, purpose, instructionsMd, modelStack): curl -sS -X PATCH "${agentBase}" -H "Content-Type: application/json" -d '{"purpose":"...","instructionsMd":"..."}'`,
    `- List available providers and models: curl -sS "${apiBaseUrl}/api/providers"`,
    `- Save memory: curl -sS -X POST "${agentBase}/memories" -H "Content-Type: application/json" -d '{"category":"fact","title":"...","content":"...","pinned":false,"source":"agent"}'`,
    `- Delegate worker: curl -sS -X POST "${agentBase}/delegations" -H "Content-Type: application/json" -d '{"role":"workhorse","kind":"pr","title":"...","brief":"...","runtime":"worktree"}'`,
    `- Create/update issue: POST "${agentBase}/issues" or PATCH "${agentBase}/issues/<issueId>"`,
    `- Trigger check-in: POST "${agentBase}/checkins"`,
    "</scuttle_agent_context>",
  ].join("\n");
};

export const maybeWrapAgentPrompt = (
  db: Database,
  threadId: string,
  userPrompt: string,
  apiBaseUrl: string,
): { readonly prompt: string; readonly agentId?: string } => {
  const agent = readAgentByPrimaryThreadId(db, threadId);
  if (agent !== null) {
    const context = buildAgentContextBlock({ db, agent, userPrompt, apiBaseUrl });
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
    `You are a delegated **${input.role}** worker for Agent **${input.agent.name}** on project **${input.agent.projectName}** (\`${input.agent.projectPath}\`).`,
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
    `You were just created as **${agent.name}** for \`${agent.projectName}\` (\`${agent.projectPath}\`). Greet the user directly in conversation.`,
    "",
    "Before replying:",
    "1. Quickly inspect the repo (`git status`, `git log -n 5 --oneline`, top-level files, `AGENTS.md` / `README.md`, manifests/scripts) and check `GET $SCUTTLE_API_URL/api/providers` if useful.",
    '2. If the repository already has real code or conventions, save 2-4 concise high-signal memories (`POST $SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID/memories`, `source: "agent"`, `pinned: true` for invariants). Skip saving memories if the repo is empty.',
    "",
    "Then reply concisely in first person (no preamble, no meta commentary):",
    `- Open with: "I'm ${agent.name}, your new Agent. I run a crew of threads for you, brief them, check what they report against their PRs and CI, and only bring you what needs your call."`,
    `- Briefly state what you observed in \`${agent.projectName}\` (e.g. whether it is an empty repo or an existing codebase, any \`AGENTS.md\` or conventions found, and any notable setup gaps).`,
    "- End with two direct numbered questions:",
    "  1. **What am I for?** Is it one product, a specific area of a codebase, or general engineering help?",
    "  2. **What should we start on first?** Tell me the first piece of work, plus any rules or model preferences you want me to follow.",
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

import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDelegationKind,
  AgentDelegationQuestion,
  AgentIssue,
  AgentMemory,
  AgentModelRole,
  ModelSelection,
  ProviderSnapshot,
} from "@scuttle/contracts";
import { type AgentDelegationId, ProviderId } from "@scuttle/shared/ids";

import { AGENT_VOICE_GUIDELINES, buildAgentContextBlock } from "./agentContext.ts";

export { AGENT_VOICE_GUIDELINES, buildAgentContextBlock };

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

export const defaultInstructionsMd = (
  agentName: string,
  projectName: string,
  projectPath: string,
): string => `# ${agentName}

You are **${agentName}**, a persistent Agent for **${projectName}** (\`${projectPath}\`).

## Voice & Messaging
- ${AGENT_VOICE_GUIDELINES}

## Responsibilities
1. **Configure Yourself Through Chat**: Whenever the user tells you your purpose, name, working rules, or preferred model roster, persist those updates immediately with \`PATCH $SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID\` and save durable facts to memory.
2. **Maintain Durable Memory**: Record important facts, architectural decisions, repo conventions, and PR/issue context so future turns start informed. Pin critical invariants.
3. **Coordinate Work**: Triage issues, break large tasks into focused sub-tasks, and delegate execution to worker threads instead of crowding your own primary thread.
4. **Model Tiers & Delegation**:
   - \`nano\`: Read-only explorers, dispatchers, tooling checks, trivial edits
   - \`small\`: Swarm workers, routine code, verification runs, targeted fixes
   - \`medium\`: Default feature, bug-fix, refactor, and perf code delegates
   - \`large\`: Complex multi-file changes, deep debugging, judgment, synthesis
   - \`xlarge\` / \`max\`: Hardest escalations and architecture changes
   - \`design\`: Frontend, UI/UX, styling, layout work
   - \`panel\` / \`council\`: Cross-vendor reviews and design panels
5. **Vendored Skills**:
   - Default Scuttle skills are vendored at \`$SCUTTLE_SKILLS_DIR/skills/<name>/SKILL.md\` and invoked via \`/scuttle:<name>\` (for example \`/scuttle:go\`, \`/scuttle:design\`, \`/scuttle:council\`).
6. **E2E PR Workflow**:
   - Prefer \`worktree\` runtime so each PR task works on an isolated branch.
   - Implement cleanly, run tests/lint/typecheck, commit with clear messages, push, and open a ready-for-review PR.
   - Report the PR URL and verification results back cleanly.
7. **Worker Bounce-Back**:
   - Delegated workers may ask you mid-turn when they hit unexpected failures, weird test errors, missing context, or plan conflicts.
   - Their questions arrive on your primary thread; your reply is returned directly to the waiting worker so it can proceed.`;

const truncate = (text: string, maxChars: number): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;

export const buildDelegationBrief = (input: {
  readonly agent: Agent;
  readonly delegationId: AgentDelegationId | string;
  readonly maxBounces: number;
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
    `Delegation ID: ${input.delegationId}`,
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

  if (input.maxBounces > 0) {
    sections.push(
      "",
      "## Asking Your Parent Agent",
      `If you hit an unexpected failure, weird test error, missing context, plan conflict, or remain stuck after 2 failed attempts, ask your parent Agent instead of retrying blindly (budget: ${input.maxBounces} question(s) max):`,
      "```bash",
      'curl -sS --max-time 300 -X POST "$SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID/delegations/$SCUTTLE_DELEGATION_ID/ask" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"kind":"missing_context","question":"...","attempted":"...","context":"..."}\'',
      "```",
      "Valid `kind` values: `missing_context`, `test_failure`, `unexpected_error`, `plan_conflict`, `other`. This request blocks until the parent Agent replies in its primary thread and returns JSON with `status` and `answer`.",
      "Rules for handling the response:",
      '- Only follow `answer` when the JSON response has `"status": "answered"`.',
      '- If `curl` times out or disconnects before the parent finishes, poll `GET "$SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID/delegations/$SCUTTLE_DELEGATION_ID/questions"` to read the answer once settled instead of re-asking.',
      '- If the response returns `"status": "canceled"`, `"status": "failed"`, or HTTP `422` (`{"error": "..."}`, e.g. bounce budget exhausted), stop retrying and report the blocker cleanly in your final response.',
    );
  }

  return sections.join("\n");
};

export const buildParentQuestionPrompt = (input: {
  readonly agent: Agent;
  readonly delegation: AgentDelegation | null;
  readonly question: AgentDelegationQuestion;
}): string => {
  const { delegation, question } = input;
  const header = delegation
    ? `Worker question from **${delegation.title}** (${delegation.role} / ${delegation.kind}, delegation \`${delegation.id}\`, bounce ${question.bounceNumber}/${delegation.maxBounces}):`
    : `Worker question (delegation \`${question.delegationId}\`, bounce ${question.bounceNumber}):`;
  const lines = [
    header,
    `Kind: \`${question.kind}\` (question \`${question.id}\`)`,
    "",
    "Question:",
    question.question,
  ];
  if (question.attempted) {
    lines.push("", "What the worker already attempted:", question.attempted);
  }
  if (question.context) {
    lines.push("", "Additional context:", question.context);
  }
  lines.push(
    "",
    "Reply directly in this message with the concrete answer, decision, or fix guidance, or tell the worker to stop cleanly. Do not call `POST .../cancel` from inside this reply turn; your response goes straight back to the waiting worker so it can resume.",
  );
  return lines.join("\n");
};

export const buildSetupStartPrompt = (agent: Agent, extraInstructions?: string): string => {
  const lines = [
    `You were just created as **${agent.name}** for \`${agent.projectName}\` (\`${agent.projectPath}\`). Greet the user directly in conversation.`,
    "",
    "Before replying:",
    "1. Quickly inspect the repo (`git status`, `git log -n 5 --oneline`, top-level files, `AGENTS.md` / `README.md`, manifests/scripts) and check `GET $SCUTTLE_API_URL/api/providers` if useful.",
    '2. If the repository already has real code or conventions, save 2-4 concise high-signal memories (`POST $SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID/memories`, `source: "agent"`, `pinned: true` for invariants). Skip saving memories if the repo is empty.',
    "",
    "Then reply concisely in first person (no preamble, no meta commentary, no fluff):",
    `- Open with one tight line introducing yourself as ${agent.name} for \`${agent.projectName}\` — you coordinate worker threads, verify their PRs and CI, and only surface what needs a call.`,
    `- In 1-2 short sentences, state what you actually saw in \`${agent.projectName}\` (branch/HEAD, empty vs active codebase, key conventions or gaps).`,
    "- End with a short **Waiting on you:** list with two crisp numbered items:",
    "  1. What I own here (whole repo, one area, or general engineering help).",
    "  2. What to kick off first, plus any rules or model preferences.",
  ];
  if (extraInstructions && extraInstructions.trim().length > 0) {
    lines.push("", `Additional user guidance: ${extraInstructions.trim()}`);
  }
  return lines.join("\n");
};

export const buildCheckInPrompt = (checkIn: AgentCheckIn, focus?: string): string => {
  const lines = [
    "Review this automated check-in digest and write a tight status update: lead with current state in one line, then use compact bold lead-ins ('Waiting on you:', 'Blocked:', 'Backlog:') only for items that matter. Keep it short and direct.",
    "",
    checkIn.summary,
  ];
  if (focus && focus.trim().length > 0) {
    lines.push("", `Focus area: ${focus.trim()}`);
  }
  return lines.join("\n");
};

import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentIssue,
  AssignAgentIssueInput,
  AssignAgentIssueResult,
  DelegateAgentTaskInput,
  SendTurnInput,
  ThreadTurn,
  TriggerCheckInInput,
  TurnOrigin,
} from "@scuttle/contracts";
import {
  AgentCheckInId,
  AgentDelegationId,
  type AgentId,
  type AgentIssueId,
} from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import type * as GitForgeService from "../GitForgeService.ts";
import type * as GitService from "../GitService.ts";
import type * as ProjectService from "../ProjectService.ts";
import type * as ThreadService from "../ThreadService.ts";
import { buildCheckInPrompt, buildDelegationBrief } from "./agentPrompts.ts";
import { insertCheckIn, listMemories, readAgentById, updateAgentRow } from "./agentStore.ts";
import {
  insertDelegation,
  listDelegations,
  listIssues,
  readDelegationById,
  readIssueById,
  readRunningDelegationByChildThread,
  updateDelegationRow,
  updateIssueRow,
} from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";

const extractPrFromText = (text: string): { readonly url?: string; readonly number?: number } => {
  const match = /https:\/\/[^\s)>]+?\/(?:pull|merge_requests)\/(\d+)/.exec(text);
  if (match === null) return {};
  const num = Number.parseInt(match[1]!, 10);
  return {
    url: match[0],
    ...(Number.isFinite(num) ? { number: num } : {}),
  };
};

const summarizeTurnOutput = (turn: ThreadTurn, fallbackStatus: string): string => {
  const text = turn.assistantMessage.trim();
  if (text.length > 0) {
    return text.length <= 500 ? text : `${text.slice(0, 497)}...`;
  }
  if (turn.error && turn.error.trim().length > 0) {
    return turn.error.trim().slice(0, 500);
  }
  return `Delegation ${fallbackStatus}.`;
};

export const makeAgentDelegationOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly projects: ProjectService.ProjectService["Service"];
  readonly threads: ThreadService.ThreadService["Service"];
  readonly git: GitService.GitService["Service"];
  readonly gitForge: GitForgeService.GitForgeService["Service"];
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
  readonly sendAgentTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
}) => {
  const { db, eventBus, projects, threads, git, gitForge, requireAgent, sendAgentTurn } = deps;

  const handleTurnSettled = (turn: ThreadTurn) => {
    if (turn.status === "running") return;
    const delegation = readRunningDelegationByChildThread(db, turn.threadId);
    if (!delegation) return;

    const status =
      turn.status === "completed" ? "completed" : turn.status === "failed" ? "failed" : "canceled";
    const completedAt = turn.completedAt ?? new Date().toISOString();
    const resultSummary = summarizeTurnOutput(turn, status);
    const pr = extractPrFromText(turn.assistantMessage);
    const nextDelegation: AgentDelegation = {
      ...delegation,
      status,
      resultSummary,
      completedAt,
      ...(pr.url ? { prUrl: pr.url } : delegation.prUrl ? { prUrl: delegation.prUrl } : {}),
    };
    updateDelegationRow(db, nextDelegation);
    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: nextDelegation });

    if (delegation.issueId) {
      const issue = readIssueById(db, delegation.agentId, delegation.issueId);
      if (issue) {
        const nextState =
          status === "completed" && (issue.state === "backlog" || issue.state === "in_progress")
            ? "in_review"
            : issue.state;
        const nextIssue: AgentIssue = {
          ...issue,
          state: nextState,
          ...(pr.url ? { prUrl: pr.url } : {}),
          ...(pr.number !== undefined ? { prNumber: pr.number } : {}),
          updatedAt: completedAt,
        };
        updateIssueRow(db, nextIssue);
        eventBus.publishSync({ kind: "agent.issue.upserted", issue: nextIssue });
      }
    }

    const parent = readAgentById(db, delegation.agentId);
    if (parent) {
      const nextAgent: Agent = {
        ...parent,
        lastSummary: `[${delegation.title}] ${resultSummary.slice(0, 200)}`,
        needsAttention: true,
        updatedAt: completedAt,
      };
      updateAgentRow(db, nextAgent);
      eventBus.publishSync({ kind: "agent.upserted", agent: nextAgent });
    }
  };

  const delegateTask = Effect.fn("AgentService.delegateTask")(function* (
    agentId: AgentId,
    input: DelegateAgentTaskInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const project = yield* projects
      .get(agent.projectId)
      .pipe(
        Effect.mapError(
          (err) => new AgentServiceError({ reason: "not-found", detail: err.message }),
        ),
      );
    let linkedIssue: AgentIssue | null = null;
    if (input.issueId) {
      linkedIssue = readIssueById(db, agent.id, input.issueId);
      if (!linkedIssue) {
        return yield* new AgentServiceError({
          reason: "not-found",
          detail: `Issue "${input.issueId}" was not found.`,
        });
      }
    }

    const modelSelection =
      input.modelSelection ?? agent.modelStack[input.role] ?? agent.modelSelection;
    let runtime = input.runtime ?? "worktree";
    if (runtime === "worktree") {
      const repoStatus = yield* git.status(project.path, { github: [], gitlab: [] });
      if (repoStatus.kind !== "repo" || !repoStatus.hasCommits) {
        runtime = "local";
      }
    }

    const pinnedMemories = listMemories(db, agent.id, 30).filter((m) => m.pinned);
    const fullBrief = buildDelegationBrief({
      agent,
      role: input.role,
      kind: input.kind,
      title: input.title,
      brief: input.brief,
      pinnedMemories,
      issue: linkedIssue,
    });

    const childDetail = yield* threads
      .create({
        projectId: agent.projectId,
        title: input.title,
        prompt: fullBrief,
        runtime,
        branch: project.defaultBranch,
        modelSelection,
      })
      .pipe(
        Effect.mapError(
          (err) => new AgentServiceError({ reason: "rejected", detail: err.message }),
        ),
      );

    const now = new Date().toISOString();
    const delegation: AgentDelegation = {
      id: AgentDelegationId.make(crypto.randomUUID()),
      agentId: agent.id,
      parentThreadId: agent.primaryThreadId,
      childThreadId: childDetail.thread.id,
      role: input.role,
      kind: input.kind,
      title: input.title,
      brief: input.brief,
      modelSelection,
      status: "running",
      ...(linkedIssue ? { issueId: linkedIssue.id } : {}),
      createdAt: now,
    };
    insertDelegation(db, delegation);

    if (linkedIssue) {
      const updatedIssue: AgentIssue = {
        ...linkedIssue,
        assignedThreadId: childDetail.thread.id,
        state: linkedIssue.state === "backlog" ? "in_progress" : linkedIssue.state,
        updatedAt: now,
      };
      updateIssueRow(db, updatedIssue);
      eventBus.publishSync({ kind: "agent.issue.upserted", issue: updatedIssue });
    }

    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation });
    return delegation;
  });

  const assignIssue = Effect.fn("AgentService.assignIssue")(function* (
    agentId: AgentId,
    issueId: AgentIssueId,
    input?: AssignAgentIssueInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const issue = readIssueById(db, agent.id, issueId);
    if (!issue) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Issue "${issueId}" was not found.`,
      });
    }
    const mode = input?.mode ?? "pr";
    if (mode === "agent") {
      const now = new Date().toISOString();
      const updatedIssue: AgentIssue = {
        ...issue,
        assignedThreadId: agent.primaryThreadId,
        state: issue.state === "backlog" ? "in_progress" : issue.state,
        updatedAt: now,
      };
      updateIssueRow(db, updatedIssue);
      eventBus.publishSync({ kind: "agent.issue.upserted", issue: updatedIssue });
      const prompt = [
        `Take ownership of issue **${issue.key}: ${issue.title}** (${issue.id}).`,
        ...(issue.description ? ["", issue.description] : []),
        ...(input?.brief ? ["", `Guidance: ${input.brief}`] : []),
      ].join("\n");
      const turn = yield* sendAgentTurn(agentId, {
        prompt,
        ...(input?.modelSelection ? { modelSelection: input.modelSelection } : {}),
      });
      return { mode: "agent", issue: updatedIssue, turn } satisfies AssignAgentIssueResult;
    }

    const delegation = yield* delegateTask(agentId, {
      role: input?.role ?? "workhorse",
      kind: "pr",
      title: `${issue.key}: ${issue.title}`,
      brief: input?.brief?.trim() || issue.description || issue.title,
      runtime: input?.runtime ?? "worktree",
      issueId: issue.id,
      ...(input?.modelSelection ? { modelSelection: input.modelSelection } : {}),
    });
    const updatedIssue = readIssueById(db, agent.id, issue.id) ?? issue;
    return { mode: "pr", issue: updatedIssue, delegation } satisfies AssignAgentIssueResult;
  });

  const cancelDelegation = Effect.fn("AgentService.cancelDelegation")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) {
    yield* requireAgent(agentId);
    const existing = readDelegationById(db, agentId, delegationId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Delegation "${delegationId}" was not found.`,
      });
    }
    yield* threads.interrupt(existing.childThreadId).pipe(Effect.ignore);
    const latest = readDelegationById(db, agentId, delegationId) ?? existing;
    if (latest.status !== "running") return latest;
    const canceled: AgentDelegation = {
      ...latest,
      status: "canceled",
      resultSummary: latest.resultSummary ?? "Canceled by user.",
      completedAt: new Date().toISOString(),
    };
    updateDelegationRow(db, canceled);
    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: canceled });
    return canceled;
  });

  const runCheckIn = Effect.fn("AgentService.runCheckIn")(function* (
    agentId: AgentId,
    input?: TriggerCheckInInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const delegations = listDelegations(db, agent.id, 50);
    const issues = listIssues(db, agent.id);
    const activeDelegations = delegations.filter((d) => d.status === "running").length;
    const openIssues = issues.filter(
      (issue) => issue.state !== "done" && issue.state !== "canceled",
    ).length;

    const repoStatus = yield* git.status(agent.projectPath, { github: [], gitlab: [] });
    const prList = yield* gitForge
      .listPullRequests({ projectId: agent.projectId, threadId: null })
      .pipe(Effect.option);
    const openPrs = prList._tag === "Some" ? prList.value.items.length : 0;

    const gitPart =
      repoStatus.kind === "repo"
        ? `branch ${repoStatus.branch ?? "detached"}, ${repoStatus.summary.changed} dirty file(s)`
        : "not a git repo";
    const focusPart = input?.focus?.trim() ? ` Focus: ${input.focus.trim()}.` : "";
    const summary = `${agent.name} check-in (${gitPart}): ${activeDelegations} active delegation(s), ${openPrs} open PR(s), ${openIssues} open issue(s).${focusPart}`;

    const now = new Date().toISOString();
    const checkIn: AgentCheckIn = {
      id: AgentCheckInId.make(crypto.randomUUID()),
      agentId: agent.id,
      summary,
      activeDelegations,
      openPrs,
      openIssues,
      createdAt: now,
    };
    insertCheckIn(db, checkIn);

    const nextAgent: Agent = {
      ...agent,
      lastCheckInAt: now,
      lastSummary: summary,
      updatedAt: now,
    };
    updateAgentRow(db, nextAgent);
    eventBus.publishSync({ kind: "agent.checkin.created", checkIn });
    eventBus.publishSync({ kind: "agent.upserted", agent: nextAgent });

    if (input?.promptAgent === true) {
      yield* sendAgentTurn(
        agent.id,
        { prompt: buildCheckInPrompt(checkIn, input.focus) },
        { origin: "system" },
      );
    }
    return checkIn;
  });

  return {
    handleTurnSettled,
    delegateTask,
    assignIssue,
    cancelDelegation,
    runCheckIn,
  };
};

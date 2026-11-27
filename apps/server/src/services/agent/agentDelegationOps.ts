import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDelegationKind,
  AgentIssue,
  AgentModelRole,
  AssignAgentIssueInput,
  AssignAgentIssueResult,
  CreateThreadDelegationInput,
  DelegateAgentTaskInput,
  ModelSelection,
  Project,
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
  type ThreadId,
} from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import type * as GitForgeService from "../GitForgeService.ts";
import type * as GitService from "../GitService.ts";
import type * as ProjectService from "../ProjectService.ts";
import type * as ProviderService from "../ProviderService.ts";
import type * as ThreadService from "../ThreadService.ts";
import { readThreadById } from "../threadStore.ts";
import type { makeAgentBounceOps } from "./agentBounceOps.ts";
import {
  buildThreadDelegationBrief,
  resolveDelegationModelSelection,
  settleChildDelegationOutcome,
} from "./agentBounceDispatcher.ts";
import {
  buildCheckInPrompt,
  buildDelegationBrief,
  pickDefaultModelSelection,
} from "./agentPrompts.ts";
import {
  insertCheckIn,
  listMemories,
  readAgentById,
  readAgentByPrimaryThreadId,
  updateAgentCheckInMeta,
} from "./agentStore.ts";
import {
  insertDelegation,
  listDelegations,
  listIssues,
  readActiveDelegationByChildThread,
  readDelegationByDelegationId,
  readDelegationById,
  readIssueById,
  updateDelegationRow,
  updateIssueRow,
} from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";

export const makeAgentDelegationOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly projects: ProjectService.ProjectService["Service"];
  readonly providers: ProviderService.ProviderService["Service"];
  readonly threads: ThreadService.ThreadService["Service"];
  readonly git: GitService.GitService["Service"];
  readonly gitForge: GitForgeService.GitForgeService["Service"];
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
  readonly sendAgentTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly bounceOps: Pick<
    ReturnType<typeof makeAgentBounceOps>,
    "handlePrimaryOrParentTurnSettled" | "cancelForDelegation"
  >;
}) => {
  const {
    db,
    eventBus,
    projects,
    providers,
    threads,
    git,
    gitForge,
    requireAgent,
    sendAgentTurn,
    bounceOps,
  } = deps;
  const inFlightCheckIns = new Set<AgentId>();

  const handleTurnSettled = (turn: ThreadTurn) => {
    if (turn.status === "running" || bounceOps.handlePrimaryOrParentTurnSettled(turn)) return;
    const delegation = readActiveDelegationByChildThread(db, turn.threadId);
    if (!delegation) return;
    bounceOps.cancelForDelegation(delegation.id, "Child thread settled before parent answered.", {
      restoreDelegation: false,
    });
    settleChildDelegationOutcome(db, eventBus, turn, delegation);
  };

  const delegateCore = Effect.fn("AgentService.delegateCore")(function* (input: {
    readonly parentThreadId: ThreadId;
    readonly project: Project;
    readonly agent: Agent | null;
    readonly fallbackSelection?: ModelSelection;
    readonly role: AgentModelRole;
    readonly kind: AgentDelegationKind;
    readonly title: string;
    readonly brief: string;
    readonly runtime?: CreateThreadDelegationInput["runtime"];
    readonly branch?: string;
    readonly issueId?: AgentIssueId;
    readonly modelSelection?: ModelSelection;
    readonly providerId?: CreateThreadDelegationInput["providerId"];
    readonly model?: string;
    readonly effort?: CreateThreadDelegationInput["effort"];
    readonly maxBounces?: number;
  }) {
    let linkedIssue: AgentIssue | null = null;
    if (input.issueId && input.agent) {
      linkedIssue = readIssueById(db, input.agent.id, input.issueId);
      if (!linkedIssue)
        return yield* new AgentServiceError({
          reason: "not-found",
          detail: `Issue "${input.issueId}" was not found.`,
        });
    }
    const snapshots = input.modelSelection ? [] : yield* providers.listSnapshots();
    const resolved = resolveDelegationModelSelection({
      db,
      snapshots,
      fallback:
        input.agent?.modelSelection ??
        input.fallbackSelection ??
        pickDefaultModelSelection(snapshots),
      projectId: input.project.id,
      agent: input.agent,
      role: input.role,
      ...(input.modelSelection ? { explicitSelection: input.modelSelection } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
    });
    if ("missingProviderId" in resolved) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Provider "${resolved.missingProviderId}" was not found.`,
      });
    }
    let runtime = input.runtime ?? "worktree";
    if (runtime === "worktree") {
      const repoStatus = yield* git.status(input.project.path, { github: [], gitlab: [] });
      if (repoStatus.kind !== "repo" || !repoStatus.hasCommits) runtime = "local";
    }
    const maxBounces = input.maxBounces ?? 3;
    const delegationId = AgentDelegationId.make(crypto.randomUUID());
    const childThread = yield* threads
      .createIdle({
        projectId: input.project.id,
        title: input.title,
        runtime,
        branch: input.branch?.trim() || input.project.defaultBranch,
        modelSelection: resolved,
        setupWorktree: runtime === "worktree",
      })
      .pipe(
        Effect.mapError(
          (err) => new AgentServiceError({ reason: "rejected", detail: err.message }),
        ),
      );

    const fullBrief = input.agent
      ? buildDelegationBrief({
          agent: input.agent,
          delegationId,
          maxBounces,
          role: input.role,
          kind: input.kind,
          title: input.title,
          brief: input.brief,
          pinnedMemories: listMemories(db, input.agent.id, 30).filter((m) => m.pinned),
          issue: linkedIssue,
        })
      : buildThreadDelegationBrief({
          project: input.project,
          delegationId,
          maxBounces,
          role: input.role,
          kind: input.kind,
          title: input.title,
          brief: input.brief,
        });

    const now = new Date().toISOString();
    const delegation: AgentDelegation = {
      id: delegationId,
      ...(input.agent ? { agentId: input.agent.id } : {}),
      parentThreadId: input.parentThreadId,
      childThreadId: childThread.id,
      role: input.role,
      kind: input.kind,
      title: input.title,
      brief: input.brief,
      modelSelection: resolved,
      status: "running",
      bounceCount: 0,
      maxBounces,
      ...(linkedIssue ? { issueId: linkedIssue.id } : {}),
      createdAt: now,
    };
    insertDelegation(db, delegation);
    const sendResult = yield* threads
      .sendTurn(childThread.id, { prompt: fullBrief })
      .pipe(Effect.result);
    if (sendResult._tag === "Failure") {
      yield* threads.remove(childThread.id).pipe(Effect.ignore);
      return yield* new AgentServiceError({
        reason: "rejected",
        detail: sendResult.failure.message,
      });
    }
    if (linkedIssue && input.agent) {
      const updatedIssue: AgentIssue = {
        ...linkedIssue,
        assignedThreadId: childThread.id,
        assignee:
          linkedIssue.assignee.kind === "unassigned"
            ? { kind: "agent", agentId: input.agent.id }
            : linkedIssue.assignee,
        state:
          linkedIssue.state === "backlog" || linkedIssue.state === "todo"
            ? "in_progress"
            : linkedIssue.state,
        updatedAt: now,
      };
      updateIssueRow(db, updatedIssue);
      eventBus.publishSync({ kind: "agent.issue.upserted", issue: updatedIssue });
    }
    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation });
    if (input.agent) {
      const refreshed = readAgentById(db, input.agent.id);
      if (refreshed) eventBus.publishSync({ kind: "agent.upserted", agent: refreshed });
    }
    return delegation;
  });

  const getProject = (projectId: Project["id"]) =>
    projects
      .get(projectId)
      .pipe(
        Effect.mapError(
          (err) => new AgentServiceError({ reason: "not-found", detail: err.message }),
        ),
      );

  const delegateTask = Effect.fn("AgentService.delegateTask")(function* (
    agentId: AgentId,
    input: DelegateAgentTaskInput,
  ) {
    const agent = yield* requireAgent(agentId);
    return yield* delegateCore({
      parentThreadId: agent.primaryThreadId,
      project: yield* getProject(agent.projectId),
      agent,
      role: input.role,
      kind: input.kind,
      title: input.title,
      brief: input.brief,
      ...(input.runtime ? { runtime: input.runtime } : {}),
      ...(input.issueId ? { issueId: input.issueId } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.maxBounces !== undefined ? { maxBounces: input.maxBounces } : {}),
    });
  });

  const delegateFromThread = Effect.fn("AgentService.delegateFromThread")(function* (
    parentThreadId: ThreadId,
    input: CreateThreadDelegationInput,
  ) {
    const parentThread = readThreadById(db, parentThreadId);
    if (!parentThread)
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Thread "${parentThreadId}" was not found.`,
      });
    return yield* delegateCore({
      parentThreadId: parentThread.id,
      project: yield* getProject(parentThread.projectId),
      agent: readAgentByPrimaryThreadId(db, parentThread.id),
      fallbackSelection: parentThread.modelSelection,
      role: input.role ?? "workhorse",
      kind: input.kind ?? "task",
      title: input.title,
      brief: input.brief,
      branch: input.branch ?? parentThread.branch,
      ...(input.runtime ? { runtime: input.runtime } : {}),
      ...(input.issueId ? { issueId: input.issueId } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.maxBounces !== undefined ? { maxBounces: input.maxBounces } : {}),
    });
  });

  const cancelExisting = Effect.fn("AgentService.cancelExistingDelegation")(function* (
    existing: AgentDelegation,
  ) {
    bounceOps.cancelForDelegation(existing.id, "Delegation canceled.", {
      restoreDelegation: false,
    });
    yield* threads.interrupt(existing.childThreadId).pipe(Effect.ignore);
    const latest = readDelegationByDelegationId(db, existing.id) ?? existing;
    if (latest.status !== "running" && latest.status !== "waiting_parent") return latest;
    const canceled: AgentDelegation = {
      ...latest,
      status: "canceled",
      resultSummary: latest.resultSummary ?? "Canceled by user.",
      completedAt: new Date().toISOString(),
    };
    updateDelegationRow(db, canceled);
    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: canceled });
    if (existing.agentId) {
      const refreshed = readAgentById(db, existing.agentId);
      if (refreshed) eventBus.publishSync({ kind: "agent.upserted", agent: refreshed });
    }
    return canceled;
  });

  const cancelDelegationById = Effect.fn("AgentService.cancelDelegationById")(function* (
    delegationId: AgentDelegationId,
  ) {
    const existing = readDelegationByDelegationId(db, delegationId);
    if (!existing)
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Delegation "${delegationId}" was not found.`,
      });
    return yield* cancelExisting(existing);
  });

  const cancelDelegation = Effect.fn("AgentService.cancelDelegation")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) {
    yield* requireAgent(agentId);
    const existing = readDelegationById(db, agentId, delegationId);
    if (!existing)
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Delegation "${delegationId}" was not found.`,
      });
    return yield* cancelExisting(existing);
  });

  const assignIssue = Effect.fn("AgentService.assignIssue")(function* (
    agentId: AgentId,
    issueId: AgentIssueId,
    input?: AssignAgentIssueInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const issue = readIssueById(db, agent.id, issueId);
    if (!issue)
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Issue "${issueId}" was not found.`,
      });
    if ((input?.mode ?? "pr") === "agent") {
      const updatedIssue: AgentIssue = {
        ...issue,
        assignedThreadId: agent.primaryThreadId,
        assignee: { kind: "agent", agentId: agent.id },
        state: issue.state === "backlog" || issue.state === "todo" ? "in_progress" : issue.state,
        updatedAt: new Date().toISOString(),
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
    return {
      mode: "pr",
      issue: readIssueById(db, agent.id, issue.id) ?? issue,
      delegation,
    } satisfies AssignAgentIssueResult;
  });

  const runCheckIn = Effect.fn("AgentService.runCheckIn")(function* (
    agentId: AgentId,
    input?: TriggerCheckInInput,
  ) {
    if (inFlightCheckIns.has(agentId))
      return yield* new AgentServiceError({
        reason: "rejected",
        detail: "A check-in is already running for this agent.",
      });
    inFlightCheckIns.add(agentId);
    return yield* Effect.gen(function* () {
      const agent = yield* requireAgent(agentId);
      const activeDelegations = listDelegations(db, agent.id, 50).filter(
        (d) => d.status === "running" || d.status === "waiting_parent",
      ).length;
      const openIssues = listIssues(db, agent.id).filter(
        (i) => i.state !== "done" && i.state !== "canceled",
      ).length;
      const repoStatus = yield* git.status(agent.projectPath, { github: [], gitlab: [] });
      const prList = yield* gitForge
        .listPullRequests({ projectId: agent.projectId, threadId: null })
        .pipe(Effect.option);
      const openPrs = prList._tag === "Some" ? prList.value.items.length : 0;
      const latest = readAgentById(db, agent.id) ?? agent;
      const gitPart =
        repoStatus.kind === "repo"
          ? `branch ${repoStatus.branch ?? "detached"}, ${repoStatus.summary.changed} dirty file(s)`
          : "not a git repo";
      const focusPart = input?.focus?.trim() ? ` Focus: ${input.focus.trim()}.` : "";
      const summary = `${latest.name} check-in (${gitPart}): ${activeDelegations} active delegation(s), ${openPrs} open PR(s), ${openIssues} open issue(s).${focusPart}`;
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
      updateAgentCheckInMeta(db, agent.id, {
        lastCheckInAt: now,
        lastSummary: summary,
        updatedAt: now,
      });
      const refreshed = readAgentById(db, agent.id);
      eventBus.publishSync({ kind: "agent.checkin.created", checkIn });
      if (refreshed) eventBus.publishSync({ kind: "agent.upserted", agent: refreshed });
      if (input?.promptAgent === true)
        yield* sendAgentTurn(
          agent.id,
          { prompt: buildCheckInPrompt(checkIn, input.focus) },
          { origin: "system" },
        );
      return checkIn;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          inFlightCheckIns.delete(agentId);
        }),
      ),
    );
  });

  return {
    handleTurnSettled,
    delegateTask,
    delegateFromThread,
    assignIssue,
    cancelDelegation,
    cancelDelegationById,
    runCheckIn,
  };
};

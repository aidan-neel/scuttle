import {
  EMPTY_SCOPED_MODEL_TIERS,
  type Agent,
  type AgentDetail,
  type AgentIssue,
  type AgentIssueActivity,
  type GitBranchInfo,
  type ModelSelection,
  type Project,
  type ProviderSnapshot,
  type ScopedModelTierConfigs,
  type ScuttleSkill,
  type ServerPushEvent,
  type Thread,
  type ThreadDetail,
  type ThreadTurn,
} from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { type AgentSlice, agentDetailLoaded, applyAgentEvent } from "./agentState.ts";
import { compareIsoDesc, upsertById } from "./collections.ts";
import {
  FALLBACK_SELECTION,
  pickBestSelection,
  readStoredSelection,
  writeStoredSelection,
} from "./modelSelection.ts";
import {
  applyChannelDelta,
  applyPendingTurnDeltas,
  applyThreadExtrasEvent,
  mergeThreadDetailSnapshot,
  type PendingTurnDelta,
  queuePendingDelta,
  threadIdOfExtrasEvent,
  touchThreadDetail,
} from "./threadDetailReducer.ts";

export interface WorkspaceState extends AgentSlice {
  readonly loading: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly threads: ReadonlyArray<Thread>;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly skills: ReadonlyArray<ScuttleSkill>;
  readonly modelTiers: ScopedModelTierConfigs;
  readonly threadDetails: Readonly<Record<string, ThreadDetail>>;
  readonly branchesByProject: Readonly<Record<string, ReadonlyArray<GitBranchInfo>>>;
  readonly selectedProjectId: ProjectId | null;
  readonly activeThreadId: string | null;
  readonly defaultModelSelection: ModelSelection;
  readonly error: string | null;
  readonly agentThreadIds: ReadonlySet<string>;
  readonly perfRevision: number;
}

export type Action =
  | {
      readonly kind: "loaded";
      readonly projects: ReadonlyArray<Project>;
      readonly threads: ReadonlyArray<Thread>;
      readonly providers: ReadonlyArray<ProviderSnapshot>;
      readonly agents: ReadonlyArray<Agent>;
      readonly issues?: ReadonlyArray<AgentIssue> | undefined;
      readonly skills?: ReadonlyArray<ScuttleSkill> | undefined;
      readonly modelTiers?: ScopedModelTierConfigs | undefined;
    }
  | { readonly kind: "error"; readonly message: string | null }
  | { readonly kind: "selectProject"; readonly projectId: ProjectId | null }
  | { readonly kind: "setActiveThread"; readonly threadId: string | null }
  | { readonly kind: "setModelSelection"; readonly selection: ModelSelection }
  | { readonly kind: "reconcileModelSelection" }
  | {
      readonly kind: "branchesLoaded";
      readonly projectId: string;
      readonly branches: ReadonlyArray<GitBranchInfo>;
    }
  | { readonly kind: "threadDetailLoaded"; readonly detail: ThreadDetail }
  | { readonly kind: "agentDetailLoaded"; readonly detail: AgentDetail }
  | {
      readonly kind: "issueActivitiesLoaded";
      readonly issueId: string;
      readonly activities: ReadonlyArray<AgentIssueActivity>;
    }
  | { readonly kind: "push"; readonly event: ServerPushEvent }
  | { readonly kind: "pushBatch"; readonly events: ReadonlyArray<ServerPushEvent> };

export const createInitialWorkspaceState = (): WorkspaceState => ({
  loading: true,
  projects: [],
  threads: [],
  providers: [],
  skills: [],
  modelTiers: EMPTY_SCOPED_MODEL_TIERS,
  threadDetails: {},
  agents: [],
  agentWork: {},
  issues: [],
  issueActivities: {},
  branchesByProject: {},
  selectedProjectId: null,
  activeThreadId: null,
  defaultModelSelection: readStoredSelection() ?? FALLBACK_SELECTION,
  error: null,
  agentThreadIds: new Set<string>(),
  perfRevision: 0,
});

const computeAgentThreadIds = (agents: ReadonlyArray<Agent>): ReadonlySet<string> =>
  new Set(agents.map((agent) => agent.primaryThreadId));

const upsertThreadSorted = (
  threads: ReadonlyArray<Thread>,
  nextThread: Thread,
): ReadonlyArray<Thread> => {
  const index = threads.findIndex((thread) => thread.id === nextThread.id);
  if (index === -1) {
    const first = threads[0];
    if (first === undefined || nextThread.updatedAt >= first.updatedAt) {
      return [nextThread, ...threads];
    }
    return [nextThread, ...threads].toSorted((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));
  }

  const prev = threads[index];
  const before = index > 0 ? threads[index - 1] : undefined;
  const after = index < threads.length - 1 ? threads[index + 1] : undefined;
  const unchangedOrder =
    prev?.updatedAt === nextThread.updatedAt ||
    ((before === undefined || before.updatedAt >= nextThread.updatedAt) &&
      (after === undefined || nextThread.updatedAt >= after.updatedAt));

  if (unchangedOrder) {
    const copy = [...threads];
    copy[index] = nextThread;
    return copy;
  }

  const copy = [...threads];
  copy[index] = nextThread;
  return copy.toSorted((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));
};

const flushPendingDeltas = (
  state: WorkspaceState,
  pendingByThread: Map<string, Map<string, PendingTurnDelta>>,
): WorkspaceState => {
  const nextThreadDetails = applyPendingTurnDeltas(
    state.threadDetails,
    state.activeThreadId,
    pendingByThread,
  );
  return nextThreadDetails === state.threadDetails
    ? state
    : { ...state, threadDetails: nextThreadDetails };
};

const applyCoreEvent = (state: WorkspaceState, event: ServerPushEvent): WorkspaceState => {
  switch (event.kind) {
    case "project.upserted": {
      const projects = upsertById(state.projects, event.project, true);
      const selectedProjectId = state.selectedProjectId ?? event.project.id;
      return { ...state, projects, selectedProjectId };
    }
    case "project.deleted": {
      const projects = state.projects.filter((p) => p.id !== event.projectId);
      const threads = state.threads.filter((t) => t.projectId !== event.projectId);
      const selectedProjectId =
        state.selectedProjectId === event.projectId
          ? (projects[0]?.id ?? null)
          : state.selectedProjectId;
      return { ...state, projects, threads, selectedProjectId };
    }
    case "thread.upserted": {
      const threads = upsertThreadSorted(state.threads, event.thread);
      const existingDetail = state.threadDetails[event.thread.id];
      const threadDetails = existingDetail
        ? touchThreadDetail(
            state.threadDetails,
            event.thread.id,
            {
              ...existingDetail,
              thread: event.thread,
            },
            state.activeThreadId,
          )
        : state.threadDetails;
      return { ...state, threads, threadDetails };
    }
    case "thread.deleted": {
      const threads = state.threads.filter((t) => t.id !== event.threadId);
      const { [event.threadId]: _removed, ...restDetails } = state.threadDetails;
      return { ...state, threads, threadDetails: restDetails };
    }
    case "turn.upserted": {
      const detail = state.threadDetails[event.turn.threadId];
      if (!detail) return state;
      const turns = upsertById(detail.turns, event.turn, false);
      return {
        ...state,
        threadDetails: touchThreadDetail(
          state.threadDetails,
          event.turn.threadId,
          {
            ...detail,
            turns,
          },
          state.activeThreadId,
        ),
      };
    }
    case "turn.delta": {
      const detail = state.threadDetails[event.threadId];
      if (!detail) return state;
      let changed = false;
      const turns = detail.turns.map((turn): ThreadTurn => {
        if (turn.id !== event.turnId) return turn;
        if (event.channel === "assistant") {
          const next = applyChannelDelta(turn.assistantMessage, event.delta, event.offset);
          if (next === turn.assistantMessage) return turn;
          changed = true;
          return { ...turn, assistantMessage: next };
        }
        const next = applyChannelDelta(turn.thinkingText, event.delta, event.offset);
        if (next === turn.thinkingText) return turn;
        changed = true;
        return { ...turn, thinkingText: next };
      });
      if (!changed) return state;
      return {
        ...state,
        threadDetails: touchThreadDetail(
          state.threadDetails,
          event.threadId,
          {
            ...detail,
            turns,
          },
          state.activeThreadId,
        ),
      };
    }
    case "turn.activity": {
      const detail = state.threadDetails[event.activity.threadId];
      if (!detail) return state;
      let changed = false;
      const turns = detail.turns.map((turn): ThreadTurn => {
        if (turn.id !== event.activity.turnId) return turn;
        changed = true;
        return { ...turn, activities: [...upsertById(turn.activities, event.activity, false)] };
      });
      if (!changed) return state;
      return {
        ...state,
        threadDetails: touchThreadDetail(
          state.threadDetails,
          event.activity.threadId,
          {
            ...detail,
            turns,
          },
          state.activeThreadId,
        ),
      };
    }
    case "approval.updated": {
      const detail = state.threadDetails[event.approval.threadId];
      if (!detail) return state;
      let changed = false;
      const turns = detail.turns.map((turn): ThreadTurn => {
        if (turn.id !== event.approval.turnId) return turn;
        changed = true;
        return { ...turn, approvals: [...upsertById(turn.approvals, event.approval, false)] };
      });
      if (!changed) return state;
      return {
        ...state,
        threadDetails: touchThreadDetail(
          state.threadDetails,
          event.approval.threadId,
          {
            ...detail,
            turns,
          },
          state.activeThreadId,
        ),
      };
    }
    case "provider.updated": {
      const providers = upsertById(state.providers, event.provider, false);
      const defaultModelSelection = pickBestSelection(
        providers,
        readStoredSelection() ?? state.defaultModelSelection,
      );
      return { ...state, providers, defaultModelSelection };
    }
    case "modelTiers.updated":
      return { ...state, modelTiers: event.modelTiers };
    case "perf.recorded":
      return { ...state, perfRevision: state.perfRevision + 1 };
    default: {
      const threadId = threadIdOfExtrasEvent(event);
      const detail = threadId === null ? undefined : state.threadDetails[threadId];
      if (threadId === null || detail === undefined) return state;
      const next = applyThreadExtrasEvent(detail, event);
      if (next === detail) return state;
      return {
        ...state,
        threadDetails: touchThreadDetail(state.threadDetails, threadId, next, state.activeThreadId),
      };
    }
  }
};

const applyPushEvent = (state: WorkspaceState, event: ServerPushEvent): WorkspaceState => {
  const agentSlice = applyAgentEvent(state, event);
  if (agentSlice === state) {
    return applyCoreEvent(state, event);
  }
  const withAgentSlice: WorkspaceState = {
    ...state,
    ...agentSlice,
    agentThreadIds:
      agentSlice.agents === state.agents
        ? state.agentThreadIds
        : computeAgentThreadIds(agentSlice.agents),
  };
  return applyCoreEvent(withAgentSlice, event);
};

const applyPushBatch = (
  state: WorkspaceState,
  events: ReadonlyArray<ServerPushEvent>,
): WorkspaceState => {
  if (events.length === 0) return state;
  let nextState = state;
  const pendingByThread = new Map<string, Map<string, PendingTurnDelta>>();

  for (const event of events) {
    if (event.kind === "turn.delta") {
      if (
        !queuePendingDelta(
          pendingByThread,
          event.threadId,
          event.turnId,
          event.channel,
          event.delta,
          event.offset,
        )
      ) {
        nextState = flushPendingDeltas(nextState, pendingByThread);
        queuePendingDelta(
          pendingByThread,
          event.threadId,
          event.turnId,
          event.channel,
          event.delta,
          event.offset,
        );
      }
      continue;
    }

    nextState = flushPendingDeltas(nextState, pendingByThread);
    nextState = applyPushEvent(nextState, event);
  }

  return flushPendingDeltas(nextState, pendingByThread);
};

export const reduceWorkspaceState = (state: WorkspaceState, action: Action): WorkspaceState => {
  switch (action.kind) {
    case "loaded": {
      const selectedProjectId =
        state.selectedProjectId && action.projects.some((p) => p.id === state.selectedProjectId)
          ? state.selectedProjectId
          : (action.projects[0]?.id ?? null);
      const defaultModelSelection = pickBestSelection(
        action.providers,
        readStoredSelection() ?? state.defaultModelSelection,
      );
      return {
        ...state,
        loading: false,
        projects: action.projects,
        threads: action.threads,
        providers: action.providers,
        agents: action.agents,
        issues: action.issues ?? state.issues,
        skills: action.skills ?? state.skills,
        modelTiers: action.modelTiers ?? state.modelTiers,
        agentThreadIds: computeAgentThreadIds(action.agents),
        selectedProjectId,
        defaultModelSelection,
        error: null,
      };
    }
    case "error":
      return { ...state, loading: false, error: action.message };
    case "selectProject":
      return { ...state, selectedProjectId: action.projectId };
    case "setActiveThread":
      return state.activeThreadId === action.threadId
        ? state
        : { ...state, activeThreadId: action.threadId };
    case "setModelSelection":
      writeStoredSelection(action.selection);
      return { ...state, defaultModelSelection: action.selection };
    case "reconcileModelSelection": {
      const next = pickBestSelection(
        state.providers,
        readStoredSelection() ?? state.defaultModelSelection,
      );
      if (
        next.providerId === state.defaultModelSelection.providerId &&
        next.model === state.defaultModelSelection.model &&
        next.effort === state.defaultModelSelection.effort
      ) {
        return state;
      }
      writeStoredSelection(next);
      return { ...state, defaultModelSelection: next };
    }
    case "branchesLoaded":
      return {
        ...state,
        branchesByProject: { ...state.branchesByProject, [action.projectId]: action.branches },
      };
    case "threadDetailLoaded": {
      const merged = mergeThreadDetailSnapshot(
        state.threadDetails[action.detail.thread.id],
        action.detail,
      );
      return {
        ...state,
        threads: upsertById(state.threads, merged.thread, true),
        threadDetails: touchThreadDetail(
          state.threadDetails,
          merged.thread.id,
          merged,
          state.activeThreadId,
        ),
      };
    }
    case "agentDetailLoaded": {
      const primary = mergeThreadDetailSnapshot(
        state.threadDetails[action.detail.primaryThread.thread.id],
        action.detail.primaryThread,
      );
      const agentSlice = agentDetailLoaded(state, action.detail);
      return {
        ...state,
        ...agentSlice,
        agentThreadIds: computeAgentThreadIds(agentSlice.agents),
        threads: upsertById(state.threads, primary.thread, true),
        threadDetails: touchThreadDetail(
          state.threadDetails,
          primary.thread.id,
          primary,
          state.activeThreadId,
        ),
      };
    }
    case "issueActivitiesLoaded":
      return {
        ...state,
        issueActivities: {
          ...state.issueActivities,
          [action.issueId]: action.activities,
        },
      };
    case "push":
      return applyPushEvent(state, action.event);
    case "pushBatch":
      return applyPushBatch(state, action.events);
  }
};

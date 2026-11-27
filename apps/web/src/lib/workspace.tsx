import {
  createScuttleApiClient,
  createWsSupervisor,
  type ScuttleApiClient,
  type WsSupervisorHandle,
} from "@scuttle/client-runtime";
import type {
  CompactThreadInput,
  CompactThreadResult,
  CreateThreadInput,
  DirectoryListing,
  EditQueuedTurnInput,
  GitBranchInfo,
  ModelPerfQueryInput,
  ModelPerfRun,
  ModelPerformanceSummary,
  ModelSelection,
  ModelTierConfig,
  ModelTierScope,
  Project,
  ProviderConfigPatch,
  ProviderSnapshot,
  QueuedTurn,
  RateModelRunInput,
  RespondApprovalInput,
  RewindThreadInput,
  RewindThreadResult,
  ScopedModelTierConfigs,
  ScuttleSkillDetail,
  SendTurnInput,
  SendTurnResult,
  ServerPushEvent,
  Thread,
  ThreadDetail,
  UpdateThreadInput,
} from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { type AgentActions, createAgentActions } from "./agentActions.ts";
import { getDesktopBridge } from "./desktopBridge.ts";
import { applyRewindResult } from "./threadDetailReducer.ts";
import { createInitialWorkspaceState, type WorkspaceState } from "./workspaceReducer.ts";
import { createWorkspaceStore, type WorkspaceStore } from "./workspaceStore.ts";

export type { WorkspaceState } from "./workspaceReducer.ts";

export interface WorkspaceActions extends AgentActions {
  readonly selectProject: (projectId: ProjectId | null) => void;
  readonly setActiveThread: (threadId: string | null) => void;
  readonly setDefaultModelSelection: (selection: ModelSelection) => void;
  readonly reconcileDefaultModelSelection: () => void;
  readonly refreshWorkspace: () => Promise<void>;
  readonly loadBranches: (projectId: ProjectId) => Promise<ReadonlyArray<GitBranchInfo>>;
  readonly addProject: (path: string, name?: string) => Promise<Project>;
  readonly deleteProject: (projectId: ProjectId) => Promise<void>;
  readonly listDirectory: (
    dirPath?: string,
    options?: { readonly includeFiles?: boolean },
  ) => Promise<DirectoryListing>;
  readonly loadThreadDetail: (threadId: string) => Promise<ThreadDetail>;
  readonly createThread: (input: CreateThreadInput) => Promise<ThreadDetail>;
  readonly sendTurn: (threadId: string, input: SendTurnInput) => Promise<SendTurnResult>;
  readonly rewindThread: (
    threadId: string,
    input: RewindThreadInput,
  ) => Promise<RewindThreadResult>;
  readonly editQueuedTurn: (
    threadId: string,
    queuedId: string,
    input: EditQueuedTurnInput,
  ) => Promise<QueuedTurn>;
  readonly cancelQueuedTurn: (threadId: string, queuedId: string) => Promise<void>;
  readonly promoteQueuedTurn: (threadId: string, queuedId: string) => Promise<SendTurnResult>;
  readonly getPerformanceSummary: (query?: ModelPerfQueryInput) => Promise<ModelPerformanceSummary>;
  readonly rateModelRun: (input: RateModelRunInput) => Promise<ModelPerfRun>;
  readonly deletePerformanceRun: (runId: string) => Promise<void>;
  readonly interruptTurn: (threadId: string) => Promise<void>;
  readonly settleThread: (threadId: string, settled: boolean) => Promise<Thread>;
  readonly compactThread: (
    threadId: string,
    input?: CompactThreadInput,
  ) => Promise<CompactThreadResult>;
  readonly updateThread: (threadId: string, input: UpdateThreadInput) => Promise<Thread>;
  readonly deleteThread: (threadId: string) => Promise<void>;
  readonly respondApproval: (
    threadId: string,
    approvalId: string,
    input: RespondApprovalInput,
  ) => Promise<void>;
  readonly refreshProviders: () => Promise<ReadonlyArray<ProviderSnapshot>>;
  readonly updateProvider: (
    providerId: string,
    patch: ProviderConfigPatch,
  ) => Promise<ProviderSnapshot>;
  readonly getSkillDetail: (id: string, file?: string) => Promise<ScuttleSkillDetail>;
  readonly updateModelTiers: (
    scope: ModelTierScope,
    config: ModelTierConfig,
  ) => Promise<ScopedModelTierConfigs>;
}

export interface Workspace extends WorkspaceState, WorkspaceActions {}

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

interface WorkspaceController {
  readonly store: WorkspaceStore;
  readonly actions: WorkspaceActions;
  readonly setBaseUrl: (baseUrl: string | undefined) => void;
  readonly setSupervisor: (supervisor: WsSupervisorHandle | null) => void;
  readonly fetchWorkspace: () => Promise<boolean>;
}

const createWorkspaceController = (): WorkspaceController => {
  let api: ScuttleApiClient = createScuttleApiClient();
  let wsSupervisor: WsSupervisorHandle | null = null;
  const store = createWorkspaceStore(createInitialWorkspaceState());

  const fetchWorkspace = async (): Promise<boolean> => {
    try {
      const snapshot = await api.getWorkspace();
      store.dispatch({
        kind: "loaded",
        projects: snapshot.projects,
        threads: snapshot.threads,
        providers: snapshot.providers,
        agents: snapshot.agents,
        issues: snapshot.issues,
        skills: snapshot.skills,
        modelTiers: snapshot.modelTiers,
      });
      return true;
    } catch (error) {
      store.dispatch({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load workspace.",
      });
      return false;
    }
  };

  const replaceQueue = (
    threadId: string,
    update: (queued: ReadonlyArray<QueuedTurn>) => ReadonlyArray<QueuedTurn>,
  ) => {
    const detail = store.getState().threadDetails[threadId];
    if (detail === undefined) return;
    store.dispatch({
      kind: "push",
      event: {
        kind: "queue.updated",
        threadId: detail.thread.id,
        queuedTurns: update(detail.queuedTurns ?? []),
      },
    });
  };

  const applyDispatchResult = (threadId: string, result: SendTurnResult) => {
    if (result.kind === "queued") {
      const item = result.queuedTurn;
      replaceQueue(threadId, (queued) => [...queued.filter((q) => q.id !== item.id), item]);
      return;
    }
    store.dispatch({ kind: "push", event: { kind: "turn.upserted", turn: result.turn } });
  };

  const agentActions = createAgentActions(() => api, {
    onEvent: (event) => store.dispatch({ kind: "push", event }),
    onDetail: (detail) => {
      wsSupervisor?.flush();
      store.dispatch({ kind: "agentDetailLoaded", detail });
    },
    onIssueActivities: (issueId, activities) =>
      store.dispatch({ kind: "issueActivitiesLoaded", issueId, activities }),
  });

  const actions: WorkspaceActions = {
    ...agentActions,
    selectProject: (projectId) => store.dispatch({ kind: "selectProject", projectId }),
    setActiveThread: (threadId) => store.dispatch({ kind: "setActiveThread", threadId }),
    setDefaultModelSelection: (selection) =>
      store.dispatch({ kind: "setModelSelection", selection }),
    reconcileDefaultModelSelection: () => store.dispatch({ kind: "reconcileModelSelection" }),
    refreshWorkspace: async () => {
      await fetchWorkspace();
    },
    loadBranches: async (projectId) => {
      const branches = await api.listBranches(projectId);
      store.dispatch({ kind: "branchesLoaded", projectId, branches });
      return branches;
    },
    addProject: async (path, name) => {
      const project = await api.createProject({
        path,
        ...(name !== undefined && name.trim().length > 0 ? { name } : {}),
      });
      store.dispatch({ kind: "push", event: { kind: "project.upserted", project } });
      store.dispatch({ kind: "selectProject", projectId: project.id });
      return project;
    },
    deleteProject: async (projectId) => {
      await api.deleteProject(projectId);
      store.dispatch({ kind: "push", event: { kind: "project.deleted", projectId } });
    },
    listDirectory: (dirPath, options) => api.listDirectory(dirPath, options),
    loadThreadDetail: async (threadId) => {
      const detail = await api.getThreadDetail(threadId);
      wsSupervisor?.flush();
      store.dispatch({ kind: "threadDetailLoaded", detail });
      return detail;
    },
    createThread: async (input) => {
      const detail = await api.createThread(input);
      wsSupervisor?.flush();
      store.dispatch({ kind: "threadDetailLoaded", detail });
      return detail;
    },
    sendTurn: async (threadId, input) => {
      const result = await api.sendTurn(threadId, input);
      applyDispatchResult(threadId, result);
      return result;
    },
    rewindThread: async (threadId, input) => {
      const result = await api.rewindThread(threadId, input);
      const existing = store.getState().threadDetails[threadId];
      store.dispatch({
        kind: "threadDetailLoaded",
        detail: applyRewindResult(existing ?? { thread: result.thread, turns: [] }, result),
      });
      return result;
    },
    editQueuedTurn: async (threadId, queuedId, input) => {
      const updated = await api.editQueuedTurn(threadId, queuedId, input);
      replaceQueue(threadId, (queued) => queued.map((q) => (q.id === updated.id ? updated : q)));
      return updated;
    },
    cancelQueuedTurn: async (threadId, queuedId) => {
      await api.cancelQueuedTurn(threadId, queuedId);
      replaceQueue(threadId, (queued) => queued.filter((q) => q.id !== queuedId));
    },
    promoteQueuedTurn: async (threadId, queuedId) => {
      const result = await api.promoteQueuedTurn(threadId, queuedId);
      if (result.kind === "queued") {
        replaceQueue(threadId, (queued) =>
          queued.map((q) => (q.id === result.queuedTurn.id ? result.queuedTurn : q)),
        );
      } else {
        replaceQueue(threadId, (queued) => queued.filter((q) => q.id !== queuedId));
        store.dispatch({ kind: "push", event: { kind: "turn.upserted", turn: result.turn } });
      }
      return result;
    },
    getPerformanceSummary: (query) => api.getPerformanceSummary(query),
    rateModelRun: (input) => api.rateModelRun(input),
    deletePerformanceRun: (runId) => api.deletePerformanceRun(runId),
    interruptTurn: (threadId) => api.interruptTurn(threadId),
    settleThread: async (threadId, settled) => {
      const thread = await api.settleThread(threadId, { settled });
      store.dispatch({ kind: "push", event: { kind: "thread.upserted", thread } });
      return thread;
    },
    compactThread: async (threadId, input) => {
      const result = await api.compactThread(threadId, input);
      store.dispatch({ kind: "push", event: { kind: "thread.upserted", thread: result.thread } });
      return result;
    },
    updateThread: async (threadId, input) => {
      const thread = await api.updateThread(threadId, input);
      store.dispatch({ kind: "push", event: { kind: "thread.upserted", thread } });
      return thread;
    },
    deleteThread: async (threadId) => {
      await api.deleteThread(threadId);
    },
    respondApproval: (threadId, approvalId, input) =>
      api.respondApproval(threadId, approvalId, input),
    refreshProviders: async () => {
      const providers = await api.refreshProviders();
      for (const provider of providers) {
        store.dispatch({ kind: "push", event: { kind: "provider.updated", provider } });
      }
      return providers;
    },
    updateProvider: async (providerId, patch) => {
      const provider = await api.updateProvider(providerId, patch);
      store.dispatch({ kind: "push", event: { kind: "provider.updated", provider } });
      return provider;
    },
    getSkillDetail: (id, file) => api.getSkillDetail(id, file),
    updateModelTiers: async (scope, config) => {
      const modelTiers = await api.updateModelTiers(scope, config);
      store.dispatch({ kind: "push", event: { kind: "modelTiers.updated", modelTiers } });
      return modelTiers;
    },
  };

  return {
    store,
    actions,
    setBaseUrl: (baseUrl) => {
      api = createScuttleApiClient(baseUrl);
    },
    setSupervisor: (supervisor) => {
      wsSupervisor = supervisor;
    },
    fetchWorkspace,
  };
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [{ store, actions, setBaseUrl, setSupervisor, fetchWorkspace }] =
    useState(createWorkspaceController);

  useEffect(() => {
    let active = true;
    let supervisor: WsSupervisorHandle | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let fetchInFlight = false;
    let hasLoadedOnce = false;
    let pendingRefresh = false;
    let bufferedEvents: Array<ServerPushEvent> = [];

    const dispatchEvents = (events: ReadonlyArray<ServerPushEvent>) => {
      store.dispatch({ kind: "pushBatch", events });
      for (const event of events) {
        if (event.kind !== "thread.rewound") continue;
        if (store.getState().threadDetails[event.threadId] === undefined) continue;
        void actions.loadThreadDetail(event.threadId).catch(() => undefined);
      }
    };

    const clearFallbackTimer = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const loadInitialOrRefresh = async () => {
      if (!active) return;
      if (fetchInFlight) {
        pendingRefresh = true;
        return;
      }
      fetchInFlight = true;
      try {
        const ok = await fetchWorkspace();
        if (!active) return;
        if (ok) {
          hasLoadedOnce = true;
          if (bufferedEvents.length > 0) {
            const drained = bufferedEvents;
            bufferedEvents = [];
            dispatchEvents(drained);
          }
        }
      } finally {
        fetchInFlight = false;
        if (active && pendingRefresh) {
          pendingRefresh = false;
          void loadInitialOrRefresh();
        }
      }
    };

    const bootstrap = async () => {
      const bridge = getDesktopBridge();
      const baseUrl = bridge === null ? undefined : (await bridge.getDesktopInfo()).serverUrl;
      if (!active) return;
      setBaseUrl(baseUrl);
      supervisor = createWsSupervisor({
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        onEvents: (events) => {
          if (!hasLoadedOnce) {
            bufferedEvents.push(...events);
            return;
          }
          dispatchEvents(events);
        },
        onOpen: ({ isReconnect }) => {
          clearFallbackTimer();
          if (isReconnect || (!hasLoadedOnce && !fetchInFlight)) {
            void loadInitialOrRefresh();
          }
        },
      });
      setSupervisor(supervisor);
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!active || hasLoadedOnce || fetchInFlight) return;
        void loadInitialOrRefresh();
      }, 250);
    };

    void bootstrap();
    return () => {
      active = false;
      clearFallbackTimer();
      setSupervisor(null);
      supervisor?.close();
    };
  }, [store, actions, setBaseUrl, setSupervisor, fetchWorkspace]);

  return (
    <WorkspaceStoreContext value={store}>
      <WorkspaceActionsContext value={actions}>{children}</WorkspaceActionsContext>
    </WorkspaceStoreContext>
  );
}

const useWorkspaceStore = (): WorkspaceStore => {
  const store = use(WorkspaceStoreContext);
  if (store === null) {
    throw new Error("useWorkspaceStore must be called inside <WorkspaceProvider>.");
  }
  return store;
};

export function useWorkspaceActions(): WorkspaceActions {
  const actions = use(WorkspaceActionsContext);
  if (actions === null) {
    throw new Error("useWorkspaceActions must be called inside <WorkspaceProvider>.");
  }
  return actions;
}

export function useWorkspaceSelector<T>(selector: (state: WorkspaceState) => T): T {
  const store = useWorkspaceStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useThreadDetail(threadId: string): ThreadDetail | undefined {
  return useWorkspaceSelector((state) => state.threadDetails[threadId]);
}

export function useWorkspace(): Workspace {
  const state = useWorkspaceSelector((s) => s);
  const actions = useWorkspaceActions();
  return { ...state, ...actions };
}

import {
  createScuttleApiClient,
  createWsSupervisor,
  type ScuttleApiClient,
} from "@scuttle/client-runtime";
import type {
  CompactThreadInput,
  CompactThreadResult,
  CreateThreadInput,
  DirectoryListing,
  GitBranchInfo,
  ModelSelection,
  Project,
  ProviderConfigPatch,
  ProviderSnapshot,
  RespondApprovalInput,
  SendTurnInput,
  Thread,
  ThreadDetail,
  ThreadTurn,
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
import { createInitialWorkspaceState, type WorkspaceState } from "./workspaceReducer.ts";
import { createWorkspaceStore, type WorkspaceStore } from "./workspaceStore.ts";

export type { WorkspaceState } from "./workspaceReducer.ts";

export interface WorkspaceActions extends AgentActions {
  readonly selectProject: (projectId: ProjectId | null) => void;
  readonly setDefaultModelSelection: (selection: ModelSelection) => void;
  readonly refreshWorkspace: () => Promise<void>;
  readonly loadBranches: (projectId: ProjectId) => Promise<ReadonlyArray<GitBranchInfo>>;
  readonly addProject: (path: string, name?: string) => Promise<Project>;
  readonly deleteProject: (projectId: ProjectId) => Promise<void>;
  readonly listDirectory: (dirPath?: string) => Promise<DirectoryListing>;
  readonly loadThreadDetail: (threadId: string) => Promise<ThreadDetail>;
  readonly createThread: (input: CreateThreadInput) => Promise<ThreadDetail>;
  readonly sendTurn: (threadId: string, input: SendTurnInput) => Promise<ThreadTurn>;
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
}

export interface Workspace extends WorkspaceState, WorkspaceActions {}

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

interface WorkspaceController {
  readonly store: WorkspaceStore;
  readonly actions: WorkspaceActions;
  readonly setBaseUrl: (baseUrl: string | undefined) => void;
  readonly refreshWorkspace: () => Promise<void>;
}

const createWorkspaceController = (): WorkspaceController => {
  let api: ScuttleApiClient = createScuttleApiClient();
  const store = createWorkspaceStore(createInitialWorkspaceState());

  const refreshWorkspace = async () => {
    try {
      const snapshot = await api.getWorkspace();
      store.dispatch({
        kind: "loaded",
        projects: snapshot.projects,
        threads: snapshot.threads,
        providers: snapshot.providers,
        agents: snapshot.agents,
      });
    } catch (error) {
      store.dispatch({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load workspace.",
      });
    }
  };

  const agentActions = createAgentActions(() => api, {
    onEvent: (event) => store.dispatch({ kind: "push", event }),
    onDetail: (detail) => store.dispatch({ kind: "agentDetailLoaded", detail }),
  });

  const actions: WorkspaceActions = {
    ...agentActions,
    selectProject: (projectId) => store.dispatch({ kind: "selectProject", projectId }),
    setDefaultModelSelection: (selection) =>
      store.dispatch({ kind: "setModelSelection", selection }),
    refreshWorkspace,
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
    listDirectory: (dirPath) => api.listDirectory(dirPath),
    loadThreadDetail: async (threadId) => {
      const detail = await api.getThreadDetail(threadId);
      store.dispatch({ kind: "threadDetailLoaded", detail });
      return detail;
    },
    createThread: async (input) => {
      const detail = await api.createThread(input);
      store.dispatch({ kind: "threadDetailLoaded", detail });
      return detail;
    },
    sendTurn: async (threadId, input) => {
      const turn = await api.sendTurn(threadId, input);
      store.dispatch({ kind: "push", event: { kind: "turn.upserted", turn } });
      return turn;
    },
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
  };

  return {
    store,
    actions,
    setBaseUrl: (baseUrl) => {
      api = createScuttleApiClient(baseUrl);
    },
    refreshWorkspace,
  };
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [{ store, actions, setBaseUrl, refreshWorkspace }] = useState(createWorkspaceController);

  useEffect(() => {
    let active = true;
    let supervisor: ReturnType<typeof createWsSupervisor> | null = null;

    const bootstrap = async () => {
      const bridge = getDesktopBridge();
      const baseUrl = bridge === null ? undefined : (await bridge.getDesktopInfo()).serverUrl;
      if (!active) return;
      setBaseUrl(baseUrl);
      await refreshWorkspace();
      if (!active) return;
      supervisor = createWsSupervisor({
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        onEvents: (events) => {
          store.dispatch({ kind: "pushBatch", events });
        },
        onOpen: ({ isReconnect }) => {
          if (isReconnect) {
            void refreshWorkspace();
          }
        },
      });
    };

    void bootstrap();
    return () => {
      active = false;
      supervisor?.close();
    };
  }, [store, setBaseUrl, refreshWorkspace]);

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

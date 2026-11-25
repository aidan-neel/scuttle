import {
  createScuttleApiClient,
  createWsSupervisor,
  type ScuttleApiClient,
} from "@scuttle/client-runtime";
import type {
  CreateThreadInput,
  DirectoryListing,
  GitBranchInfo,
  ModelSelection,
  Project,
  ProviderConfigPatch,
  ProviderSnapshot,
  RespondApprovalInput,
  SendTurnInput,
  ServerPushEvent,
  Thread,
  ThreadDetail,
  ThreadTurn,
  UpdateThreadInput,
} from "@scuttle/contracts";
import { type ProjectId, ProviderId } from "@scuttle/shared/ids";
import { createContext, type ReactNode, use, useEffect, useReducer, useRef } from "react";
import { getDesktopBridge } from "./desktopBridge.ts";

const MODEL_STORAGE_KEY = "scuttle.defaultModelSelection.v1";

const FALLBACK_SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};

const readStoredSelection = (): ModelSelection | null => {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "providerId" in parsed &&
      "providerKind" in parsed &&
      "model" in parsed &&
      typeof parsed.providerId === "string" &&
      typeof parsed.providerKind === "string" &&
      typeof parsed.model === "string"
    ) {
      return parsed as ModelSelection;
    }
    return null;
  } catch {
    return null;
  }
};

const pickBestSelection = (
  providers: ReadonlyArray<ProviderSnapshot>,
  preferred: ModelSelection | null,
): ModelSelection => {
  if (preferred) {
    const match = providers.find((p) => p.id === preferred.providerId && p.enabled);
    if (match && match.status === "ready") {
      const model =
        match.models.find((m) => m.slug === preferred.model) ??
        match.models.find((m) => m.isDefault) ??
        match.models[0];
      if (model) {
        const effort =
          preferred.effort && model.efforts.includes(preferred.effort)
            ? preferred.effort
            : (model.defaultEffort ?? model.efforts[0]);
        return {
          providerId: match.id,
          providerKind: match.kind,
          model: model.slug,
          ...(effort ? { effort } : {}),
        };
      }
    }
  }
  const ready =
    providers.find((p) => p.enabled && p.status === "ready") ??
    providers.find((p) => p.enabled) ??
    providers[0];
  if (!ready) return preferred ?? FALLBACK_SELECTION;
  const model =
    ready.models.find((m) => m.slug === ready.defaultModel) ??
    ready.models.find((m) => m.isDefault) ??
    ready.models[0];
  if (!model) return preferred ?? FALLBACK_SELECTION;
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

interface WorkspaceState {
  readonly loading: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly threads: ReadonlyArray<Thread>;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly threadDetails: Readonly<Record<string, ThreadDetail>>;
  readonly branchesByProject: Readonly<Record<string, ReadonlyArray<GitBranchInfo>>>;
  readonly selectedProjectId: ProjectId | null;
  readonly defaultModelSelection: ModelSelection;
  readonly error: string | null;
}

type Action =
  | {
      readonly kind: "loaded";
      readonly projects: ReadonlyArray<Project>;
      readonly threads: ReadonlyArray<Thread>;
      readonly providers: ReadonlyArray<ProviderSnapshot>;
    }
  | { readonly kind: "error"; readonly message: string | null }
  | { readonly kind: "selectProject"; readonly projectId: ProjectId | null }
  | { readonly kind: "setModelSelection"; readonly selection: ModelSelection }
  | {
      readonly kind: "branchesLoaded";
      readonly projectId: string;
      readonly branches: ReadonlyArray<GitBranchInfo>;
    }
  | { readonly kind: "threadDetailLoaded"; readonly detail: ThreadDetail }
  | { readonly kind: "push"; readonly event: ServerPushEvent };

const upsertById = <T extends { readonly id: string }>(
  items: ReadonlyArray<T>,
  next: T,
  prepend = true,
): ReadonlyArray<T> => {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return prepend ? [next, ...items] : [...items, next];
  const copy = [...items];
  copy[index] = next;
  return copy;
};

const applyPushEvent = (state: WorkspaceState, event: ServerPushEvent): WorkspaceState => {
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
      const threads = upsertById(state.threads, event.thread, true).toSorted((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const existingDetail = state.threadDetails[event.thread.id];
      const threadDetails = existingDetail
        ? {
            ...state.threadDetails,
            [event.thread.id]: { ...existingDetail, thread: event.thread },
          }
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
        threadDetails: {
          ...state.threadDetails,
          [event.turn.threadId]: { ...detail, turns },
        },
      };
    }
    case "turn.delta": {
      const detail = state.threadDetails[event.threadId];
      if (!detail) return state;
      const turns = detail.turns.map((turn): ThreadTurn => {
        if (turn.id !== event.turnId) return turn;
        return event.channel === "assistant"
          ? { ...turn, assistantMessage: turn.assistantMessage + event.delta }
          : { ...turn, thinkingText: turn.thinkingText + event.delta };
      });
      return {
        ...state,
        threadDetails: {
          ...state.threadDetails,
          [event.threadId]: { ...detail, turns },
        },
      };
    }
    case "turn.activity": {
      const detail = state.threadDetails[event.activity.threadId];
      if (!detail) return state;
      const turns = detail.turns.map((turn): ThreadTurn => {
        if (turn.id !== event.activity.turnId) return turn;
        return { ...turn, activities: [...upsertById(turn.activities, event.activity, false)] };
      });
      return {
        ...state,
        threadDetails: {
          ...state.threadDetails,
          [event.activity.threadId]: { ...detail, turns },
        },
      };
    }
    case "approval.updated": {
      const detail = state.threadDetails[event.approval.threadId];
      if (!detail) return state;
      const turns = detail.turns.map((turn): ThreadTurn => {
        if (turn.id !== event.approval.turnId) return turn;
        return { ...turn, approvals: [...upsertById(turn.approvals, event.approval, false)] };
      });
      return {
        ...state,
        threadDetails: {
          ...state.threadDetails,
          [event.approval.threadId]: { ...detail, turns },
        },
      };
    }
    case "provider.updated": {
      const providers = upsertById(state.providers, event.provider, false);
      const defaultModelSelection = pickBestSelection(providers, state.defaultModelSelection);
      return { ...state, providers, defaultModelSelection };
    }
  }
};

const reduce = (state: WorkspaceState, action: Action): WorkspaceState => {
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
        selectedProjectId,
        defaultModelSelection,
        error: null,
      };
    }
    case "error":
      return { ...state, loading: false, error: action.message };
    case "selectProject":
      return { ...state, selectedProjectId: action.projectId };
    case "setModelSelection": {
      try {
        localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(action.selection));
      } catch {
        // Ignore storage errors.
      }
      return { ...state, defaultModelSelection: action.selection };
    }
    case "branchesLoaded":
      return {
        ...state,
        branchesByProject: { ...state.branchesByProject, [action.projectId]: action.branches },
      };
    case "threadDetailLoaded":
      return {
        ...state,
        threads: upsertById(state.threads, action.detail.thread, true),
        threadDetails: { ...state.threadDetails, [action.detail.thread.id]: action.detail },
      };
    case "push":
      return applyPushEvent(state, action.event);
  }
};

export interface Workspace extends WorkspaceState {
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

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, {
    loading: true,
    projects: [],
    threads: [],
    providers: [],
    threadDetails: {},
    branchesByProject: {},
    selectedProjectId: null,
    defaultModelSelection: readStoredSelection() ?? FALLBACK_SELECTION,
    error: null,
  });

  const apiRef = useRef<ScuttleApiClient>(createScuttleApiClient());

  const refreshWorkspace = async () => {
    try {
      const snapshot = await apiRef.current.getWorkspace();
      dispatch({
        kind: "loaded",
        projects: snapshot.projects,
        threads: snapshot.threads,
        providers: snapshot.providers,
      });
    } catch (error) {
      dispatch({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load workspace.",
      });
    }
  };

  useEffect(() => {
    let active = true;
    let supervisor: ReturnType<typeof createWsSupervisor> | null = null;

    const bootstrap = async () => {
      const bridge = getDesktopBridge();
      const baseUrl = bridge === null ? undefined : (await bridge.getDesktopInfo()).serverUrl;
      if (!active) return;
      apiRef.current = createScuttleApiClient(baseUrl);
      await refreshWorkspace();
      if (!active) return;
      supervisor = createWsSupervisor({
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        onEvent: (event) => {
          dispatch({ kind: "push", event });
        },
        onOpen: () => {
          void refreshWorkspace();
        },
      });
    };

    void bootstrap();
    return () => {
      active = false;
      supervisor?.close();
    };
  }, []);

  const workspace: Workspace = {
    ...state,
    selectProject: (projectId) => dispatch({ kind: "selectProject", projectId }),
    setDefaultModelSelection: (selection) => dispatch({ kind: "setModelSelection", selection }),
    refreshWorkspace,
    loadBranches: async (projectId) => {
      const branches = await apiRef.current.listBranches(projectId);
      dispatch({ kind: "branchesLoaded", projectId, branches });
      return branches;
    },
    addProject: async (path, name) => {
      const project = await apiRef.current.createProject({
        path,
        ...(name !== undefined && name.trim().length > 0 ? { name } : {}),
      });
      dispatch({ kind: "push", event: { kind: "project.upserted", project } });
      dispatch({ kind: "selectProject", projectId: project.id });
      return project;
    },
    deleteProject: async (projectId) => {
      await apiRef.current.deleteProject(projectId);
      dispatch({ kind: "push", event: { kind: "project.deleted", projectId } });
    },
    listDirectory: (dirPath) => apiRef.current.listDirectory(dirPath),
    loadThreadDetail: async (threadId) => {
      const detail = await apiRef.current.getThreadDetail(threadId);
      dispatch({ kind: "threadDetailLoaded", detail });
      return detail;
    },
    createThread: async (input) => {
      const detail = await apiRef.current.createThread(input);
      dispatch({ kind: "threadDetailLoaded", detail });
      return detail;
    },
    sendTurn: async (threadId, input) => {
      const turn = await apiRef.current.sendTurn(threadId, input);
      dispatch({ kind: "push", event: { kind: "turn.upserted", turn } });
      return turn;
    },
    interruptTurn: (threadId) => apiRef.current.interruptTurn(threadId),
    settleThread: async (threadId, settled) => {
      const thread = await apiRef.current.settleThread(threadId, { settled });
      dispatch({ kind: "push", event: { kind: "thread.upserted", thread } });
      return thread;
    },
    updateThread: async (threadId, input) => {
      const thread = await apiRef.current.updateThread(threadId, input);
      dispatch({ kind: "push", event: { kind: "thread.upserted", thread } });
      return thread;
    },
    deleteThread: async (threadId) => {
      await apiRef.current.deleteThread(threadId);
    },
    respondApproval: (threadId, approvalId, input) =>
      apiRef.current.respondApproval(threadId, approvalId, input),
    refreshProviders: async () => {
      const providers = await apiRef.current.refreshProviders();
      for (const provider of providers) {
        dispatch({ kind: "push", event: { kind: "provider.updated", provider } });
      }
      return providers;
    },
    updateProvider: async (providerId, patch) => {
      const provider = await apiRef.current.updateProvider(providerId, patch);
      dispatch({ kind: "push", event: { kind: "provider.updated", provider } });
      return provider;
    },
  };

  return <WorkspaceContext value={workspace}>{children}</WorkspaceContext>;
}

export function useWorkspace(): Workspace {
  const workspace = use(WorkspaceContext);
  if (workspace === null) {
    throw new Error("useWorkspace must be called inside <WorkspaceProvider>.");
  }
  return workspace;
}

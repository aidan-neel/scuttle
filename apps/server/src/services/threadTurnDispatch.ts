import type { Database } from "bun:sqlite";
import type {
  CreateThreadInput,
  Project,
  ProviderConfig,
  QueuedTurn,
  SendTurnInput,
  Thread,
  ThreadAttachment,
  ThreadStatus,
  ThreadTurn,
  TurnOrigin,
  UpdateThreadInput,
} from "@scuttle/contracts";
import { type ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type { ResolvedAttachment } from "../providers/types.ts";
import { tryReadStoredAttachment } from "./AttachmentService.ts";
import { wrapPromptForThread } from "./agent/agentContext.ts";
import type * as CheckpointService from "./CheckpointService.ts";
import type * as EventBus from "./EventBus.ts";
import type * as GitService from "./GitService.ts";
import type { McpSessionRegistry } from "../mcp/McpSessionRegistry.ts";
import type { LiveTurnBuffer } from "./liveTurnBuffer.ts";
import type * as ModelPerformanceService from "./ModelPerformanceService.ts";
import type * as ProjectService from "./ProjectService.ts";
import type * as ProviderService from "./ProviderService.ts";
import { listCheckpointsByThread } from "./threadCheckpointStore.ts";
import { maybeRolloverThreadSession } from "./threadCompaction.ts";
import { drainNextQueuedTurn } from "./threadQueueDispatch.ts";
import { createThreadWithLocation, resolveThreadLocation } from "./threadRuntime.ts";
import {
  deriveThreadInputTitle,
  formatPromptWithAttachments,
  insertTurnRow,
  readThreadById,
  updateThreadRow,
} from "./threadStore.ts";
export { askUserOnThread, resolvePendingApproval } from "./threadApprovals.ts";
import {
  type ActiveRun,
  launchTurnExecution,
  type PendingApprovalResolver,
  type TurnRunnerDeps,
} from "./turnRunner.ts";

const mcpRegistryByApiRef = new WeakMap<{ readonly url: string }, McpSessionRegistry>();
const mcpRegistryByRunner = new WeakMap<TurnRunnerDeps, McpSessionRegistry>();

export const registerMcpSessionRegistry = (
  apiBaseUrlRef: { readonly url: string },
  registry: McpSessionRegistry,
): void => {
  mcpRegistryByApiRef.set(apiBaseUrlRef, registry);
};

export const dispatchThreadTurn = (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly runnerDeps: TurnRunnerDeps;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly thread: Thread;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<ThreadAttachment> | undefined;
  readonly origin: TurnOrigin;
  readonly providerConfig: ProviderConfig;
  readonly apiBaseUrl: string;
  readonly skillsRoot?: string | undefined;
  readonly mcpRegistry?: McpSessionRegistry | undefined;
}): ThreadTurn => {
  const {
    db,
    eventBus,
    runnerDeps,
    thread,
    prompt,
    origin,
    providerConfig,
    apiBaseUrl,
    skillsRoot,
  } = input;

  const seq =
    db
      .query<{ next_seq: number }, [string]>(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM turns WHERE thread_id = ?",
      )
      .get(thread.id)?.next_seq ?? 1;
  const turnId = TurnId.make(crypto.randomUUID());
  const startedAt = new Date().toISOString();
  const sessionEpoch = thread.sessionEpoch ?? 0;

  const resolvedAttachments: ResolvedAttachment[] = [];
  const resolvedIds = new Set<string>();
  const persistedAttachments: ThreadAttachment[] = [];
  for (const att of input.attachments ?? []) {
    const resolved = att.id !== undefined ? tryReadStoredAttachment(db, att.id) : null;
    if (resolved) {
      resolvedAttachments.push(resolved);
      resolvedIds.add(resolved.id);
      persistedAttachments.push({
        id: resolved.id,
        kind: "image",
        name: resolved.name,
        mimeType: resolved.mimeType,
        sizeBytes: resolved.bytes.byteLength,
      });
    } else if (att.id !== undefined) {
      persistedAttachments.push({
        name: att.name,
        ...(att.mimeType ? { mimeType: att.mimeType } : {}),
      });
    } else {
      persistedAttachments.push(att);
    }
  }

  const turn: ThreadTurn = {
    id: turnId,
    threadId: thread.id,
    ...(origin === "system" ? { origin } : {}),
    sessionEpoch,
    userMessage: prompt,
    assistantMessage: "",
    thinkingText: "",
    status: "running",
    startedAt,
    modelSelection: thread.modelSelection,
    ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {}),
    activities: [],
    approvals: [],
  };

  insertTurnRow(db, seq, turn);
  input.updateThreadStatus(thread.id, { kind: "running", startedAt, phase: "thinking" });
  eventBus.publishSync({ kind: "turn.upserted", turn });

  const refreshed = readThreadById(db, thread.id) ?? thread;
  const wrapped = wrapPromptForThread({
    db,
    thread: refreshed,
    userPrompt: prompt,
    apiBaseUrl,
    skillsRoot,
  });
  const textAttachments = persistedAttachments.filter(
    (att) => !(att.id !== undefined && resolvedIds.has(att.id)),
  );
  const fullPrompt = formatPromptWithAttachments(wrapped.prompt, textAttachments);
  const freshSessionPrompt = wrapped.freshSessionPrompt
    ? formatPromptWithAttachments(wrapped.freshSessionPrompt, textAttachments)
    : undefined;
  const extraEnv: Record<string, string> = {
    SCUTTLE_API_URL: apiBaseUrl,
    ...(skillsRoot ? { SCUTTLE_SKILLS_DIR: skillsRoot } : {}),
    ...(wrapped.agentId ? { SCUTTLE_AGENT_ID: wrapped.agentId } : {}),
    ...(wrapped.delegationId ? { SCUTTLE_DELEGATION_ID: wrapped.delegationId } : {}),
  };
  const mcpRegistry = input.mcpRegistry ?? mcpRegistryByRunner.get(runnerDeps);
  const mcpServer = mcpRegistry
    ? {
        url: `${apiBaseUrl.replace(/\/+$/, "")}/mcp`,
        authorizationHeader: mcpRegistry.issueToken({
          threadId: refreshed.id,
          projectId: refreshed.projectId,
          ...(wrapped.agentId ? { agentId: wrapped.agentId } : {}),
          ...(wrapped.delegationId ? { delegationId: wrapped.delegationId } : {}),
          providerId: providerConfig.id,
        }).authorizationHeader,
        threadId: refreshed.id,
      }
    : undefined;
  launchTurnExecution(runnerDeps, refreshed, turn, fullPrompt, providerConfig, extraEnv, {
    ...(freshSessionPrompt !== undefined ? { freshSessionPrompt } : {}),
    ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {}),
    ...(resolvedAttachments.length > 0 ? { resolvedAttachments } : {}),
    ...(mcpServer !== undefined ? { mcpServer } : {}),
    ...(wrapped.agentId !== undefined ? { agentId: wrapped.agentId } : {}),
    ...(wrapped.pendingContextHash !== undefined
      ? { pendingContextHash: wrapped.pendingContextHash }
      : {}),
    pendingNotifiedDelegationIds: wrapped.pendingNotifiedDelegationIds,
    pendingAccessedMemoryIds: wrapped.pendingAccessedMemoryIds,
  });
  return turn;
};

export const startPreparedTurn = (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly runnerDeps: TurnRunnerDeps;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly existing: Thread;
  readonly turnInput: Pick<
    SendTurnInput,
    "prompt" | "attachments" | "modelSelection" | "runtimeMode" | "interactionMode"
  >;
  readonly origin: TurnOrigin;
  readonly providerConfig: ProviderConfig;
  readonly apiBaseUrl: string;
  readonly skillsRoot?: string | undefined;
}): ThreadTurn => {
  const { db, eventBus, existing, turnInput } = input;
  const nextSelection = turnInput.modelSelection ?? existing.modelSelection;
  const selectionChanged =
    nextSelection.providerId !== existing.modelSelection.providerId ||
    nextSelection.model !== existing.modelSelection.model;
  const { thread: rolledThread, rolledOver } = maybeRolloverThreadSession({
    db,
    thread: existing,
    shouldRollover: selectionChanged,
  });
  db.query(
    `UPDATE threads
     SET provider_id = ?, provider_kind = ?, model = ?, effort = ?, runtime_mode = ?, interaction_mode = ?,
         provider_session_id = ?, settled_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(
    nextSelection.providerId,
    nextSelection.providerKind,
    nextSelection.model,
    nextSelection.effort ?? null,
    turnInput.runtimeMode ?? rolledThread.runtimeMode,
    turnInput.interactionMode ?? rolledThread.interactionMode,
    rolledOver || selectionChanged ? null : (rolledThread.providerSessionId ?? null),
    new Date().toISOString(),
    existing.id,
  );
  const thread = readThreadById(db, existing.id) ?? rolledThread;
  eventBus.publishSync({ kind: "thread.upserted", thread });
  return dispatchThreadTurn({
    db,
    eventBus,
    runnerDeps: input.runnerDeps,
    updateThreadStatus: input.updateThreadStatus,
    thread,
    prompt: turnInput.prompt,
    attachments: turnInput.attachments,
    origin: input.origin,
    providerConfig: input.providerConfig,
    apiBaseUrl: input.apiBaseUrl,
    skillsRoot: input.skillsRoot,
  });
};

export const updateThreadState = Effect.fn("threadTurnDispatch.updateThreadState")(
  function* (deps: {
    readonly db: Database;
    readonly eventBus: EventBus.EventBus["Service"];
    readonly git: GitService.GitService["Service"];
    readonly activeRuns: ReadonlyMap<string, ActiveRun>;
    readonly existing: Thread;
    readonly project: Project;
    readonly input: UpdateThreadInput;
  }) {
    const { db, eventBus, git, activeRuns, existing, project, input } = deps;
    const nextRuntime = input.runtime ?? existing.runtime;
    const nextSelection = input.modelSelection ?? existing.modelSelection;
    const selectionChanged =
      nextSelection.providerId !== existing.modelSelection.providerId ||
      nextSelection.model !== existing.modelSelection.model;
    if ((nextRuntime !== existing.runtime || selectionChanged) && activeRuns.has(existing.id)) {
      return yield* Effect.fail("Stop the running turn before changing runtime or model.");
    }
    const location = yield* resolveThreadLocation({
      existing,
      project,
      nextRuntime,
      requestedBranch: input.branch,
      git,
    });
    const shouldRollover =
      location.resetSession || selectionChanged || nextRuntime !== existing.runtime;
    const { thread: rolledThread, rolledOver } = maybeRolloverThreadSession({
      db,
      thread: existing,
      shouldRollover,
    });
    const resetSession = rolledOver || shouldRollover;
    const nextCompactAtTokens =
      input.compactAtTokens === undefined
        ? (rolledThread.compactAtTokens ?? null)
        : input.compactAtTokens !== null &&
            Number.isFinite(input.compactAtTokens) &&
            input.compactAtTokens > 0
          ? Math.round(input.compactAtTokens)
          : null;
    const updated = updateThreadRow(db, {
      id: existing.id,
      title: input.title?.trim() || rolledThread.title,
      runtime: location.runtime,
      branch: location.branch,
      worktreePath: location.worktreePath,
      cwd: location.cwd,
      modelSelection: nextSelection,
      runtimeMode: input.runtimeMode ?? rolledThread.runtimeMode,
      interactionMode: input.interactionMode ?? rolledThread.interactionMode,
      providerSessionId: resetSession ? null : (rolledThread.providerSessionId ?? null),
      compactAtTokens: nextCompactAtTokens,
      now: new Date().toISOString(),
    });
    if (!updated) return yield* Effect.fail(`Thread "${existing.id}" was not found.`);
    eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    return updated;
  },
);

export const insertThreadWithProject = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly git: GitService.GitService["Service"];
  readonly projects: ProjectService.ProjectService["Service"];
  readonly input: {
    readonly projectId: CreateThreadInput["projectId"];
    readonly title: string;
    readonly runtime: CreateThreadInput["runtime"];
    readonly branch: string;
    readonly modelSelection: CreateThreadInput["modelSelection"];
    readonly runtimeMode?: CreateThreadInput["runtimeMode"];
    readonly interactionMode?: CreateThreadInput["interactionMode"];
    readonly setupWorktree?: boolean;
    readonly initialStatus: ThreadStatus;
  };
}) =>
  deps.projects.get(deps.input.projectId).pipe(
    Effect.mapError((err) => err.message),
    Effect.flatMap((project) =>
      createThreadWithLocation({
        db: deps.db,
        eventBus: deps.eventBus,
        git: deps.git,
        project,
        ...deps.input,
      }),
    ),
  );

export const buildTurnRunnerDeps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly activeRuns: Map<string, ActiveRun>;
  readonly pendingApprovals: Map<string, PendingApprovalResolver>;
  readonly liveTurnBuffer: LiveTurnBuffer;
  readonly checkpointService: CheckpointService.CheckpointService["Service"];
  readonly perfService: ModelPerformanceService.ModelPerformanceService["Service"];
  readonly projects: ProjectService.ProjectService["Service"];
  readonly providers: ProviderService.ProviderService["Service"];
  readonly deletingThreads: ReadonlySet<string>;
  readonly apiBaseUrlRef: { readonly url: string };
  readonly skillsRoot?: string | undefined;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly isDisposed: () => boolean;
}): TurnRunnerDeps => {
  const runnerDeps: TurnRunnerDeps = {
    db: deps.db,
    eventBus: deps.eventBus,
    activeRuns: deps.activeRuns,
    pendingApprovals: deps.pendingApprovals,
    liveTurnBuffer: deps.liveTurnBuffer,
    checkpointService: deps.checkpointService,
    recordPerformance: (input) =>
      Effect.runPromise(deps.perfService.recordMeasuredRun(input)).catch(() => null),
    onTurnSettled: (threadId) => {
      if (deps.isDisposed() || deps.deletingThreads.has(threadId)) return;
      void drainNextQueuedTurn({
        db: deps.db,
        eventBus: deps.eventBus,
        runnerDeps,
        updateThreadStatus: deps.updateThreadStatus,
        providers: deps.providers,
        threadId,
        isClosed: () => deps.isDisposed() || deps.deletingThreads.has(threadId),
        startTurn: (existing, next: QueuedTurn, providerConfig) =>
          startPreparedTurn({
            db: deps.db,
            eventBus: deps.eventBus,
            runnerDeps,
            updateThreadStatus: deps.updateThreadStatus,
            existing,
            turnInput: {
              prompt: next.prompt,
              ...(next.attachments ? { attachments: next.attachments } : {}),
              ...(next.modelSelection ? { modelSelection: next.modelSelection } : {}),
              ...(next.runtimeMode ? { runtimeMode: next.runtimeMode } : {}),
              ...(next.interactionMode ? { interactionMode: next.interactionMode } : {}),
            },
            origin: "user",
            providerConfig,
            apiBaseUrl: deps.apiBaseUrlRef.url,
            skillsRoot: deps.skillsRoot,
          }),
      }).catch(() => undefined);
    },
    updateThreadStatus: deps.updateThreadStatus,
    onProjectActivity: (thread, summary) => {
      if (!deps.isDisposed()) {
        void Effect.runPromise(deps.projects.touchActivity(thread.projectId, summary));
      }
    },
    isDisposed: deps.isDisposed,
  };
  const mcpRegistry = mcpRegistryByApiRef.get(deps.apiBaseUrlRef);
  if (mcpRegistry) mcpRegistryByRunner.set(runnerDeps, mcpRegistry);
  return runnerDeps;
};

export const createThreadAndStartTurn = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly git: GitService.GitService["Service"];
  readonly projects: ProjectService.ProjectService["Service"];
  readonly runnerDeps: TurnRunnerDeps;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly input: CreateThreadInput;
  readonly providerConfig: ProviderConfig;
  readonly apiBaseUrl: string;
  readonly skillsRoot?: string | undefined;
}) =>
  insertThreadWithProject({
    db: deps.db,
    eventBus: deps.eventBus,
    git: deps.git,
    projects: deps.projects,
    input: {
      projectId: deps.input.projectId,
      title: deriveThreadInputTitle(deps.input.prompt, deps.input.title),
      runtime: deps.input.runtime,
      branch: deps.input.branch,
      modelSelection: deps.input.modelSelection,
      runtimeMode: deps.input.runtimeMode,
      interactionMode: deps.input.interactionMode,
      setupWorktree: true,
      initialStatus: { kind: "running", startedAt: new Date().toISOString(), phase: "thinking" },
    },
  }).pipe(
    Effect.map((thread) => {
      const turn = startPreparedTurn({
        db: deps.db,
        eventBus: deps.eventBus,
        runnerDeps: deps.runnerDeps,
        updateThreadStatus: deps.updateThreadStatus,
        existing: thread,
        turnInput: {
          prompt: deps.input.prompt,
          ...(deps.input.attachments !== undefined ? { attachments: deps.input.attachments } : {}),
        },
        origin: "user",
        providerConfig: deps.providerConfig,
        apiBaseUrl: deps.apiBaseUrl,
        skillsRoot: deps.skillsRoot,
      });
      return {
        thread: readThreadById(deps.db, thread.id) ?? thread,
        turns: [turn],
        checkpoints: listCheckpointsByThread(deps.db, thread.id),
        queuedTurns: [],
        visualizations: [],
      };
    }),
  );

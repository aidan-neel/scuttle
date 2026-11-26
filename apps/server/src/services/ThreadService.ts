import type {
  CompactThreadInput,
  CompactThreadResult,
  CreateThreadInput,
  ProviderConfig,
  RespondApprovalInput,
  SendTurnInput,
  Thread,
  ThreadAttachment,
  ThreadDetail,
  ThreadStatus,
  ThreadTurn,
  TurnOrigin,
  UpdateThreadInput,
} from "@scuttle/contracts";
import { type ApprovalId, ThreadId } from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EventBus from "./EventBus.ts";
import * as GitService from "./GitService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProviderService from "./ProviderService.ts";
import { maybeRolloverThreadSession, rolloverThreadSession } from "./threadCompaction.ts";
import { resolveThreadLocation } from "./threadRuntime.ts";
import {
  deriveThreadInputTitle,
  insertThreadRow,
  listAllThreads,
  readThreadById,
  readTurnsForThread,
  recoverInterruptedThreads,
  TITLE_LIMIT,
  updateThreadRow,
} from "./threadStore.ts";
import { dispatchThreadTurn, resolvePendingApproval } from "./threadTurnDispatch.ts";
import type { ActiveRun, PendingApprovalResolver } from "./turnRunner.ts";

export class ThreadServiceError extends Schema.TaggedError<ThreadServiceError>()(
  "ThreadServiceError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ThreadService extends Context.Service<
  ThreadService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Thread>>;
    readonly getDetail: (threadId: ThreadId) => Effect.Effect<ThreadDetail, ThreadServiceError>;
    readonly create: (input: CreateThreadInput) => Effect.Effect<ThreadDetail, ThreadServiceError>;
    readonly createIdle: (input: {
      readonly projectId: CreateThreadInput["projectId"];
      readonly title: string;
      readonly runtime: CreateThreadInput["runtime"];
      readonly branch: string;
      readonly modelSelection: CreateThreadInput["modelSelection"];
      readonly runtimeMode?: CreateThreadInput["runtimeMode"];
      readonly interactionMode?: CreateThreadInput["interactionMode"];
    }) => Effect.Effect<Thread, ThreadServiceError>;
    readonly sendTurn: (
      threadId: ThreadId,
      input: SendTurnInput,
      options?: { readonly origin?: TurnOrigin },
    ) => Effect.Effect<ThreadTurn, ThreadServiceError>;
    readonly interrupt: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
    readonly settle: (
      threadId: ThreadId,
      settled: boolean,
    ) => Effect.Effect<Thread, ThreadServiceError>;
    readonly compact: (
      threadId: ThreadId,
      input?: CompactThreadInput,
    ) => Effect.Effect<CompactThreadResult, ThreadServiceError>;
    readonly update: (
      threadId: ThreadId,
      input: UpdateThreadInput,
    ) => Effect.Effect<Thread, ThreadServiceError>;
    readonly remove: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
    readonly respondApproval: (
      threadId: ThreadId,
      approvalId: ApprovalId,
      input: RespondApprovalInput,
    ) => Effect.Effect<void, ThreadServiceError>;
  }
>()("scuttle/server/ThreadService") {}

const make = Effect.gen(function* () {
  const { db } = yield* Sqlite.SqliteDatabase;
  const config = yield* ServerConfig.ServerConfig;
  const eventBus = yield* EventBus.EventBus;
  const git = yield* GitService.GitService;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderService.ProviderService;

  recoverInterruptedThreads(db);

  const activeRuns = new Map<string, ActiveRun>();
  const pendingApprovals = new Map<string, PendingApprovalResolver>();
  let disposed = false;

  yield* Effect.acquireRelease(Effect.void, () =>
    Effect.sync(() => {
      disposed = true;
      for (const active of activeRuns.values()) {
        active.controller.abort();
      }
      activeRuns.clear();
      pendingApprovals.clear();
    }),
  );

  const updateThreadStatus = (threadId: ThreadId, status: ThreadStatus): Thread | null => {
    if (disposed) return null;
    const now = new Date().toISOString();
    db.prepare("UPDATE threads SET status_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(status),
      now,
      threadId,
    );
    const updated = readThreadById(db, threadId);
    if (updated) {
      eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    }
    return updated;
  };

  const runnerDeps = {
    db,
    eventBus,
    activeRuns,
    pendingApprovals,
    updateThreadStatus,
    onProjectActivity: (thread: Thread, summary: string) => {
      if (!disposed) {
        void Effect.runPromise(projects.touchActivity(thread.projectId, summary));
      }
    },
    isDisposed: () => disposed,
  };

  const requireThread = Effect.fn("ThreadService.requireThread")(function* (threadId: ThreadId) {
    const thread = readThreadById(db, threadId);
    if (!thread) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    return thread;
  });

  const list = () => Effect.sync(() => listAllThreads(db));

  const getDetail = Effect.fn("ThreadService.getDetail")(function* (threadId: ThreadId) {
    const thread = yield* requireThread(threadId);
    const turns = readTurnsForThread(db, thread);
    return { thread, turns };
  });

  const ensureTurnStartable = Effect.fn("ThreadService.ensureTurnStartable")(function* (
    threadId: ThreadId,
    providerId: Thread["modelSelection"]["providerId"],
  ) {
    if (activeRuns.has(threadId)) {
      return yield* new ThreadServiceError({
        detail: "This thread already has a turn running. Stop it before sending another message.",
      });
    }
    const providerConfig = yield* providers
      .getConfig(providerId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));
    if (!providerConfig.enabled) {
      return yield* new ThreadServiceError({
        detail: `Provider "${providerConfig.name}" is disabled. Enable it in Settings.`,
      });
    }
    return providerConfig;
  });

  const startTurnInternal = Effect.fn("ThreadService.startTurnInternal")(function* (
    thread: Thread,
    prompt: string,
    attachments: ReadonlyArray<ThreadAttachment> | undefined,
    origin: TurnOrigin = "user",
    resolvedConfig?: ProviderConfig,
  ) {
    const providerConfig =
      resolvedConfig ?? (yield* ensureTurnStartable(thread.id, thread.modelSelection.providerId));

    return dispatchThreadTurn({
      db,
      eventBus,
      runnerDeps,
      updateThreadStatus,
      thread,
      prompt,
      attachments,
      origin,
      providerConfig,
      apiBaseUrl: config.apiBaseUrlRef.url,
    });
  });

  const createIdle = Effect.fn("ThreadService.createIdle")(function* (input: {
    readonly projectId: CreateThreadInput["projectId"];
    readonly title: string;
    readonly runtime: CreateThreadInput["runtime"];
    readonly branch: string;
    readonly modelSelection: CreateThreadInput["modelSelection"];
    readonly runtimeMode?: CreateThreadInput["runtimeMode"];
    readonly interactionMode?: CreateThreadInput["interactionMode"];
  }) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));

    const threadId = ThreadId.make(crypto.randomUUID());
    const now = new Date().toISOString();
    const thread = insertThreadRow(db, {
      id: threadId,
      projectId: project.id,
      projectName: project.name,
      title: input.title.trim().slice(0, TITLE_LIMIT) || project.name,
      runtime: input.runtime,
      branch: input.branch,
      cwd: project.path,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode ?? "auto",
      interactionMode: input.interactionMode ?? "default",
      status: { kind: "idle" },
      now,
    });
    if (!thread) {
      return yield* new ThreadServiceError({ detail: "Failed to persist thread." });
    }
    eventBus.publishSync({ kind: "thread.upserted", thread });
    return thread;
  });

  const create = Effect.fn("ThreadService.create")(function* (input: CreateThreadInput) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));

    const threadId = ThreadId.make(crypto.randomUUID());
    const title = deriveThreadInputTitle(input.prompt, input.title);
    let cwd = project.path;
    let branch = input.branch;
    let worktreePath: string | undefined;

    if (input.runtime === "worktree") {
      const created = yield* git
        .createWorktree({
          repoPath: project.path,
          baseBranch: input.branch,
          titleHint: title,
          threadId,
        })
        .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));
      cwd = created.worktreePath;
      worktreePath = created.worktreePath;
      branch = created.branch;
    }

    const now = new Date().toISOString();
    const thread = insertThreadRow(db, {
      id: threadId,
      projectId: project.id,
      projectName: project.name,
      title,
      runtime: input.runtime,
      branch,
      ...(worktreePath ? { worktreePath } : {}),
      cwd,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode ?? "auto",
      interactionMode: input.interactionMode ?? "default",
      status: { kind: "running", startedAt: now, phase: "thinking" },
      now,
    });
    if (!thread) {
      return yield* new ThreadServiceError({ detail: "Failed to persist thread." });
    }
    eventBus.publishSync({ kind: "thread.upserted", thread });

    const turn = yield* startTurnInternal(thread, input.prompt, input.attachments);
    const updatedThread = readThreadById(db, threadId) ?? thread;
    return { thread: updatedThread, turns: [turn] };
  });

  const sendTurn = Effect.fn("ThreadService.sendTurn")(function* (
    threadId: ThreadId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) {
    const existing = yield* requireThread(threadId);

    const nextSelection = input.modelSelection ?? existing.modelSelection;
    const providerConfig = yield* ensureTurnStartable(threadId, nextSelection.providerId);

    const selectionChanged =
      nextSelection.providerId !== existing.modelSelection.providerId ||
      nextSelection.model !== existing.modelSelection.model;
    const { thread: rolledThread, rolledOver } = maybeRolloverThreadSession({
      db,
      thread: existing,
      shouldRollover: selectionChanged,
    });
    const nextRuntimeMode = input.runtimeMode ?? rolledThread.runtimeMode;
    const nextInteractionMode = input.interactionMode ?? rolledThread.interactionMode;

    db.prepare(
      `UPDATE threads
       SET provider_id = ?, provider_kind = ?, model = ?, effort = ?, runtime_mode = ?, interaction_mode = ?,
           provider_session_id = ?, settled_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextSelection.providerId,
      nextSelection.providerKind,
      nextSelection.model,
      nextSelection.effort ?? null,
      nextRuntimeMode,
      nextInteractionMode,
      rolledOver || selectionChanged ? null : (rolledThread.providerSessionId ?? null),
      new Date().toISOString(),
      threadId,
    );

    const thread = readThreadById(db, threadId) ?? rolledThread;
    eventBus.publishSync({ kind: "thread.upserted", thread });

    return yield* startTurnInternal(
      thread,
      input.prompt,
      input.attachments,
      options?.origin,
      providerConfig,
    );
  });

  const interrupt = (threadId: ThreadId) =>
    Effect.sync(() => {
      const active = activeRuns.get(threadId);
      if (active) {
        active.controller.abort();
      }
      for (const [approvalId, pending] of pendingApprovals.entries()) {
        if (pending.threadId === threadId) {
          pending.resolve({ optionId: "decline" });
          pendingApprovals.delete(approvalId);
        }
      }
    });

  const settle = Effect.fn("ThreadService.settle")(function* (
    threadId: ThreadId,
    settled: boolean,
  ) {
    yield* requireThread(threadId);
    const now = new Date().toISOString();
    db.prepare("UPDATE threads SET settled_at = ?, updated_at = ? WHERE id = ?").run(
      settled ? now : null,
      now,
      threadId,
    );
    const updated = yield* requireThread(threadId);
    eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    return updated;
  });

  const compact = Effect.fn("ThreadService.compact")(function* (
    threadId: ThreadId,
    input?: CompactThreadInput,
  ) {
    if (activeRuns.has(threadId)) {
      return yield* new ThreadServiceError({
        detail: "Stop the running turn before compacting this thread.",
      });
    }
    const existing = yield* requireThread(threadId);
    const result = rolloverThreadSession({
      db,
      thread: existing,
      ...(input?.focus !== undefined ? { focus: input.focus } : {}),
      forceSummary: true,
    });
    eventBus.publishSync({ kind: "thread.upserted", thread: result.thread });
    return result;
  });

  const update = Effect.fn("ThreadService.update")(function* (
    threadId: ThreadId,
    input: UpdateThreadInput,
  ) {
    const existing = yield* requireThread(threadId);
    const nextRuntime = input.runtime ?? existing.runtime;
    const nextSelection = input.modelSelection ?? existing.modelSelection;
    const selectionChanged =
      nextSelection.providerId !== existing.modelSelection.providerId ||
      nextSelection.model !== existing.modelSelection.model;
    if ((nextRuntime !== existing.runtime || selectionChanged) && activeRuns.has(threadId)) {
      return yield* new ThreadServiceError({
        detail: "Stop the running turn before changing runtime or model.",
      });
    }
    const project = yield* projects
      .get(existing.projectId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));
    const location = yield* resolveThreadLocation({
      existing,
      project,
      nextRuntime,
      requestedBranch: input.branch,
      git,
    }).pipe(Effect.mapError((detail) => new ThreadServiceError({ detail })));
    const shouldRollover =
      location.resetSession || selectionChanged || nextRuntime !== existing.runtime;
    const { thread: rolledThread, rolledOver } = maybeRolloverThreadSession({
      db,
      thread: existing,
      shouldRollover,
    });
    const resetSession = rolledOver || shouldRollover;
    const updated = updateThreadRow(db, {
      id: threadId,
      title: input.title?.trim() || rolledThread.title,
      runtime: location.runtime,
      branch: location.branch,
      worktreePath: location.worktreePath,
      cwd: location.cwd,
      modelSelection: nextSelection,
      runtimeMode: input.runtimeMode ?? rolledThread.runtimeMode,
      interactionMode: input.interactionMode ?? rolledThread.interactionMode,
      providerSessionId: resetSession ? null : (rolledThread.providerSessionId ?? null),
      now: new Date().toISOString(),
    });
    if (!updated) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    return updated;
  });

  const remove = Effect.fn("ThreadService.remove")(function* (threadId: ThreadId) {
    const existing = yield* requireThread(threadId);
    yield* interrupt(threadId);
    if (existing.worktreePath) {
      const project = yield* projects.get(existing.projectId).pipe(Effect.option);
      if (project._tag === "Some") {
        yield* git.removeWorktree(project.value.path, existing.worktreePath);
      }
    }
    db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    eventBus.publishSync({ kind: "thread.deleted", threadId });
  });

  const respondApproval = Effect.fn("ThreadService.respondApproval")(function* (
    threadId: ThreadId,
    approvalId: ApprovalId,
    input: RespondApprovalInput,
  ) {
    const resolved = resolvePendingApproval({
      db,
      eventBus,
      pendingApprovals,
      updateThreadStatus,
      threadId,
      approvalId,
      response: input,
    });
    if (!resolved) {
      return yield* new ThreadServiceError({
        detail: "Approval request is no longer active.",
      });
    }
  });

  return ThreadService.of({
    list,
    getDetail,
    create,
    createIdle,
    sendTurn,
    interrupt,
    settle,
    compact,
    update,
    remove,
    respondApproval,
  });
});

export const layer = Layer.effect(ThreadService, make);

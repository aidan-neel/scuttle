import type {
  CompactThreadInput,
  CreateThreadInput,
  EditQueuedTurnInput,
  RespondApprovalInput,
  RewindThreadInput,
  SendTurnInput,
  Thread,
  ThreadStatus,
  TurnOrigin,
  UpdateThreadInput,
} from "@scuttle/contracts";
import { type ApprovalId, ThreadId, type TurnId } from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as CheckpointService from "./CheckpointService.ts";
import * as EventBus from "./EventBus.ts";
import * as GitService from "./GitService.ts";
import { LiveTurnBuffer } from "./liveTurnBuffer.ts";
import * as ModelPerformanceService from "./ModelPerformanceService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProviderService from "./ProviderService.ts";
import { listCheckpointsByThread } from "./threadCheckpointStore.ts";
import {
  cancelQueuedTurnOnThread,
  dispatchMidRunTurn,
  editQueuedTurnOnThread,
  promoteQueuedTurnOnThread,
} from "./threadQueueDispatch.ts";
import { listQueuedTurnsByThread } from "./threadQueueStore.ts";
import {
  compactThreadState,
  interruptThreadRun,
  removeThreadResources,
  runThreadRewind,
  settleThreadRow,
} from "./threadRewind.ts";
import {
  listAllThreads,
  readThreadById,
  readTurnsForThread,
  recoverInterruptedThreads,
} from "./threadStore.ts";
import {
  askUserOnThread,
  isValidApprovalResponse,
  resolvePendingApproval,
} from "./threadApprovals.ts";
import {
  type AskUserInput,
  ThreadServiceError,
  type ThreadServiceShape,
} from "./threadServiceTypes.ts";
import {
  buildTurnRunnerDeps,
  createThreadAndStartTurn,
  insertThreadWithProject,
  startPreparedTurn,
  updateThreadState,
} from "./threadTurnDispatch.ts";
import type { ActiveRun, PendingApprovalResolver } from "./turnRunner.ts";
import * as VisualizationStore from "./VisualizationStore.ts";

export {
  type AskUserInput,
  type AskUserQuestionInput,
  type AskUserResult,
  ThreadServiceError,
  type ThreadServiceShape,
} from "./threadServiceTypes.ts";

export class ThreadService extends Context.Service<ThreadService, ThreadServiceShape>()(
  "scuttle/server/ThreadService",
) {}

const make = Effect.gen(function* () {
  const { db } = yield* Sqlite.SqliteDatabase;
  const config = yield* ServerConfig.ServerConfig;
  const eventBus = yield* EventBus.EventBus;
  const git = yield* GitService.GitService;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderService.ProviderService;
  const checkpointService = yield* CheckpointService.CheckpointService;
  const perfService = yield* ModelPerformanceService.ModelPerformanceService;

  recoverInterruptedThreads(db);

  const activeRuns = new Map<string, ActiveRun>();
  const pendingApprovals = new Map<string, PendingApprovalResolver>();
  const deletingThreads = new Set<string>();
  const liveTurnBuffer = new LiveTurnBuffer(db);
  let disposed = false;

  yield* Effect.acquireRelease(Effect.void, () =>
    Effect.sync(() => {
      disposed = true;
      for (const active of activeRuns.values()) active.controller.abort();
      activeRuns.clear();
      pendingApprovals.clear();
      deletingThreads.clear();
      liveTurnBuffer.dispose();
    }),
  );

  const updateThreadStatus = (threadId: ThreadId, status: ThreadStatus): Thread | null => {
    if (disposed) return null;
    db.query("UPDATE threads SET status_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(status),
      new Date().toISOString(),
      threadId,
    );
    const updated = readThreadById(db, threadId);
    if (updated) eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    return updated;
  };

  const runnerDeps = buildTurnRunnerDeps({
    db,
    eventBus,
    activeRuns,
    pendingApprovals,
    liveTurnBuffer,
    checkpointService,
    perfService,
    projects,
    providers,
    deletingThreads,
    apiBaseUrlRef: config.apiBaseUrlRef,
    skillsRoot: config.skillsRoot,
    updateThreadStatus,
    isDisposed: () => disposed,
  });

  const requireThread = Effect.fn("ThreadService.requireThread")(function* (threadId: ThreadId) {
    const thread = readThreadById(db, threadId);
    if (!thread)
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    return thread;
  });

  const requireEnabledProvider = Effect.fn("ThreadService.requireEnabledProvider")(function* (
    providerId: Thread["modelSelection"]["providerId"],
  ) {
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

  const list = () => Effect.sync(() => listAllThreads(db));

  const getDetail = Effect.fn("ThreadService.getDetail")(function* (threadId: ThreadId) {
    const thread = yield* requireThread(threadId);
    return {
      thread,
      turns: readTurnsForThread(db, thread).map((t) => liveTurnBuffer.overlayTurn(t)),
      checkpoints: listCheckpointsByThread(db, threadId),
      queuedTurns: listQueuedTurnsByThread(db, threadId),
      visualizations: VisualizationStore.listByThread(db, threadId),
    };
  });

  const createIdle = Effect.fn("ThreadService.createIdle")(
    (input: Parameters<ThreadServiceShape["createIdle"]>[0]) =>
      insertThreadWithProject({
        db,
        eventBus,
        git,
        projects,
        input: { ...input, initialStatus: { kind: "idle" } },
      }).pipe(Effect.mapError((detail) => new ThreadServiceError({ detail }))),
  );

  const create = Effect.fn("ThreadService.create")(function* (input: CreateThreadInput) {
    const providerConfig = yield* requireEnabledProvider(input.modelSelection.providerId);
    return yield* createThreadAndStartTurn({
      db,
      eventBus,
      git,
      projects,
      runnerDeps,
      updateThreadStatus,
      input,
      providerConfig,
      apiBaseUrl: config.apiBaseUrlRef.url,
      skillsRoot: config.skillsRoot,
    }).pipe(Effect.mapError((detail) => new ThreadServiceError({ detail })));
  });

  const dispatchTurn = Effect.fn("ThreadService.dispatchTurn")(function* (
    threadId: ThreadId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) {
    const existing = yield* requireThread(threadId);
    const providerConfig = yield* requireEnabledProvider(
      (input.modelSelection ?? existing.modelSelection).providerId,
    );
    const origin = options?.origin ?? "user";
    if (activeRuns.has(threadId)) {
      const outcome = yield* Effect.promise(() =>
        dispatchMidRunTurn({
          db,
          eventBus,
          activeRuns,
          liveTurnBuffer,
          existing,
          turnInput: input,
          origin,
        }),
      );
      if (outcome.error !== undefined || !outcome.result) {
        return yield* new ThreadServiceError({
          detail: outcome.error ?? "This thread already has a turn running.",
        });
      }
      return outcome.result;
    }
    const turn = startPreparedTurn({
      db,
      eventBus,
      runnerDeps,
      updateThreadStatus,
      existing,
      turnInput: input,
      origin,
      providerConfig,
      apiBaseUrl: config.apiBaseUrlRef.url,
      skillsRoot: config.skillsRoot,
    });
    return { kind: "started" as const, turn };
  });

  const sendTurn = Effect.fn("ThreadService.sendTurn")(function* (
    threadId: ThreadId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) {
    const outcome = yield* dispatchTurn(threadId, input, options);
    if (outcome.kind === "queued") {
      return yield* new ThreadServiceError({
        detail: `Turn queued (${outcome.queuedTurn.id}) while thread is running.`,
      });
    }
    return outcome.turn;
  });

  const interrupt = (threadId: ThreadId, expectedTurnId?: TurnId) =>
    Effect.sync(() => interruptThreadRun(activeRuns, pendingApprovals, threadId, expectedTurnId));

  const settle = Effect.fn("ThreadService.settle")(function* (
    threadId: ThreadId,
    settled: boolean,
  ) {
    yield* requireThread(threadId);
    return settleThreadRow(db, eventBus, threadId, settled);
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
    return compactThreadState(db, eventBus, existing, input);
  });

  const rewindThread = Effect.fn("ThreadService.rewindThread")(function* (
    threadId: ThreadId,
    input: RewindThreadInput,
  ) {
    const thread = yield* requireThread(threadId);
    return yield* runThreadRewind({
      db,
      eventBus,
      checkpointService,
      activeRuns,
      thread,
      input,
    }).pipe(Effect.mapError((detail) => new ThreadServiceError({ detail })));
  });

  const listQueuedTurns = Effect.fn("ThreadService.listQueuedTurns")(function* (
    threadId: ThreadId,
  ) {
    yield* requireThread(threadId);
    return listQueuedTurnsByThread(db, threadId);
  });

  const editQueuedTurn = Effect.fn("ThreadService.editQueuedTurn")(function* (
    threadId: ThreadId,
    queuedId: string,
    input: EditQueuedTurnInput,
  ) {
    yield* requireThread(threadId);
    const updated = editQueuedTurnOnThread(db, eventBus, threadId, queuedId, input);
    if (!updated)
      return yield* new ThreadServiceError({ detail: `Queued turn "${queuedId}" was not found.` });
    return updated;
  });

  const cancelQueuedTurn = Effect.fn("ThreadService.cancelQueuedTurn")(function* (
    threadId: ThreadId,
    queuedId: string,
  ) {
    yield* requireThread(threadId);
    if (!cancelQueuedTurnOnThread(db, eventBus, threadId, queuedId)) {
      return yield* new ThreadServiceError({ detail: `Queued turn "${queuedId}" was not found.` });
    }
  });

  const promoteQueuedTurn = Effect.fn("ThreadService.promoteQueuedTurn")(function* (
    threadId: ThreadId,
    queuedId: string,
  ) {
    const thread = yield* requireThread(threadId);
    const res = yield* Effect.promise(() =>
      promoteQueuedTurnOnThread({ db, eventBus, activeRuns, liveTurnBuffer, thread, queuedId }),
    );
    if ("error" in res) return yield* new ThreadServiceError({ detail: res.error });
    return res;
  });

  const listVisualizations = Effect.fn("ThreadService.listVisualizations")(function* (
    threadId: ThreadId,
  ) {
    yield* requireThread(threadId);
    return VisualizationStore.listByThread(db, threadId);
  });

  const update = Effect.fn("ThreadService.update")(function* (
    threadId: ThreadId,
    input: UpdateThreadInput,
  ) {
    const existing = yield* requireThread(threadId);
    const project = yield* projects
      .get(existing.projectId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));
    return yield* updateThreadState({
      db,
      eventBus,
      git,
      activeRuns,
      existing,
      project,
      input,
    }).pipe(Effect.mapError((detail) => new ThreadServiceError({ detail })));
  });

  const remove = Effect.fn("ThreadService.remove")(function* (threadId: ThreadId) {
    const existing = yield* requireThread(threadId);
    deletingThreads.add(threadId);
    try {
      yield* interrupt(threadId);
      yield* removeThreadResources({
        db,
        eventBus,
        git,
        projects,
        checkpointService,
        existing,
        threadId,
      });
    } finally {
      deletingThreads.delete(threadId);
    }
  });

  const respondApproval = Effect.fn("ThreadService.respondApproval")(function* (
    threadId: ThreadId,
    approvalId: ApprovalId,
    input: RespondApprovalInput,
  ) {
    if (!isValidApprovalResponse(input)) {
      return yield* new ThreadServiceError({
        detail: "Approval response must include optionId, answers, or dismissed=true.",
      });
    }
    const resolved = resolvePendingApproval({
      db,
      eventBus,
      pendingApprovals,
      updateThreadStatus,
      threadId,
      approvalId,
      response: input,
    });
    if (!resolved)
      return yield* new ThreadServiceError({ detail: "Approval request is no longer active." });
  });

  const askUser = Effect.fn("ThreadService.askUser")(function* (
    threadId: ThreadId,
    input: AskUserInput,
  ) {
    yield* requireThread(threadId);
    return yield* askUserOnThread({
      db,
      eventBus,
      activeRuns,
      pendingApprovals,
      updateThreadStatus,
      isDisposed: () => disposed,
      threadId,
      input,
    }).pipe(Effect.mapError((detail) => new ThreadServiceError({ detail })));
  });

  return ThreadService.of({
    list,
    getDetail,
    create,
    createIdle,
    sendTurn,
    dispatchTurn,
    interrupt,
    settle,
    compact,
    rewindThread,
    listQueuedTurns,
    editQueuedTurn,
    cancelQueuedTurn,
    promoteQueuedTurn,
    listVisualizations,
    update,
    remove,
    respondApproval,
    askUser,
  });
});

export const layer = Layer.effect(ThreadService, make);

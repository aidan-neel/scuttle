import type {
  CreateThreadInput,
  RespondApprovalInput,
  SendTurnInput,
  Thread,
  ThreadAttachment,
  ThreadDetail,
  ThreadStatus,
  ThreadTurn,
  UpdateThreadInput,
} from "@scuttle/contracts";
import { type ApprovalId, ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { maybeWrapCaptainPrompt } from "./agent/agentPrompts.ts";
import { readAgentIdForThread } from "./agent/agentWorkStore.ts";
import * as EventBus from "./EventBus.ts";
import * as GitService from "./GitService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProviderService from "./ProviderService.ts";
import {
  deriveThreadInputTitle,
  formatPromptWithAttachments,
  insertThreadRow,
  listAllThreads,
  readThreadById,
  readTurnsForThread,
  recoverInterruptedThreads,
  TITLE_LIMIT,
} from "./threadStore.ts";
import { type ActiveRun, launchTurnExecution, type PendingApprovalResolver } from "./turnRunner.ts";

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
    ) => Effect.Effect<ThreadTurn, ThreadServiceError>;
    readonly interrupt: (threadId: ThreadId) => Effect.Effect<void, ThreadServiceError>;
    readonly settle: (
      threadId: ThreadId,
      settled: boolean,
    ) => Effect.Effect<Thread, ThreadServiceError>;
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

  const list = () => Effect.sync(() => listAllThreads(db));

  const getDetail = Effect.fn("ThreadService.getDetail")(function* (threadId: ThreadId) {
    const thread = readThreadById(db, threadId);
    if (!thread) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    const turns = readTurnsForThread(db, thread);
    return { thread, turns };
  });

  const startTurnInternal = Effect.fn("ThreadService.startTurnInternal")(function* (
    thread: Thread,
    prompt: string,
    attachments: ReadonlyArray<ThreadAttachment> | undefined,
  ) {
    if (activeRuns.has(thread.id)) {
      return yield* new ThreadServiceError({
        detail: "This thread already has a turn running. Stop it before sending another message.",
      });
    }

    const providerConfig = yield* providers
      .getConfig(thread.modelSelection.providerId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));
    if (!providerConfig.enabled) {
      return yield* new ThreadServiceError({
        detail: `Provider "${providerConfig.name}" is disabled. Enable it in Settings.`,
      });
    }

    const seqRow = db
      .query<{ next_seq: number }, [string]>(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM turns WHERE thread_id = ?",
      )
      .get(thread.id);
    const seq = seqRow?.next_seq ?? 1;
    const turnId = TurnId.make(crypto.randomUUID());
    const startedAt = new Date().toISOString();

    const turn: ThreadTurn = {
      id: turnId,
      threadId: thread.id,
      userMessage: prompt,
      assistantMessage: "",
      thinkingText: "",
      status: "running",
      startedAt,
      modelSelection: thread.modelSelection,
      activities: [],
      approvals: [],
    };

    db.prepare(
      `INSERT INTO turns
         (id, thread_id, seq, user_message, assistant_message, thinking_text, status, started_at, model_selection_json)
       VALUES (?, ?, ?, ?, '', '', 'running', ?, ?)`,
    ).run(turnId, thread.id, seq, prompt, startedAt, JSON.stringify(thread.modelSelection));

    updateThreadStatus(thread.id, { kind: "running", startedAt, phase: "thinking" });
    eventBus.publishSync({ kind: "turn.upserted", turn });

    const refreshed = readThreadById(db, thread.id) ?? thread;
    const apiBaseUrl = config.apiBaseUrlRef.url;
    const wrapped = maybeWrapCaptainPrompt(db, refreshed.id, prompt, apiBaseUrl);
    const fullPrompt = formatPromptWithAttachments(wrapped.prompt, attachments);
    const agentId = wrapped.agentId ?? readAgentIdForThread(db, refreshed.id);
    const extraEnv: Record<string, string> = {
      SCUTTLE_API_URL: apiBaseUrl,
      ...(agentId ? { SCUTTLE_AGENT_ID: agentId } : {}),
    };
    launchTurnExecution(runnerDeps, refreshed, turn, fullPrompt, providerConfig, extraEnv);

    return turn;
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
      title: input.title.trim().slice(0, TITLE_LIMIT) || `${project.name} Captain`,
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
  ) {
    let thread = readThreadById(db, threadId);
    if (!thread) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }

    const nextSelection = input.modelSelection ?? thread.modelSelection;
    const providerChanged = nextSelection.providerId !== thread.modelSelection.providerId;
    const nextRuntimeMode = input.runtimeMode ?? thread.runtimeMode;
    const nextInteractionMode = input.interactionMode ?? thread.interactionMode;

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
      providerChanged ? null : (thread.providerSessionId ?? null),
      new Date().toISOString(),
      threadId,
    );

    thread = readThreadById(db, threadId) ?? thread;
    eventBus.publishSync({ kind: "thread.upserted", thread });

    return yield* startTurnInternal(thread, input.prompt, input.attachments);
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
    const existing = readThreadById(db, threadId);
    if (!existing) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE threads SET settled_at = ?, updated_at = ? WHERE id = ?").run(
      settled ? now : null,
      now,
      threadId,
    );
    const updated = readThreadById(db, threadId);
    if (!updated) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    return updated;
  });

  const update = Effect.fn("ThreadService.update")(function* (
    threadId: ThreadId,
    input: UpdateThreadInput,
  ) {
    const existing = readThreadById(db, threadId);
    if (!existing) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    const nextSelection = input.modelSelection ?? existing.modelSelection;
    const providerChanged = nextSelection.providerId !== existing.modelSelection.providerId;
    db.prepare(
      `UPDATE threads
       SET title = ?, provider_id = ?, provider_kind = ?, model = ?, effort = ?,
           runtime_mode = ?, interaction_mode = ?, provider_session_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.title?.trim() || existing.title,
      nextSelection.providerId,
      nextSelection.providerKind,
      nextSelection.model,
      nextSelection.effort ?? null,
      input.runtimeMode ?? existing.runtimeMode,
      input.interactionMode ?? existing.interactionMode,
      providerChanged ? null : (existing.providerSessionId ?? null),
      new Date().toISOString(),
      threadId,
    );
    const updated = readThreadById(db, threadId);
    if (!updated) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
    eventBus.publishSync({ kind: "thread.upserted", thread: updated });
    return updated;
  });

  const remove = Effect.fn("ThreadService.remove")(function* (threadId: ThreadId) {
    const existing = readThreadById(db, threadId);
    if (!existing) {
      return yield* new ThreadServiceError({ detail: `Thread "${threadId}" was not found.` });
    }
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
    const resolver = pendingApprovals.get(approvalId);
    if (!resolver || resolver.threadId !== threadId) {
      return yield* new ThreadServiceError({
        detail: "Approval request is no longer active.",
      });
    }
    pendingApprovals.delete(approvalId);
    db.prepare("UPDATE approvals SET status = 'resolved', selected_option_id = ? WHERE id = ?").run(
      input.optionId,
      approvalId,
    );
    const thread = readThreadById(db, threadId);
    if (thread) {
      const turns = readTurnsForThread(db, thread);
      const turn = turns.find((t) => t.id === resolver.turnId);
      const approval = turn?.approvals.find((a) => a.id === approvalId);
      if (approval) {
        eventBus.publishSync({ kind: "approval.updated", approval });
      }
      if (turn) {
        updateThreadStatus(threadId, {
          kind: "running",
          startedAt: turn.startedAt,
          phase: "working",
        });
      }
    }
    resolver.resolve({
      optionId: input.optionId,
      ...(input.customText ? { customText: input.customText } : {}),
    });
  });

  return ThreadService.of({
    list,
    getDetail,
    create,
    createIdle,
    sendTurn,
    interrupt,
    settle,
    update,
    remove,
    respondApproval,
  });
});

export const layer = Layer.effect(ThreadService, make);

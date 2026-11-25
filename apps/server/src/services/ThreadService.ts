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
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EventBus from "./EventBus.ts";
import * as GitService from "./GitService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProviderService from "./ProviderService.ts";
import {
  listAllThreads,
  readThreadById,
  readTurnsForThread,
  recoverInterruptedThreads,
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

const TITLE_LIMIT = 72;

const deriveTitle = (prompt: string, explicit?: string): string => {
  const candidate = explicit?.trim() || prompt.trim().split(/\r?\n/)[0]?.trim() || "New thread";
  return candidate.slice(0, TITLE_LIMIT);
};

const formatPromptWithAttachments = (
  prompt: string,
  attachments: ReadonlyArray<ThreadAttachment> | undefined,
): string => {
  if (!attachments || attachments.length === 0) return prompt;
  const sections = attachments.map((att) => {
    if (att.content && att.content.length > 0) {
      return `\n\n<attached_file name="${att.name}">\n${att.content.slice(0, 64_000)}\n</attached_file>`;
    }
    if (att.path) {
      return `\n\nAttached file "${att.name}": ${att.path}`;
    }
    return `\n\nAttached file: ${att.name}`;
  });
  return `${prompt}${sections.join("")}`;
};

export class ThreadService extends Context.Service<
  ThreadService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Thread>>;
    readonly getDetail: (threadId: ThreadId) => Effect.Effect<ThreadDetail, ThreadServiceError>;
    readonly create: (input: CreateThreadInput) => Effect.Effect<ThreadDetail, ThreadServiceError>;
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
  const eventBus = yield* EventBus.EventBus;
  const git = yield* GitService.GitService;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderService.ProviderService;

  recoverInterruptedThreads(db);

  const activeRuns = new Map<string, ActiveRun>();
  const pendingApprovals = new Map<string, PendingApprovalResolver>();

  const updateThreadStatus = (threadId: ThreadId, status: ThreadStatus): Thread | null => {
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
      void Effect.runPromise(projects.touchActivity(thread.projectId, summary));
    },
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
    const fullPrompt = formatPromptWithAttachments(prompt, attachments);
    launchTurnExecution(runnerDeps, refreshed, turn, fullPrompt, providerConfig);

    return turn;
  });

  const create = Effect.fn("ThreadService.create")(function* (input: CreateThreadInput) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.mapError((err) => new ThreadServiceError({ detail: err.message })));

    const threadId = ThreadId.make(crypto.randomUUID());
    const title = deriveTitle(input.prompt, input.title);
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
    const runtimeMode = input.runtimeMode ?? "auto";
    const interactionMode = input.interactionMode ?? "default";
    const initialStatus: ThreadStatus = { kind: "running", startedAt: now, phase: "thinking" };

    db.prepare(
      `INSERT INTO threads
         (id, project_id, project_name, title, runtime, branch, worktree_path, cwd, provider_id, provider_kind, model, effort, runtime_mode, interaction_mode, status_json, settled_at, provider_session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      threadId,
      project.id,
      project.name,
      title,
      input.runtime,
      branch,
      worktreePath ?? null,
      cwd,
      input.modelSelection.providerId,
      input.modelSelection.providerKind,
      input.modelSelection.model,
      input.modelSelection.effort ?? null,
      runtimeMode,
      interactionMode,
      JSON.stringify(initialStatus),
      now,
      now,
    );

    const thread = readThreadById(db, threadId);
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
    sendTurn,
    interrupt,
    settle,
    update,
    remove,
    respondApproval,
  });
});

export const layer = Layer.effect(ThreadService, make);

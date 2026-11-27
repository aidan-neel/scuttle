import type { Database } from "bun:sqlite";
import * as NodePath from "node:path";
import type {
  CompactThreadInput,
  CompactThreadResult,
  RewindThreadInput,
  RewindThreadResult,
  Thread,
  ThreadCheckpoint,
  ThreadTurn,
} from "@scuttle/contracts";
import type { ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as CheckpointService from "./CheckpointService.ts";
import type * as EventBus from "./EventBus.ts";
import type * as GitService from "./GitService.ts";
import type * as ProjectService from "./ProjectService.ts";
import { listCheckpointsByThread, readCheckpointByOrdinal } from "./threadCheckpointStore.ts";
import { rolloverThreadSession } from "./threadCompaction.ts";
import { listAllThreads, readThreadById, readTurnsForThread } from "./threadStore.ts";
import type { ActiveRun, PendingApprovalResolver } from "./turnRunner.ts";
import * as VisualizationStore from "./VisualizationStore.ts";

export const findConflictingLocalCwdThread = (
  db: Database,
  thread: Thread,
  activeRuns: ReadonlyMap<string, unknown>,
): Thread | null => {
  const targetCwd = NodePath.resolve(thread.cwd);
  for (const other of listAllThreads(db)) {
    if (other.id === thread.id || other.settledAt !== undefined) continue;
    if (NodePath.resolve(other.cwd) !== targetCwd) continue;
    if (
      activeRuns.has(other.id) ||
      other.status.kind === "running" ||
      other.status.kind === "needs-input"
    ) {
      return other;
    }
    const hasTurns =
      db
        .query<{ readonly id: string }, [string]>(
          "SELECT id FROM turns WHERE thread_id = ? LIMIT 1",
        )
        .get(other.id) !== null;
    if (hasTurns) return other;
    const isAgentPrimary =
      db
        .query<{ readonly id: string }, [string]>(
          "SELECT id FROM agents WHERE primary_thread_id = ? LIMIT 1",
        )
        .get(other.id) !== null;
    if (!isAgentPrimary) return other;
  }
  return null;
};

export const deleteGitCheckpointRefs = async (
  cwd: string,
  refs: ReadonlyArray<string>,
): Promise<void> => {
  for (const ref of refs) {
    try {
      const proc = Bun.spawn(["git", "update-ref", "-d", ref], {
        cwd,
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {
      // Best-effort git ref cleanup after rewind.
    }
  }
};

export const executeRewindDbState = (input: {
  readonly db: Database;
  readonly thread: Thread;
  readonly checkpoint: ThreadCheckpoint;
}): {
  readonly thread: Thread;
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly checkpoints: ReadonlyArray<ThreadCheckpoint>;
  readonly deletedRefs: ReadonlyArray<string>;
  readonly restoredPrompt: string;
} => {
  const { db, thread, checkpoint } = input;
  const now = new Date().toISOString();
  return db.transaction(() => {
    const turnRows = db
      .query<
        { readonly id: string; readonly seq: number; readonly user_message: string },
        [string]
      >("SELECT id, seq, user_message FROM turns WHERE thread_id = ? ORDER BY seq ASC")
      .all(thread.id);
    const byId = checkpoint.turnId ? turnRows.find((r) => r.id === checkpoint.turnId) : undefined;
    const cutoffSeq =
      checkpoint.ordinal === 0
        ? 0
        : (byId?.seq ?? turnRows[checkpoint.ordinal - 1]?.seq ?? turnRows.length);
    const turnsAfter = turnRows.filter((r) => r.seq > cutoffSeq);
    for (const row of turnsAfter) {
      db.query("DELETE FROM activities WHERE turn_id = ?").run(row.id);
      db.query("DELETE FROM approvals WHERE turn_id = ?").run(row.id);
    }
    VisualizationStore.deleteAfterTurn(db, thread.id, cutoffSeq, checkpoint.createdAt);
    db.query("DELETE FROM turns WHERE thread_id = ? AND seq > ?").run(thread.id, cutoffSeq);
    const deletedRefs = db
      .query<{ readonly ref: string }, [string, number]>(
        "SELECT ref FROM thread_checkpoints WHERE thread_id = ? AND ordinal > ?",
      )
      .all(thread.id, checkpoint.ordinal)
      .map((r) => r.ref);
    db.query("DELETE FROM thread_checkpoints WHERE thread_id = ? AND ordinal > ?").run(
      thread.id,
      checkpoint.ordinal,
    );
    const summaryClause = cutoffSeq === 0 ? ", active_summary = NULL" : "";
    db.query(
      `UPDATE threads SET provider_session_id = NULL, last_context_hash = NULL, last_usage_json = NULL,
       status_json = ?, updated_at = ?${summaryClause} WHERE id = ?`,
    ).run(JSON.stringify({ kind: "idle" }), now, thread.id);
    const updatedThread = readThreadById(db, thread.id) ?? {
      ...thread,
      status: { kind: "idle" as const },
      updatedAt: now,
    };
    return {
      thread: updatedThread,
      turns: readTurnsForThread(db, updatedThread),
      checkpoints: listCheckpointsByThread(db, thread.id),
      deletedRefs,
      restoredPrompt: turnsAfter[0]?.user_message ?? "",
    };
  })();
};

export const runThreadRewind = Effect.fn("threadRewind.runThreadRewind")(function* (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly checkpointService: CheckpointService.CheckpointService["Service"];
  readonly activeRuns: ReadonlyMap<string, unknown>;
  readonly thread: Thread;
  readonly input: RewindThreadInput;
}) {
  const { db, eventBus, checkpointService, activeRuns, thread, input } = deps;
  if (activeRuns.has(thread.id) || thread.status.kind === "running") {
    return yield* Effect.fail("Stop the running turn before rewinding this thread.");
  }
  const checkpoint = readCheckpointByOrdinal(db, thread.id, input.checkpointOrdinal);
  if (!checkpoint) {
    return yield* Effect.fail(
      `Checkpoint ordinal ${input.checkpointOrdinal} was not found for thread "${thread.id}".`,
    );
  }
  if (input.restoreFiles && thread.runtime === "local") {
    const conflict = findConflictingLocalCwdThread(db, thread, activeRuns);
    if (conflict) {
      return yield* Effect.fail(
        `Cannot restore files on local thread because "${conflict.title}" shares "${thread.cwd}". Settle it or use worktree runtime isolation.`,
      );
    }
  }
  let filesRestored = false;
  if (input.restoreFiles) {
    yield* checkpointService
      .restoreCheckpoint({ cwd: thread.cwd, ref: checkpoint.ref })
      .pipe(Effect.mapError((err) => err.message));
    filesRestored = true;
  }
  const rewound = executeRewindDbState({ db, thread, checkpoint });
  yield* Effect.promise(() => deleteGitCheckpointRefs(thread.cwd, rewound.deletedRefs));
  eventBus.publishSync({
    kind: "thread.rewound",
    threadId: thread.id,
    checkpointOrdinal: input.checkpointOrdinal,
  });
  eventBus.publishSync({ kind: "thread.upserted", thread: rewound.thread });
  return {
    thread: rewound.thread,
    turns: rewound.turns,
    checkpoints: rewound.checkpoints,
    restoredPrompt: rewound.restoredPrompt,
    filesRestored,
  } satisfies RewindThreadResult;
});

export const removeThreadResources = Effect.fn("threadRewind.removeThreadResources")(
  function* (deps: {
    readonly db: Database;
    readonly eventBus: EventBus.EventBus["Service"];
    readonly git: GitService.GitService["Service"];
    readonly projects: ProjectService.ProjectService["Service"];
    readonly checkpointService: CheckpointService.CheckpointService["Service"];
    readonly existing: Thread;
    readonly threadId: ThreadId;
  }) {
    if (deps.existing.worktreePath) {
      const project = yield* deps.projects.get(deps.existing.projectId).pipe(Effect.option);
      if (project._tag === "Some") {
        yield* deps.git.removeWorktree(project.value.path, deps.existing.worktreePath);
      }
    }
    yield* deps.checkpointService
      .deleteThreadCheckpoints({ cwd: deps.existing.cwd, threadId: deps.threadId })
      .pipe(Effect.ignore);
    deps.db.query("DELETE FROM threads WHERE id = ?").run(deps.threadId);
    deps.eventBus.publishSync({ kind: "thread.deleted", threadId: deps.threadId });
  },
);

export const interruptThreadRun = (
  activeRuns: ReadonlyMap<string, ActiveRun>,
  pendingApprovals: Map<string, PendingApprovalResolver>,
  threadId: ThreadId,
  expectedTurnId?: TurnId,
): void => {
  const active = activeRuns.get(threadId);
  if (expectedTurnId !== undefined && active?.turnId !== expectedTurnId) return;
  if (active) active.controller.abort();
  for (const [approvalId, pending] of pendingApprovals.entries()) {
    if (
      pending.threadId === threadId &&
      (expectedTurnId === undefined || pending.turnId === expectedTurnId)
    ) {
      pending.resolve({ optionId: "decline", dismissed: true });
      pendingApprovals.delete(approvalId);
    }
  }
};

export const settleThreadRow = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  threadId: ThreadId,
  settled: boolean,
): Thread => {
  const now = new Date().toISOString();
  db.query("UPDATE threads SET settled_at = ?, updated_at = ? WHERE id = ?").run(
    settled ? now : null,
    now,
    threadId,
  );
  const updated = readThreadById(db, threadId);
  if (!updated) throw new Error(`Thread "${threadId}" was not found.`);
  eventBus.publishSync({ kind: "thread.upserted", thread: updated });
  return updated;
};

export const compactThreadState = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  thread: Thread,
  input?: CompactThreadInput,
): CompactThreadResult => {
  const result = rolloverThreadSession({
    db,
    thread,
    ...(input?.focus !== undefined ? { focus: input.focus } : {}),
    forceSummary: true,
  });
  eventBus.publishSync({ kind: "thread.upserted", thread: result.thread });
  return result;
};

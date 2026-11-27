import type { Database } from "bun:sqlite";
import type { Thread, ThreadCheckpoint } from "@scuttle/contracts";
import { ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as CheckpointService from "./CheckpointService.ts";
import type * as EventBus from "./EventBus.ts";
import { readThreadById } from "./threadStore.ts";

interface CheckpointRow {
  readonly id: string;
  readonly thread_id: string;
  readonly turn_id: string | null;
  readonly ordinal: number;
  readonly ref: string;
  readonly commit_oid: string;
  readonly files_changed: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly created_at: string;
}

const rowToCheckpoint = (row: CheckpointRow): ThreadCheckpoint => ({
  id: row.id,
  threadId: ThreadId.make(row.thread_id),
  ...(row.turn_id ? { turnId: TurnId.make(row.turn_id) } : {}),
  ordinal: row.ordinal,
  ref: row.ref,
  commitOid: row.commit_oid,
  filesChanged: row.files_changed,
  insertions: row.insertions,
  deletions: row.deletions,
  createdAt: row.created_at,
});

export const listCheckpointsByThread = (
  db: Database,
  threadId: ThreadId,
): ReadonlyArray<ThreadCheckpoint> =>
  db
    .query<CheckpointRow, [string]>(
      "SELECT * FROM thread_checkpoints WHERE thread_id = ? ORDER BY ordinal ASC",
    )
    .all(threadId)
    .map(rowToCheckpoint);

export const readCheckpointByOrdinal = (
  db: Database,
  threadId: ThreadId,
  ordinal: number,
): ThreadCheckpoint | null => {
  const row = db
    .query<CheckpointRow, [string, number]>(
      "SELECT * FROM thread_checkpoints WHERE thread_id = ? AND ordinal = ?",
    )
    .get(threadId, ordinal);
  return row ? rowToCheckpoint(row) : null;
};

const insertCheckpointRow = (db: Database, cp: ThreadCheckpoint): ThreadCheckpoint => {
  db.query(
    `INSERT OR IGNORE INTO thread_checkpoints
       (id, thread_id, turn_id, ordinal, ref, commit_oid, files_changed, insertions, deletions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    cp.id,
    cp.threadId,
    cp.turnId ?? null,
    cp.ordinal,
    cp.ref,
    cp.commitOid,
    cp.filesChanged,
    cp.insertions,
    cp.deletions,
    cp.createdAt,
  );
  return readCheckpointByOrdinal(db, cp.threadId, cp.ordinal) ?? cp;
};

export const ensureBaselineCheckpoint = async (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly checkpointService: CheckpointService.CheckpointService["Service"];
  readonly thread: Thread;
}): Promise<ThreadCheckpoint | null> => {
  const { db, eventBus, checkpointService, thread } = input;
  if (readCheckpointByOrdinal(db, thread.id, 0) !== null) return null;
  try {
    const captured = await Effect.runPromise(
      checkpointService.captureCheckpoint({ cwd: thread.cwd, threadId: thread.id, ordinal: 0 }),
    );
    if (!captured || !readThreadById(db, thread.id) || readCheckpointByOrdinal(db, thread.id, 0)) {
      return null;
    }
    const stored = insertCheckpointRow(db, {
      id: crypto.randomUUID(),
      threadId: thread.id,
      ordinal: 0,
      ref: captured.ref,
      commitOid: captured.commitOid,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      createdAt: captured.capturedAt,
    });
    eventBus.publishSync({ kind: "checkpoint.created", checkpoint: stored });
    return stored;
  } catch {
    return null;
  }
};

export const capturePostTurnCheckpoint = async (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly checkpointService: CheckpointService.CheckpointService["Service"];
  readonly thread: Thread;
  readonly turnId: TurnId;
}): Promise<ThreadCheckpoint | null> => {
  const { db, eventBus, checkpointService, thread, turnId } = input;
  try {
    const prevRow = db
      .query<CheckpointRow, [string]>(
        "SELECT * FROM thread_checkpoints WHERE thread_id = ? ORDER BY ordinal DESC LIMIT 1",
      )
      .get(thread.id);
    const prev = prevRow ? rowToCheckpoint(prevRow) : null;
    const ordinal = prev ? prev.ordinal + 1 : 1;
    const captured = await Effect.runPromise(
      checkpointService.captureCheckpoint({ cwd: thread.cwd, threadId: thread.id, ordinal }),
    );
    if (!captured || !readThreadById(db, thread.id)) return null;
    const diff = prev
      ? await Effect.runPromise(
          checkpointService
            .diffCheckpointSummary({ cwd: thread.cwd, fromRef: prev.ref, toRef: captured.ref })
            .pipe(
              Effect.catch(() => Effect.succeed({ filesChanged: 0, insertions: 0, deletions: 0 })),
            ),
        )
      : { filesChanged: 0, insertions: 0, deletions: 0 };
    const stored = insertCheckpointRow(db, {
      id: crypto.randomUUID(),
      threadId: thread.id,
      turnId,
      ordinal,
      ref: captured.ref,
      commitOid: captured.commitOid,
      filesChanged: diff.filesChanged,
      insertions: diff.insertions,
      deletions: diff.deletions,
      createdAt: captured.capturedAt,
    });
    eventBus.publishSync({ kind: "checkpoint.created", checkpoint: stored });
    return stored;
  } catch {
    return null;
  }
};

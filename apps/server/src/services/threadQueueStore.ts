import type { Database } from "bun:sqlite";
import {
  type EditQueuedTurnInput,
  type InteractionMode,
  ModelSelection,
  type QueuedTurn,
  type QueuedTurnStatus,
  type RuntimeMode,
  ThreadAttachment,
} from "@scuttle/contracts";
import { ThreadId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import type { ResolvedAttachment } from "../providers/types.ts";
import { tryReadStoredAttachment } from "./AttachmentService.ts";
import { lookupEnum, safeJsonParse } from "./turnQueries.ts";

interface QueuedTurnRow {
  readonly id: string;
  readonly thread_id: string;
  readonly prompt: string;
  readonly attachments_json: string | null;
  readonly model_selection_json: string | null;
  readonly runtime_mode: string | null;
  readonly interaction_mode: string | null;
  readonly position: number;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const RUNTIME_MODES = {
  auto: "auto",
  "approval-required": "approval-required",
  "full-access": "full-access",
} as const satisfies Record<RuntimeMode, RuntimeMode>;

const INTERACTION_MODES = {
  default: "default",
  plan: "plan",
} as const satisfies Record<InteractionMode, InteractionMode>;

const QUEUED_STATUSES = {
  queued: "queued",
  promoted: "promoted",
  canceled: "canceled",
} as const satisfies Record<QueuedTurnStatus, QueuedTurnStatus>;

const decodeAttachments = Schema.decodeUnknownOption(Schema.Array(ThreadAttachment));
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);

const rowToQueuedTurn = (row: QueuedTurnRow): QueuedTurn => {
  const attOpt = row.attachments_json
    ? decodeAttachments(safeJsonParse(row.attachments_json))
    : null;
  const msOpt = row.model_selection_json
    ? decodeModelSelection(safeJsonParse(row.model_selection_json))
    : null;
  const runtimeMode = lookupEnum(RUNTIME_MODES, row.runtime_mode);
  const interactionMode = lookupEnum(INTERACTION_MODES, row.interaction_mode);
  return {
    id: row.id,
    threadId: ThreadId.make(row.thread_id),
    prompt: row.prompt,
    ...(attOpt && attOpt._tag === "Some" && attOpt.value.length > 0
      ? { attachments: [...attOpt.value] }
      : {}),
    ...(msOpt && msOpt._tag === "Some" ? { modelSelection: msOpt.value } : {}),
    ...(runtimeMode !== undefined ? { runtimeMode } : {}),
    ...(interactionMode !== undefined ? { interactionMode } : {}),
    position: row.position,
    status: lookupEnum(QUEUED_STATUSES, row.status) ?? "queued",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listQueuedTurnsByThread = (
  db: Database,
  threadId: ThreadId,
): ReadonlyArray<QueuedTurn> =>
  db
    .query<QueuedTurnRow, [string]>(
      "SELECT * FROM queued_turns WHERE thread_id = ? AND status = 'queued' ORDER BY position ASC, created_at ASC, rowid ASC",
    )
    .all(threadId)
    .map(rowToQueuedTurn);

export const readQueuedTurnById = (
  db: Database,
  threadId: ThreadId,
  queuedId: string,
): QueuedTurn | null => {
  const row = db
    .query<QueuedTurnRow, [string, string]>(
      "SELECT * FROM queued_turns WHERE id = ? AND thread_id = ? AND status = 'queued'",
    )
    .get(queuedId, threadId);
  return row ? rowToQueuedTurn(row) : null;
};

export const enqueueTurn = (
  db: Database,
  input: {
    readonly threadId: ThreadId;
    readonly prompt: string;
    readonly attachments?: ReadonlyArray<ThreadAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly runtimeMode?: RuntimeMode;
    readonly interactionMode?: InteractionMode;
    readonly front?: boolean;
  },
): QueuedTurn => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const attachmentsJson =
    input.attachments && input.attachments.length > 0 ? JSON.stringify(input.attachments) : null;
  const modelSelectionJson = input.modelSelection ? JSON.stringify(input.modelSelection) : null;
  return db.transaction(() => {
    let position: number;
    if (input.front) {
      db.query(
        "UPDATE queued_turns SET position = position + 1, updated_at = ? WHERE thread_id = ? AND status = 'queued'",
      ).run(now, input.threadId);
      position = 0;
    } else {
      const maxRow = db
        .query<{ readonly next_pos: number }, [string]>(
          "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM queued_turns WHERE thread_id = ? AND status = 'queued'",
        )
        .get(input.threadId);
      position = maxRow?.next_pos ?? 0;
    }
    db.query(
      `INSERT INTO queued_turns
         (id, thread_id, prompt, attachments_json, model_selection_json, runtime_mode, interaction_mode, position, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    ).run(
      id,
      input.threadId,
      input.prompt,
      attachmentsJson,
      modelSelectionJson,
      input.runtimeMode ?? null,
      input.interactionMode ?? null,
      position,
      now,
      now,
    );
    const row = db
      .query<QueuedTurnRow, [string]>("SELECT * FROM queued_turns WHERE id = ?")
      .get(id);
    if (!row) throw new Error(`Failed to read inserted queued turn "${id}".`);
    return rowToQueuedTurn(row);
  })();
};

export const editQueuedTurnRow = (
  db: Database,
  threadId: ThreadId,
  queuedId: string,
  input: EditQueuedTurnInput,
): QueuedTurn | null => {
  const existing = readQueuedTurnById(db, threadId, queuedId);
  if (!existing) return null;
  const nextAtt = input.attachments !== undefined ? input.attachments : existing.attachments;
  const attachmentsJson = nextAtt && nextAtt.length > 0 ? JSON.stringify(nextAtt) : null;
  db.query(
    "UPDATE queued_turns SET prompt = ?, attachments_json = ?, updated_at = ? WHERE id = ? AND thread_id = ? AND status = 'queued'",
  ).run(input.prompt, attachmentsJson, new Date().toISOString(), queuedId, threadId);
  return readQueuedTurnById(db, threadId, queuedId);
};

export const cancelQueuedTurnRow = (db: Database, threadId: ThreadId, queuedId: string): boolean =>
  db
    .query(
      "UPDATE queued_turns SET status = 'canceled', updated_at = ? WHERE id = ? AND thread_id = ? AND status = 'queued'",
    )
    .run(new Date().toISOString(), queuedId, threadId).changes > 0;

export const markQueuedTurnPromoted = (
  db: Database,
  threadId: ThreadId,
  queuedId: string,
): boolean =>
  db
    .query(
      "UPDATE queued_turns SET status = 'promoted', updated_at = ? WHERE id = ? AND thread_id = ? AND status = 'queued'",
    )
    .run(new Date().toISOString(), queuedId, threadId).changes > 0;

export const moveQueuedTurnToFront = (
  db: Database,
  threadId: ThreadId,
  queuedId: string,
): QueuedTurn | null => {
  const now = new Date().toISOString();
  return db.transaction(() => {
    if (!readQueuedTurnById(db, threadId, queuedId)) return null;
    db.query(
      "UPDATE queued_turns SET position = position + 1, updated_at = ? WHERE thread_id = ? AND status = 'queued' AND id != ?",
    ).run(now, threadId, queuedId);
    db.query(
      "UPDATE queued_turns SET position = 0, updated_at = ? WHERE id = ? AND thread_id = ? AND status = 'queued'",
    ).run(now, queuedId, threadId);
    return readQueuedTurnById(db, threadId, queuedId);
  })();
};

export const popNextQueuedTurn = (db: Database, threadId: ThreadId): QueuedTurn | null => {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const row = db
      .query<QueuedTurnRow, [string]>(
        "SELECT * FROM queued_turns WHERE thread_id = ? AND status = 'queued' ORDER BY position ASC, created_at ASC, rowid ASC LIMIT 1",
      )
      .get(threadId);
    if (!row) return null;
    db.query("UPDATE queued_turns SET status = 'promoted', updated_at = ? WHERE id = ?").run(
      now,
      row.id,
    );
    return rowToQueuedTurn({ ...row, status: "promoted", updated_at: now });
  })();
};

export const resolveAttachmentPayloads = (
  db: Database,
  attachments: ReadonlyArray<ThreadAttachment> | undefined,
): ReadonlyArray<ResolvedAttachment> => {
  const resolved: ResolvedAttachment[] = [];
  for (const att of attachments ?? []) {
    if (att.id === undefined) continue;
    const stored = tryReadStoredAttachment(db, att.id);
    if (stored) resolved.push(stored);
  }
  return resolved;
};

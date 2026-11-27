import type { Database } from "bun:sqlite";
import {
  decodeScuttleVizSpec,
  type ScuttleVizSpec,
  type ThreadVisualization,
  VisualizationId,
} from "@scuttle/contracts";
import { ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Exit from "effect/Exit";
import type * as EventBus from "./EventBus.ts";

interface VisualizationRow {
  readonly id: string;
  readonly thread_id: string;
  readonly turn_id: string | null;
  readonly title: string;
  readonly spec_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const rowToVisualization = (row: VisualizationRow): ThreadVisualization | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.spec_json);
  } catch {
    return null;
  }
  const decoded = decodeScuttleVizSpec(parsed);
  if (Exit.isFailure(decoded)) return null;
  return {
    id: VisualizationId.make(row.id),
    threadId: ThreadId.make(row.thread_id),
    ...(row.turn_id ? { turnId: TurnId.make(row.turn_id) } : {}),
    title: row.title,
    spec: decoded.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listByThread = (
  db: Database,
  threadId: ThreadId,
): ReadonlyArray<ThreadVisualization> => {
  const rows = db
    .query<VisualizationRow, [string]>(
      "SELECT * FROM thread_visualizations WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(threadId);
  const out: ThreadVisualization[] = [];
  for (const row of rows) {
    const viz = rowToVisualization(row);
    if (viz) out.push(viz);
  }
  return out;
};

export const upsertVisualization = (
  db: Database,
  input: {
    readonly id?: VisualizationId;
    readonly threadId: ThreadId;
    readonly turnId?: TurnId;
    readonly title?: string;
    readonly spec: ScuttleVizSpec;
  },
  eventBus?: EventBus.EventBus["Service"],
): ThreadVisualization => {
  const decoded = decodeScuttleVizSpec(input.spec);
  if (Exit.isFailure(decoded)) {
    throw new Error(`Invalid visualization spec: ${String(decoded.cause)}`);
  }
  const spec = decoded.value;
  const now = new Date().toISOString();
  const id = input.id ?? VisualizationId.make(crypto.randomUUID());
  const title = input.title?.trim() || spec.title;
  const specJson = JSON.stringify(spec);

  const existing = db
    .query<VisualizationRow, [string, string]>(
      "SELECT * FROM thread_visualizations WHERE id = ? AND thread_id = ?",
    )
    .get(id, input.threadId);

  if (existing) {
    db.query(
      "UPDATE thread_visualizations SET turn_id = ?, title = ?, spec_json = ?, updated_at = ? WHERE id = ? AND thread_id = ?",
    ).run(input.turnId ?? existing.turn_id, title, specJson, now, id, input.threadId);
  } else {
    db.query(
      `INSERT INTO thread_visualizations (id, thread_id, turn_id, title, spec_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.threadId, input.turnId ?? null, title, specJson, now, now);
  }

  const stored = db
    .query<VisualizationRow, [string]>("SELECT * FROM thread_visualizations WHERE id = ?")
    .get(id);
  const visualization: ThreadVisualization = (stored ? rowToVisualization(stored) : null) ?? {
    id,
    threadId: input.threadId,
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
    title,
    spec,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  };

  eventBus?.publishSync({ kind: "viz.upserted", visualization });
  return visualization;
};

export const deleteAfterTurn = (
  db: Database,
  threadId: ThreadId,
  afterTurnSeq: number,
  cutoffCreatedAt?: string,
): number => {
  let deleted = 0;
  deleted += db
    .query(
      `DELETE FROM thread_visualizations
       WHERE thread_id = ?
         AND turn_id IN (SELECT id FROM turns WHERE thread_id = ? AND seq > ?)`,
    )
    .run(threadId, threadId, afterTurnSeq).changes;

  if (cutoffCreatedAt !== undefined) {
    deleted += db
      .query(
        `DELETE FROM thread_visualizations
         WHERE thread_id = ? AND turn_id IS NULL AND created_at > ?`,
      )
      .run(threadId, cutoffCreatedAt).changes;
  } else if (afterTurnSeq <= 0) {
    deleted += db
      .query("DELETE FROM thread_visualizations WHERE thread_id = ?")
      .run(threadId).changes;
  }
  return deleted;
};

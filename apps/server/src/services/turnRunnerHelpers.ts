import type { Database } from "bun:sqlite";
import type {
  ActivityItem,
  ModelPerfRun,
  PendingApproval,
  RecordMeasuredRunInput,
  Thread,
  TurnUsage,
} from "@scuttle/contracts";
import type { ThreadId, TurnId } from "@scuttle/shared/ids";
import type * as EventBus from "./EventBus.ts";
import { readAgentByPrimaryThreadId } from "./agent/agentStore.ts";
import { readThreadById } from "./threadStore.ts";
import { deriveThreadTitle, shouldRefreshThreadTitle } from "./threadTitle.ts";
import { readCompletedTurnCount, readRecentCompletedTitleTurns } from "./turnQueries.ts";

export const insertActivityRow = (db: Database, seq: number, item: ActivityItem): void => {
  db.query(
    `INSERT INTO activities (id, turn_id, thread_id, seq, kind, label, active_label, detail, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.turnId,
    item.threadId,
    seq,
    item.kind,
    item.label,
    item.activeLabel,
    item.detail ?? null,
    item.status,
    item.startedAt,
  );
};

export const updateActivityRow = (db: Database, item: ActivityItem): void => {
  db.query(
    "UPDATE activities SET status = ?, label = ?, active_label = ?, detail = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
  ).run(
    item.status,
    item.label,
    item.activeLabel,
    item.detail ?? null,
    item.completedAt ?? null,
    item.durationMs ?? null,
    item.id,
  );
};

export const finishActivityRow = (db: Database, item: ActivityItem): void => {
  db.query("UPDATE activities SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?").run(
    item.status,
    item.completedAt ?? null,
    item.durationMs ?? 0,
    item.id,
  );
};

export const insertApprovalRow = (db: Database, approval: PendingApproval): void => {
  db.query(
    `INSERT INTO approvals (id, thread_id, turn_id, kind, title, description, command, options_json, questions_json, status, selected_option_id, answers_json, dismissed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
  ).run(
    approval.id,
    approval.threadId,
    approval.turnId,
    approval.kind,
    approval.title,
    approval.description ?? null,
    approval.command ?? null,
    JSON.stringify(approval.options),
    approval.questions ? JSON.stringify(approval.questions) : null,
    approval.status,
    approval.createdAt,
  );
};

export const refreshThreadTitleOnSettle = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  threadId: ThreadId,
): void => {
  try {
    if (readAgentByPrimaryThreadId(db, threadId) !== null) return;
    if (!shouldRefreshThreadTitle(readCompletedTurnCount(db, threadId))) return;
    const current = readThreadById(db, threadId);
    if (!current) return;
    const nextTitle = deriveThreadTitle(readRecentCompletedTitleTurns(db, threadId, 3));
    if (nextTitle.length === 0 || nextTitle === current.title) return;
    db.query("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?").run(
      nextTitle,
      new Date().toISOString(),
      threadId,
    );
    const refreshed = readThreadById(db, threadId);
    if (refreshed) eventBus.publishSync({ kind: "thread.upserted", thread: refreshed });
  } catch {
    return;
  }
};

export const emitMeasuredTurnPerformance = async (input: {
  readonly recordPerformance?: (payload: RecordMeasuredRunInput) => Promise<ModelPerfRun | null>;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly isClosed: () => boolean;
  readonly thread: Thread;
  readonly turnId: TurnId;
  readonly durationMs: number;
  readonly costUsd?: number;
  readonly usage?: TurnUsage;
  readonly firstTokenMs?: number;
}): Promise<void> => {
  if (!input.recordPerformance || input.isClosed()) return;
  try {
    const run = await input.recordPerformance({
      providerId: input.thread.modelSelection.providerId,
      model: input.thread.modelSelection.model,
      ...(input.thread.modelSelection.effort !== undefined
        ? { effort: input.thread.modelSelection.effort }
        : {}),
      threadId: input.thread.id,
      turnId: input.turnId,
      durationMs: input.durationMs,
      ...(input.firstTokenMs !== undefined ? { firstTokenMs: input.firstTokenMs } : {}),
      ...(input.usage?.inputTokens !== undefined ? { inputTokens: input.usage.inputTokens } : {}),
      ...(input.usage?.outputTokens !== undefined
        ? { outputTokens: input.usage.outputTokens }
        : {}),
      ...(input.usage?.cacheReadTokens !== undefined
        ? { cacheReadTokens: input.usage.cacheReadTokens }
        : {}),
      ...(input.costUsd !== undefined && input.costUsd > 0 ? { costUsd: input.costUsd } : {}),
    });
    if (run && !input.isClosed()) input.eventBus.publishSync({ kind: "perf.recorded", run });
  } catch {
    // Never block turn settlement on telemetry persistence.
  }
};

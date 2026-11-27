import type { Database } from "bun:sqlite";
import {
  type ActivityItem,
  type ActivityKind,
  type ActivityStatus,
  ApprovalOption,
  ModelSelection,
  type PendingApproval,
  type Thread,
  type ThreadTurn,
  type TurnOrigin,
  type TurnStatus,
  TurnUsage,
} from "@scuttle/contracts";
import { ActivityId, ApprovalId, ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import type { TitleTurn } from "./threadTitle.ts";

export interface TurnRow {
  readonly id: string;
  readonly thread_id: string;
  readonly seq: number;
  readonly origin: string;
  readonly session_epoch?: number | null;
  readonly user_message: string;
  readonly assistant_message: string;
  readonly thinking_text: string;
  readonly status: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly duration_ms: number | null;
  readonly cost_usd: number;
  readonly usage_json?: string | null;
  readonly error: string | null;
  readonly model_selection_json: string;
}

export interface ActivityRow {
  readonly id: string;
  readonly turn_id: string;
  readonly thread_id: string;
  readonly seq: number;
  readonly kind: string;
  readonly label: string;
  readonly active_label: string;
  readonly detail: string | null;
  readonly status: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly duration_ms: number | null;
}

export interface ApprovalRow {
  readonly id: string;
  readonly thread_id: string;
  readonly turn_id: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string | null;
  readonly command: string | null;
  readonly options_json: string;
  readonly status: string;
  readonly selected_option_id: string | null;
  readonly created_at: string;
}

const TURN_ORIGINS: Readonly<Record<string, TurnOrigin>> = {
  user: "user",
  system: "system",
};

const TURN_STATUSES: Readonly<Record<string, TurnStatus>> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  interrupted: "interrupted",
};

const ACTIVITY_KINDS: Readonly<Record<string, ActivityKind>> = {
  thinking: "thinking",
  command: "command",
  file: "file",
  search: "search",
  tool: "tool",
  error: "error",
};

const ACTIVITY_STATUSES: Readonly<Record<string, ActivityStatus>> = {
  running: "running",
  completed: "completed",
  failed: "failed",
};

export const lookupEnum = <T>(
  table: Readonly<Record<string, T>>,
  value: string | null | undefined,
): T | undefined =>
  value !== null && value !== undefined && Object.hasOwn(table, value) ? table[value] : undefined;

export const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const decodeTurnUsage = Schema.decodeUnknownOption(TurnUsage);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeApprovalOptions = Schema.decodeUnknownOption(Schema.Array(ApprovalOption));

export const rowToActivity = (row: ActivityRow): ActivityItem => ({
  id: ActivityId.make(row.id),
  turnId: TurnId.make(row.turn_id),
  threadId: ThreadId.make(row.thread_id),
  kind: lookupEnum(ACTIVITY_KINDS, row.kind) ?? "tool",
  label: row.label,
  activeLabel: row.active_label,
  ...(row.detail ? { detail: row.detail } : {}),
  status: lookupEnum(ACTIVITY_STATUSES, row.status) ?? "completed",
  startedAt: row.started_at,
  ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
});

export const rowToApproval = (row: ApprovalRow): PendingApproval => {
  const optionsOpt = decodeApprovalOptions(safeJsonParse(row.options_json));
  return {
    id: ApprovalId.make(row.id),
    threadId: ThreadId.make(row.thread_id),
    turnId: TurnId.make(row.turn_id),
    kind: row.kind === "question" ? "question" : "permission",
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.command ? { command: row.command } : {}),
    options: optionsOpt._tag === "Some" ? [...optionsOpt.value] : [],
    status: row.status === "resolved" ? "resolved" : "pending",
    ...(row.selected_option_id ? { selectedOptionId: row.selected_option_id } : {}),
    createdAt: row.created_at,
  };
};

export const rowToTurn = (
  row: TurnRow,
  fallbackModelSelection: ModelSelection,
  activities: ActivityItem[],
  approvals: PendingApproval[],
): ThreadTurn => {
  const origin = lookupEnum(TURN_ORIGINS, row.origin);
  const status = lookupEnum(TURN_STATUSES, row.status) ?? "completed";
  const msOpt = decodeModelSelection(safeJsonParse(row.model_selection_json));
  const usageOpt = row.usage_json ? decodeTurnUsage(safeJsonParse(row.usage_json)) : null;
  return {
    id: TurnId.make(row.id),
    threadId: ThreadId.make(row.thread_id),
    ...(origin === "system" ? { origin: "system" } : {}),
    ...(typeof row.session_epoch === "number" ? { sessionEpoch: row.session_epoch } : {}),
    userMessage: row.user_message,
    assistantMessage: row.assistant_message,
    thinkingText: row.thinking_text,
    status,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.cost_usd > 0 ? { costUsd: row.cost_usd } : {}),
    ...(usageOpt && usageOpt._tag === "Some" ? { usage: usageOpt.value } : {}),
    ...(row.error ? { error: row.error } : {}),
    modelSelection: msOpt._tag === "Some" ? msOpt.value : fallbackModelSelection,
    activities,
    approvals,
  };
};

export const readTurnsForThread = (db: Database, thread: Thread): ReadonlyArray<ThreadTurn> => {
  const turnRows = db
    .query<TurnRow, [string]>("SELECT * FROM turns WHERE thread_id = ? ORDER BY seq ASC")
    .all(thread.id);
  const activityRows = db
    .query<ActivityRow, [string]>("SELECT * FROM activities WHERE thread_id = ? ORDER BY seq ASC")
    .all(thread.id);
  const approvalRows = db
    .query<ApprovalRow, [string]>(
      "SELECT * FROM approvals WHERE thread_id = ? ORDER BY created_at ASC",
    )
    .all(thread.id);

  const activitiesByTurn = new Map<string, ActivityItem[]>();
  for (const row of activityRows) {
    const list = activitiesByTurn.get(row.turn_id) ?? [];
    list.push(rowToActivity(row));
    activitiesByTurn.set(row.turn_id, list);
  }

  const approvalsByTurn = new Map<string, PendingApproval[]>();
  for (const row of approvalRows) {
    const list = approvalsByTurn.get(row.turn_id) ?? [];
    list.push(rowToApproval(row));
    approvalsByTurn.set(row.turn_id, list);
  }

  return turnRows.map((row) =>
    rowToTurn(
      row,
      thread.modelSelection,
      activitiesByTurn.get(row.id) ?? [],
      approvalsByTurn.get(row.id) ?? [],
    ),
  );
};

export const readTurnChildren = (
  db: Database,
  turnId: string,
): { readonly activities: ActivityItem[]; readonly approvals: PendingApproval[] } => {
  const activityRows = db
    .query<ActivityRow, [string]>("SELECT * FROM activities WHERE turn_id = ? ORDER BY seq ASC")
    .all(turnId);
  const approvalRows = db
    .query<ApprovalRow, [string]>(
      "SELECT * FROM approvals WHERE turn_id = ? ORDER BY created_at ASC",
    )
    .all(turnId);
  return {
    activities: activityRows.map(rowToActivity),
    approvals: approvalRows.map(rowToApproval),
  };
};

export const readTurnById = (
  db: Database,
  turnId: string,
  fallbackModelSelection: ModelSelection,
): ThreadTurn | null => {
  const row = db.query<TurnRow, [string]>("SELECT * FROM turns WHERE id = ?").get(turnId);
  if (!row) return null;
  const { activities, approvals } = readTurnChildren(db, turnId);
  return rowToTurn(row, fallbackModelSelection, activities, approvals);
};

export const readApprovalById = (db: Database, approvalId: string): PendingApproval | null => {
  const row = db
    .query<ApprovalRow, [string]>("SELECT * FROM approvals WHERE id = ?")
    .get(approvalId);
  return row ? rowToApproval(row) : null;
};

export const readTurnStartedAt = (db: Database, turnId: string): string | null => {
  const row = db
    .query<{ readonly started_at: string }, [string]>("SELECT started_at FROM turns WHERE id = ?")
    .get(turnId);
  return row?.started_at ?? null;
};

export const readCompletedTurnCount = (db: Database, threadId: string): number => {
  const row = db
    .query<{ readonly count: number }, [string]>(
      "SELECT COUNT(*) AS count FROM turns WHERE thread_id = ? AND status = 'completed'",
    )
    .get(threadId);
  return row?.count ?? 0;
};

export const readRecentCompletedTitleTurns = (
  db: Database,
  threadId: string,
  limit: number,
): ReadonlyArray<TitleTurn> => {
  const rows = db
    .query<{ readonly user_message: string; readonly assistant_message: string }, [string, number]>(
      "SELECT user_message, assistant_message FROM turns WHERE thread_id = ? AND status = 'completed' ORDER BY seq DESC LIMIT ?",
    )
    .all(threadId, limit);
  return rows.reverse().map((row) => ({
    userMessage: row.user_message,
    assistantMessage: row.assistant_message,
  }));
};

export const hasCompletedTurnInEpoch = (
  db: Database,
  threadId: string,
  sessionEpoch: number,
): boolean => {
  const row = db
    .query<{ readonly present: number }, [string, number]>(
      "SELECT 1 AS present FROM turns WHERE thread_id = ? AND session_epoch = ? AND status = 'completed' LIMIT 1",
    )
    .get(threadId, sessionEpoch);
  return row !== null;
};

export const insertTurnRow = (db: Database, seq: number, turn: ThreadTurn): void => {
  db.query(
    `INSERT INTO turns
       (id, thread_id, seq, origin, session_epoch, user_message, assistant_message, thinking_text, status, started_at, model_selection_json)
     VALUES (?, ?, ?, ?, ?, ?, '', '', 'running', ?, ?)`,
  ).run(
    turn.id,
    turn.threadId,
    seq,
    turn.origin ?? "user",
    turn.sessionEpoch ?? 0,
    turn.userMessage,
    turn.startedAt,
    JSON.stringify(turn.modelSelection),
  );
};

export const updateTurnOutcomeRow = (
  db: Database,
  threadId: string,
  turnEpoch: number,
  next: ThreadTurn,
): void => {
  db.query(
    `UPDATE turns
     SET assistant_message = ?, thinking_text = ?, status = ?, completed_at = ?, duration_ms = ?, cost_usd = ?, error = ?, usage_json = ?
     WHERE id = ?`,
  ).run(
    next.assistantMessage,
    next.thinkingText,
    next.status,
    next.completedAt ?? null,
    next.durationMs ?? null,
    next.costUsd ?? 0,
    next.error ?? null,
    next.usage ? JSON.stringify(next.usage) : null,
    next.id,
  );
  if (next.usage) {
    db.query(
      "UPDATE threads SET last_usage_json = ?, updated_at = ? WHERE id = ? AND session_epoch = ?",
    ).run(
      JSON.stringify(next.usage),
      next.completedAt ?? new Date().toISOString(),
      threadId,
      turnEpoch,
    );
  }
};

import type { Database } from "bun:sqlite";
import {
  type ActivityItem,
  ActivityKind,
  ActivityStatus,
  ApprovalOption,
  EffortLevel,
  InteractionMode,
  ModelSelection,
  type PendingApproval,
  ProviderKind,
  RuntimeMode,
  type Thread,
  type ThreadAttachment,
  ThreadRuntime,
  ThreadStatus,
  type ThreadTurn,
  TurnOrigin,
  TurnStatus,
} from "@scuttle/contracts";
import {
  ActivityId,
  ApprovalId,
  ProjectId,
  ProviderId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

export interface ThreadRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly title: string;
  readonly runtime: string;
  readonly branch: string;
  readonly worktree_path: string | null;
  readonly cwd: string;
  readonly provider_id: string;
  readonly provider_kind: string;
  readonly model: string;
  readonly effort: string | null;
  readonly runtime_mode: string;
  readonly interaction_mode: string;
  readonly status_json: string;
  readonly cost_usd?: number | null;
  readonly settled_at: string | null;
  readonly provider_session_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface TurnRow {
  readonly id: string;
  readonly thread_id: string;
  readonly seq: number;
  readonly origin: string;
  readonly user_message: string;
  readonly assistant_message: string;
  readonly thinking_text: string;
  readonly status: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly duration_ms: number | null;
  readonly cost_usd: number;
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

const decodeRuntime = Schema.decodeUnknownOption(ThreadRuntime);
const decodeProviderKind = Schema.decodeUnknownOption(ProviderKind);
const decodeEffort = Schema.decodeUnknownOption(EffortLevel);
const decodeRuntimeMode = Schema.decodeUnknownOption(RuntimeMode);
const decodeInteractionMode = Schema.decodeUnknownOption(InteractionMode);
const decodeThreadStatus = Schema.decodeUnknownOption(ThreadStatus);
const decodeTurnOrigin = Schema.decodeUnknownOption(TurnOrigin);
const decodeTurnStatus = Schema.decodeUnknownOption(TurnStatus);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeActivityKind = Schema.decodeUnknownOption(ActivityKind);
const decodeActivityStatus = Schema.decodeUnknownOption(ActivityStatus);
const decodeApprovalOptions = Schema.decodeUnknownOption(Schema.Array(ApprovalOption));

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const rowToThread = (row: ThreadRow): Thread => {
  const runtimeOpt = decodeRuntime(row.runtime);
  const kindOpt = decodeProviderKind(row.provider_kind);
  const effortOpt = row.effort ? decodeEffort(row.effort) : null;
  const rmOpt = decodeRuntimeMode(row.runtime_mode);
  const imOpt = decodeInteractionMode(row.interaction_mode);
  const statusOpt = decodeThreadStatus(safeJsonParse(row.status_json));

  return {
    id: ThreadId.make(row.id),
    projectId: ProjectId.make(row.project_id),
    projectName: row.project_name,
    title: row.title,
    runtime: runtimeOpt._tag === "Some" ? runtimeOpt.value : "local",
    branch: row.branch,
    ...(row.worktree_path ? { worktreePath: row.worktree_path } : {}),
    cwd: row.cwd,
    modelSelection: {
      providerId: ProviderId.make(row.provider_id),
      providerKind: kindOpt._tag === "Some" ? kindOpt.value : "claude",
      model: row.model,
      ...(effortOpt && effortOpt._tag === "Some" ? { effort: effortOpt.value } : {}),
    },
    runtimeMode: rmOpt._tag === "Some" ? rmOpt.value : "auto",
    interactionMode: imOpt._tag === "Some" ? imOpt.value : "default",
    status: statusOpt._tag === "Some" ? statusOpt.value : { kind: "idle" },
    ...(typeof row.cost_usd === "number" && row.cost_usd > 0 ? { costUsd: row.cost_usd } : {}),
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const rowToActivity = (row: ActivityRow): ActivityItem => {
  const kindOpt = decodeActivityKind(row.kind);
  const statusOpt = decodeActivityStatus(row.status);
  return {
    id: ActivityId.make(row.id),
    turnId: TurnId.make(row.turn_id),
    threadId: ThreadId.make(row.thread_id),
    kind: kindOpt._tag === "Some" ? kindOpt.value : "tool",
    label: row.label,
    activeLabel: row.active_label,
    ...(row.detail ? { detail: row.detail } : {}),
    status: statusOpt._tag === "Some" ? statusOpt.value : "completed",
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
  };
};

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

const THREAD_SELECT = `
  SELECT t.*, COALESCE((SELECT SUM(cost_usd) FROM turns WHERE thread_id = t.id), 0) AS cost_usd
  FROM threads t
`;

export const readThreadById = (db: Database, threadId: string): Thread | null => {
  const row = db.query<ThreadRow, [string]>(`${THREAD_SELECT} WHERE t.id = ?`).get(threadId);
  return row ? rowToThread(row) : null;
};

export const listAllThreads = (db: Database): ReadonlyArray<Thread> => {
  const rows = db.query<ThreadRow, []>(`${THREAD_SELECT} ORDER BY t.updated_at DESC`).all();
  return rows.map(rowToThread);
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

  return turnRows.map((row): ThreadTurn => {
    const originOpt = decodeTurnOrigin(row.origin);
    const statusOpt = decodeTurnStatus(row.status);
    const msOpt = decodeModelSelection(safeJsonParse(row.model_selection_json));
    return {
      id: TurnId.make(row.id),
      threadId: ThreadId.make(row.thread_id),
      ...(originOpt._tag === "Some" && originOpt.value === "system" ? { origin: "system" } : {}),
      userMessage: row.user_message,
      assistantMessage: row.assistant_message,
      thinkingText: row.thinking_text,
      status: statusOpt._tag === "Some" ? statusOpt.value : "completed",
      startedAt: row.started_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
      ...(row.cost_usd > 0 ? { costUsd: row.cost_usd } : {}),
      ...(row.error ? { error: row.error } : {}),
      modelSelection: msOpt._tag === "Some" ? msOpt.value : thread.modelSelection,
      activities: activitiesByTurn.get(row.id) ?? [],
      approvals: approvalsByTurn.get(row.id) ?? [],
    };
  });
};

export const recoverInterruptedThreads = (db: Database): void => {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE turns
     SET status = 'interrupted', completed_at = COALESCE(completed_at, ?), error = COALESCE(error, 'Server restarted while running')
     WHERE status = 'running'`,
  ).run(now);
  db.prepare(
    `UPDATE activities
     SET status = 'failed', completed_at = COALESCE(completed_at, ?)
     WHERE status = 'running'`,
  ).run(now);
  db.prepare(
    `UPDATE approvals
     SET status = 'resolved'
     WHERE status = 'pending'`,
  ).run();
  db.prepare(
    `UPDATE threads
     SET status_json = ?
     WHERE status_json LIKE '%"running"%' OR status_json LIKE '%"needs-input"%'`,
  ).run(JSON.stringify({ kind: "idle" }));
};

export const TITLE_LIMIT = 72;

export const deriveThreadInputTitle = (prompt: string, explicit?: string): string => {
  const candidate = explicit?.trim() || prompt.trim().split(/\r?\n/)[0]?.trim() || "New thread";
  return candidate.slice(0, TITLE_LIMIT);
};

export const formatPromptWithAttachments = (
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

export const insertThreadRow = (
  db: Database,
  input: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly projectName: string;
    readonly title: string;
    readonly runtime: Thread["runtime"];
    readonly branch: string;
    readonly worktreePath?: string;
    readonly cwd: string;
    readonly modelSelection: Thread["modelSelection"];
    readonly runtimeMode: Thread["runtimeMode"];
    readonly interactionMode: Thread["interactionMode"];
    readonly status: Thread["status"];
    readonly now: string;
  },
): Thread | null => {
  db.prepare(
    `INSERT INTO threads
       (id, project_id, project_name, title, runtime, branch, worktree_path, cwd, provider_id, provider_kind, model, effort, runtime_mode, interaction_mode, status_json, settled_at, provider_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(
    input.id,
    input.projectId,
    input.projectName,
    input.title,
    input.runtime,
    input.branch,
    input.worktreePath ?? null,
    input.cwd,
    input.modelSelection.providerId,
    input.modelSelection.providerKind,
    input.modelSelection.model,
    input.modelSelection.effort ?? null,
    input.runtimeMode,
    input.interactionMode,
    JSON.stringify(input.status),
    input.now,
    input.now,
  );
  return readThreadById(db, input.id);
};

export const updateThreadRow = (
  db: Database,
  input: {
    readonly id: ThreadId;
    readonly title: string;
    readonly runtime: Thread["runtime"];
    readonly branch: string;
    readonly worktreePath: string | null;
    readonly cwd: string;
    readonly modelSelection: Thread["modelSelection"];
    readonly runtimeMode: Thread["runtimeMode"];
    readonly interactionMode: Thread["interactionMode"];
    readonly providerSessionId: string | null;
    readonly now: string;
  },
): Thread | null => {
  db.prepare(
    `UPDATE threads
     SET title = ?, runtime = ?, branch = ?, worktree_path = ?, cwd = ?,
         provider_id = ?, provider_kind = ?, model = ?, effort = ?,
         runtime_mode = ?, interaction_mode = ?, provider_session_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title,
    input.runtime,
    input.branch,
    input.worktreePath,
    input.cwd,
    input.modelSelection.providerId,
    input.modelSelection.providerKind,
    input.modelSelection.model,
    input.modelSelection.effort ?? null,
    input.runtimeMode,
    input.interactionMode,
    input.providerSessionId,
    input.now,
    input.id,
  );
  return readThreadById(db, input.id);
};

import type { Database } from "bun:sqlite";
import {
  type EffortLevel,
  type InteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type Thread,
  type ThreadAttachment,
  type ThreadRuntime,
  ThreadStatus,
} from "@scuttle/contracts";
import { ProjectId, ProviderId, ThreadId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { decodeTurnUsage, lookupEnum, safeJsonParse } from "./turnQueries.ts";

export {
  type ActivityRow,
  type ApprovalRow,
  hasCompletedTurnInEpoch,
  insertTurnRow,
  readTurnsForThread,
  rowToActivity,
  rowToApproval,
  rowToTurn,
  type TurnRow,
  updateTurnOutcomeRow,
} from "./turnQueries.ts";

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
  readonly session_epoch?: number | null;
  readonly active_summary?: string | null;
  readonly last_context_hash?: string | null;
  readonly last_usage_json?: string | null;
  readonly compact_at_tokens?: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const RUNTIMES: Readonly<Record<string, ThreadRuntime>> = {
  local: "local",
  worktree: "worktree",
};

const PROVIDER_KINDS: Readonly<Record<string, ProviderKind>> = {
  claude: "claude",
  codex: "codex",
  antigravity: "antigravity",
  opencode: "opencode",
  copilot: "copilot",
};

const EFFORT_LEVELS: Readonly<Record<string, EffortLevel>> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

const RUNTIME_MODES: Readonly<Record<string, RuntimeMode>> = {
  auto: "auto",
  "approval-required": "approval-required",
  "full-access": "full-access",
};

const INTERACTION_MODES: Readonly<Record<string, InteractionMode>> = {
  default: "default",
  plan: "plan",
};

const decodeThreadStatus = Schema.decodeUnknownOption(ThreadStatus);

export const rowToThread = (row: ThreadRow): Thread => {
  const runtime = lookupEnum(RUNTIMES, row.runtime) ?? "local";
  const providerKind = lookupEnum(PROVIDER_KINDS, row.provider_kind) ?? "claude";
  const effort = lookupEnum(EFFORT_LEVELS, row.effort);
  const runtimeMode = lookupEnum(RUNTIME_MODES, row.runtime_mode) ?? "auto";
  const interactionMode = lookupEnum(INTERACTION_MODES, row.interaction_mode) ?? "default";
  const statusOpt = decodeThreadStatus(safeJsonParse(row.status_json));
  const lastUsageOpt = row.last_usage_json
    ? decodeTurnUsage(safeJsonParse(row.last_usage_json))
    : null;

  return {
    id: ThreadId.make(row.id),
    projectId: ProjectId.make(row.project_id),
    projectName: row.project_name,
    title: row.title,
    runtime,
    branch: row.branch,
    ...(row.worktree_path ? { worktreePath: row.worktree_path } : {}),
    cwd: row.cwd,
    modelSelection: {
      providerId: ProviderId.make(row.provider_id),
      providerKind,
      model: row.model,
      ...(effort !== undefined ? { effort } : {}),
    },
    runtimeMode,
    interactionMode,
    status: statusOpt._tag === "Some" ? statusOpt.value : { kind: "idle" },
    ...(typeof row.cost_usd === "number" && row.cost_usd > 0 ? { costUsd: row.cost_usd } : {}),
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
    ...(typeof row.session_epoch === "number" ? { sessionEpoch: row.session_epoch } : {}),
    ...(row.active_summary ? { activeSummary: row.active_summary } : {}),
    ...(lastUsageOpt && lastUsageOpt._tag === "Some" ? { lastUsage: lastUsageOpt.value } : {}),
    ...(typeof row.compact_at_tokens === "number" && row.compact_at_tokens > 0
      ? { compactAtTokens: row.compact_at_tokens }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const THREAD_BY_ID_SELECT = `
  SELECT t.*, COALESCE((SELECT SUM(cost_usd) FROM turns WHERE thread_id = t.id), 0) AS cost_usd
  FROM threads t
  WHERE t.id = ?
`;

const THREAD_LIST_SELECT = `
  SELECT t.*, COALESCE(tc.cost_usd, 0) AS cost_usd
  FROM threads t
  LEFT JOIN (SELECT thread_id, SUM(cost_usd) AS cost_usd FROM turns GROUP BY thread_id) tc
    ON tc.thread_id = t.id
  ORDER BY t.updated_at DESC
`;

export const readThreadById = (db: Database, threadId: string): Thread | null => {
  const row = db.query<ThreadRow, [string]>(THREAD_BY_ID_SELECT).get(threadId);
  return row ? rowToThread(row) : null;
};

export const listAllThreads = (db: Database): ReadonlyArray<Thread> => {
  const rows = db.query<ThreadRow, []>(THREAD_LIST_SELECT).all();
  return rows.map(rowToThread);
};

export const readThreadContextHash = (db: Database, threadId: string): string | null => {
  const row = db
    .query<{ readonly last_context_hash: string | null }, [string]>(
      "SELECT last_context_hash FROM threads WHERE id = ?",
    )
    .get(threadId);
  return row?.last_context_hash ?? null;
};

export const updateThreadContextHash = (
  db: Database,
  threadId: string,
  hash: string | null,
  expectedSessionEpoch?: number,
): void => {
  if (expectedSessionEpoch !== undefined) {
    db.query("UPDATE threads SET last_context_hash = ? WHERE id = ? AND session_epoch = ?").run(
      hash,
      threadId,
      expectedSessionEpoch,
    );
    return;
  }
  db.query("UPDATE threads SET last_context_hash = ? WHERE id = ?").run(hash, threadId);
};

export const recoverInterruptedThreads = (db: Database): void => {
  const now = new Date().toISOString();
  db.query(
    `UPDATE turns
     SET status = 'interrupted', completed_at = COALESCE(completed_at, ?), error = COALESCE(error, 'Server restarted while running')
     WHERE status = 'running'`,
  ).run(now);
  db.query(
    `UPDATE activities
     SET status = 'failed', completed_at = COALESCE(completed_at, ?)
     WHERE status = 'running'`,
  ).run(now);
  db.query(
    `UPDATE approvals
     SET status = 'resolved'
     WHERE status = 'pending'`,
  ).run();
  db.query(
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
  db.query(
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
  db.query(
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

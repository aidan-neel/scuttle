import type { Database } from "bun:sqlite";
import {
  type AgentDelegation,
  AgentDelegationKind,
  type AgentDelegationQuestion,
  AgentDelegationQuestionKind,
  AgentDelegationQuestionStatus,
  AgentDelegationStatus,
  AgentModelRole,
  type DelegationLink,
  ModelSelection,
} from "@scuttle/contracts";
import {
  AgentDelegationId,
  AgentDelegationQuestionId,
  AgentId,
  AgentIssueId,
  ProviderId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

export {
  deleteIssueRow,
  insertIssue,
  insertIssueActivity,
  issueKeyPrefix,
  listAllIssues,
  listIssueActivities,
  listIssues,
  listIssuesAssignedToAgent,
  listRecentUserIssueActivities,
  nextIssueKey,
  readIssueById,
  readIssueByKey,
  updateIssueRow,
} from "./agentIssueStore.ts";

interface DelegationRow {
  readonly id: string;
  readonly agent_id: string | null;
  readonly parent_thread_id: string;
  readonly child_thread_id: string;
  readonly role: string;
  readonly kind: string;
  readonly title: string;
  readonly brief: string;
  readonly model_selection_json: string;
  readonly status: string;
  readonly bounce_count: number;
  readonly max_bounces: number;
  readonly issue_id: string | null;
  readonly pr_url: string | null;
  readonly result_summary: string | null;
  readonly parent_notified_at: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

interface QuestionRow {
  readonly id: string;
  readonly delegation_id: string;
  readonly agent_id: string | null;
  readonly child_thread_id: string;
  readonly parent_thread_id: string;
  readonly parent_turn_id: string | null;
  readonly kind: string;
  readonly question: string;
  readonly attempted: string | null;
  readonly context: string | null;
  readonly status: string;
  readonly answer: string | null;
  readonly error: string | null;
  readonly bounce_number: number;
  readonly created_at: string;
  readonly answered_at: string | null;
}

const decodeRole = Schema.decodeUnknownOption(AgentModelRole);
const decodeKind = Schema.decodeUnknownOption(AgentDelegationKind);
const decodeStatus = Schema.decodeUnknownOption(AgentDelegationStatus);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeQuestionKind = Schema.decodeUnknownOption(AgentDelegationQuestionKind);
const decodeQuestionStatus = Schema.decodeUnknownOption(AgentDelegationQuestionStatus);

const FALLBACK_MODEL: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const migratedDatabases = new WeakSet<Database>();
const columnIsNotNull = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ readonly name: string; readonly notnull: number }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((col) => col.name === column && col.notnull === 1);

const DELEGATION_COLS =
  "id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, bounce_count, max_bounces, issue_id, pr_url, result_summary, parent_notified_at, created_at, completed_at";
const QUESTION_COLS =
  "id, delegation_id, agent_id, child_thread_id, parent_thread_id, parent_turn_id, kind, question, attempted, context, status, answer, error, bounce_number, created_at, answered_at";

export const ensureDelegationSchema = (db: Database): void => {
  if (migratedDatabases.has(db)) return;
  const migrateDelegations = columnIsNotNull(db, "agent_delegations", "agent_id");
  const migrateQuestions = columnIsNotNull(db, "agent_delegation_questions", "agent_id");
  if (migrateDelegations || migrateQuestions) {
    const fkEnabled =
      db.query<{ readonly foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys ===
      1;
    if (fkEnabled) db.run("PRAGMA foreign_keys = OFF;");
    try {
      db.transaction(() => {
        if (migrateDelegations) {
          db.run(`
            CREATE TABLE agent_delegations_next (id TEXT PRIMARY KEY NOT NULL, agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE, parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, child_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, role TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, brief TEXT NOT NULL, model_selection_json TEXT NOT NULL, status TEXT NOT NULL, bounce_count INTEGER NOT NULL DEFAULT 0, max_bounces INTEGER NOT NULL DEFAULT 3, issue_id TEXT REFERENCES agent_issues(id) ON DELETE SET NULL, pr_url TEXT, result_summary TEXT, parent_notified_at TEXT, created_at TEXT NOT NULL, completed_at TEXT);
            INSERT INTO agent_delegations_next (${DELEGATION_COLS}) SELECT id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, COALESCE(bounce_count, 0), COALESCE(max_bounces, 3), issue_id, pr_url, result_summary, parent_notified_at, created_at, completed_at FROM agent_delegations;
            DROP TABLE agent_delegations;
            ALTER TABLE agent_delegations_next RENAME TO agent_delegations;
            CREATE INDEX IF NOT EXISTS idx_agent_delegations_agent_id ON agent_delegations(agent_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_delegations_child_thread_id ON agent_delegations(child_thread_id);
          `);
        }
        if (migrateQuestions) {
          db.run(`
            CREATE TABLE agent_delegation_questions_next (id TEXT PRIMARY KEY NOT NULL, delegation_id TEXT NOT NULL REFERENCES agent_delegations(id) ON DELETE CASCADE, agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE, child_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, parent_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL, kind TEXT NOT NULL DEFAULT 'other', question TEXT NOT NULL, attempted TEXT, context TEXT, status TEXT NOT NULL, answer TEXT, error TEXT, bounce_number INTEGER NOT NULL, created_at TEXT NOT NULL, answered_at TEXT);
            INSERT INTO agent_delegation_questions_next (${QUESTION_COLS}) SELECT ${QUESTION_COLS} FROM agent_delegation_questions;
            DROP TABLE agent_delegation_questions;
            ALTER TABLE agent_delegation_questions_next RENAME TO agent_delegation_questions;
            CREATE INDEX IF NOT EXISTS idx_agent_delegation_questions_delegation_id ON agent_delegation_questions(delegation_id, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_agent_delegation_questions_agent_status ON agent_delegation_questions(agent_id, status, created_at ASC);
          `);
        }
      })();
    } finally {
      if (fkEnabled) db.run("PRAGMA foreign_keys = ON;");
    }
  }
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_delegations_parent_thread_id ON agent_delegations(parent_thread_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_delegation_questions_parent_thread ON agent_delegation_questions(parent_thread_id, status, created_at ASC);
  `);
  migratedDatabases.add(db);
};

const rowToDelegation = (row: DelegationRow): AgentDelegation => {
  const roleOpt = decodeRole(row.role);
  const kindOpt = decodeKind(row.kind);
  const statusOpt = decodeStatus(row.status);
  const modelOpt = decodeModelSelection(safeJsonParse(row.model_selection_json));
  return {
    id: AgentDelegationId.make(row.id),
    ...(row.agent_id !== null ? { agentId: AgentId.make(row.agent_id) } : {}),
    parentThreadId: ThreadId.make(row.parent_thread_id),
    childThreadId: ThreadId.make(row.child_thread_id),
    role: roleOpt._tag === "Some" ? roleOpt.value : "workhorse",
    kind: kindOpt._tag === "Some" ? kindOpt.value : "task",
    title: row.title,
    brief: row.brief,
    modelSelection: modelOpt._tag === "Some" ? modelOpt.value : FALLBACK_MODEL,
    status: statusOpt._tag === "Some" ? statusOpt.value : "running",
    bounceCount: row.bounce_count ?? 0,
    maxBounces: row.max_bounces ?? 3,
    ...(row.issue_id !== null ? { issueId: AgentIssueId.make(row.issue_id) } : {}),
    ...(row.pr_url !== null ? { prUrl: row.pr_url } : {}),
    ...(row.result_summary !== null ? { resultSummary: row.result_summary } : {}),
    ...(row.parent_notified_at !== null ? { parentNotifiedAt: row.parent_notified_at } : {}),
    createdAt: row.created_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
  };
};

const rowToQuestion = (row: QuestionRow): AgentDelegationQuestion => {
  const kindOpt = decodeQuestionKind(row.kind);
  const statusOpt = decodeQuestionStatus(row.status);
  return {
    id: AgentDelegationQuestionId.make(row.id),
    delegationId: AgentDelegationId.make(row.delegation_id),
    ...(row.agent_id !== null ? { agentId: AgentId.make(row.agent_id) } : {}),
    childThreadId: ThreadId.make(row.child_thread_id),
    parentThreadId: ThreadId.make(row.parent_thread_id),
    ...(row.parent_turn_id !== null ? { parentTurnId: TurnId.make(row.parent_turn_id) } : {}),
    kind: kindOpt._tag === "Some" ? kindOpt.value : "other",
    question: row.question,
    ...(row.attempted !== null ? { attempted: row.attempted } : {}),
    ...(row.context !== null ? { context: row.context } : {}),
    status: statusOpt._tag === "Some" ? statusOpt.value : "pending",
    ...(row.answer !== null ? { answer: row.answer } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    bounceNumber: row.bounce_number,
    createdAt: row.created_at,
    ...(row.answered_at !== null ? { answeredAt: row.answered_at } : {}),
  };
};

const queryDelegations = (db: Database, sql: string, ...params: (string | number)[]) =>
  db
    .query<DelegationRow, (string | number)[]>(sql)
    .all(...params)
    .map(rowToDelegation);

const queryOneDelegation = (db: Database, sql: string, ...params: string[]) => {
  const row = db.query<DelegationRow, string[]>(sql).get(...params);
  return row ? rowToDelegation(row) : null;
};

export const listDelegations = (
  db: Database,
  agentId: string,
  limit = 50,
): ReadonlyArray<AgentDelegation> =>
  queryDelegations(
    db,
    "SELECT * FROM agent_delegations WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
    agentId,
    limit,
  );

export const listDelegationsByParentThread = (
  db: Database,
  parentThreadId: string,
  limit = 50,
): ReadonlyArray<AgentDelegation> => {
  ensureDelegationSchema(db);
  return queryDelegations(
    db,
    "SELECT * FROM agent_delegations WHERE parent_thread_id = ? ORDER BY created_at DESC LIMIT ?",
    parentThreadId,
    limit,
  );
};

export const readDelegationById = (
  db: Database,
  agentId: string,
  delegationId: string,
): AgentDelegation | null =>
  queryOneDelegation(
    db,
    "SELECT * FROM agent_delegations WHERE id = ? AND agent_id = ?",
    delegationId,
    agentId,
  );

export const readDelegationByDelegationId = (
  db: Database,
  delegationId: string,
): AgentDelegation | null =>
  queryOneDelegation(db, "SELECT * FROM agent_delegations WHERE id = ?", delegationId);

export const readActiveDelegationByChildThread = (
  db: Database,
  childThreadId: string,
): AgentDelegation | null =>
  queryOneDelegation(
    db,
    "SELECT * FROM agent_delegations WHERE child_thread_id = ? AND status IN ('running', 'waiting_parent') ORDER BY created_at DESC LIMIT 1",
    childThreadId,
  );

export const readDelegationByChildThreadId = (
  db: Database,
  childThreadId: string,
): AgentDelegation | null =>
  queryOneDelegation(
    db,
    "SELECT * FROM agent_delegations WHERE child_thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    childThreadId,
  );

export const listActiveDelegationLinks = (
  db: Database,
  limit = 200,
): ReadonlyArray<DelegationLink> => {
  ensureDelegationSchema(db);
  return queryDelegations(
    db,
    "SELECT * FROM agent_delegations ORDER BY CASE WHEN status IN ('running', 'waiting_parent') THEN 0 ELSE 1 END, created_at DESC LIMIT ?",
    limit,
  ).map((del) => ({
    delegationId: del.id,
    parentThreadId: del.parentThreadId,
    childThreadId: del.childThreadId,
    status: del.status,
    title: del.title,
    role: del.role,
    providerId: del.modelSelection.providerId,
    model: del.modelSelection.model,
  }));
};

export const readAgentIdForThread = (db: Database, threadId: string): string | null => {
  const primary = db
    .query<{ readonly id: string }, [string]>(
      "SELECT id FROM agents WHERE primary_thread_id = ? LIMIT 1",
    )
    .get(threadId);
  if (primary) return primary.id;
  return (
    db
      .query<{ readonly agent_id: string | null }, [string]>(
        "SELECT agent_id FROM agent_delegations WHERE child_thread_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(threadId)?.agent_id ?? null
  );
};

export const insertDelegation = (db: Database, d: AgentDelegation): void => {
  ensureDelegationSchema(db);
  db.prepare(
    `INSERT INTO agent_delegations (${DELEGATION_COLS.replace(", parent_notified_at", "")}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.id,
    d.agentId ?? null,
    d.parentThreadId,
    d.childThreadId,
    d.role,
    d.kind,
    d.title,
    d.brief,
    JSON.stringify(d.modelSelection),
    d.status,
    d.bounceCount,
    d.maxBounces,
    d.issueId ?? null,
    d.prUrl ?? null,
    d.resultSummary ?? null,
    d.createdAt,
    d.completedAt ?? null,
  );
};

export const updateDelegationRow = (db: Database, d: AgentDelegation): void => {
  db.prepare(
    "UPDATE agent_delegations SET status = ?, bounce_count = ?, max_bounces = ?, pr_url = ?, result_summary = ?, completed_at = ? WHERE id = ?",
  ).run(
    d.status,
    d.bounceCount,
    d.maxBounces,
    d.prUrl ?? null,
    d.resultSummary ?? null,
    d.completedAt ?? null,
    d.id,
  );
};

export const listUnnotifiedSettledDelegations = (
  db: Database,
  agentId: string,
): ReadonlyArray<AgentDelegation> =>
  queryDelegations(
    db,
    "SELECT * FROM agent_delegations WHERE agent_id = ? AND status NOT IN ('running', 'waiting_parent') AND parent_notified_at IS NULL ORDER BY completed_at ASC, created_at ASC LIMIT 10",
    agentId,
  );

export const listUnnotifiedSettledDelegationsByParentThread = (
  db: Database,
  parentThreadId: string,
): ReadonlyArray<AgentDelegation> => {
  ensureDelegationSchema(db);
  return queryDelegations(
    db,
    "SELECT * FROM agent_delegations WHERE parent_thread_id = ? AND status NOT IN ('running', 'waiting_parent') AND parent_notified_at IS NULL ORDER BY completed_at ASC, created_at ASC LIMIT 10",
    parentThreadId,
  );
};

export const markDelegationsParentNotified = (
  db: Database,
  delegationIds: ReadonlyArray<string>,
  notifiedAt: string,
): void => {
  if (delegationIds.length === 0) return;
  db.transaction(() => {
    const stmt = db.prepare(
      "UPDATE agent_delegations SET parent_notified_at = ? WHERE id = ? AND parent_notified_at IS NULL",
    );
    for (const id of delegationIds) stmt.run(notifiedAt, id);
  })();
};

export const insertThreadQuestion = (db: Database, q: AgentDelegationQuestion): void => {
  ensureDelegationSchema(db);
  db.prepare(
    `INSERT INTO agent_delegation_questions (${QUESTION_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    q.id,
    q.delegationId,
    q.agentId ?? null,
    q.childThreadId,
    q.parentThreadId,
    q.parentTurnId ?? null,
    q.kind,
    q.question,
    q.attempted ?? null,
    q.context ?? null,
    q.status,
    q.answer ?? null,
    q.error ?? null,
    q.bounceNumber,
    q.createdAt,
    q.answeredAt ?? null,
  );
};

export const updateThreadQuestionRow = (db: Database, q: AgentDelegationQuestion): void => {
  db.prepare(
    "UPDATE agent_delegation_questions SET parent_turn_id = ?, status = ?, answer = ?, error = ?, answered_at = ? WHERE id = ?",
  ).run(
    q.parentTurnId ?? null,
    q.status,
    q.answer ?? null,
    q.error ?? null,
    q.answeredAt ?? null,
    q.id,
  );
};

const queryQuestions = (db: Database, sql: string, ...params: string[]) =>
  db
    .query<QuestionRow, string[]>(sql)
    .all(...params)
    .map(rowToQuestion);

const queryOneQuestion = (db: Database, sql: string, ...params: string[]) => {
  const row = db.query<QuestionRow, string[]>(sql).get(...params);
  return row ? rowToQuestion(row) : null;
};

export const readThreadQuestionById = (
  db: Database,
  questionId: string,
): AgentDelegationQuestion | null =>
  queryOneQuestion(db, "SELECT * FROM agent_delegation_questions WHERE id = ?", questionId);

export const readPendingThreadQuestionForDelegation = (
  db: Database,
  delegationId: string,
): AgentDelegationQuestion | null =>
  queryOneQuestion(
    db,
    "SELECT * FROM agent_delegation_questions WHERE delegation_id = ? AND status = 'pending' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    delegationId,
  );

export const listQuestionsByDelegationId = (
  db: Database,
  delegationId: string,
): ReadonlyArray<AgentDelegationQuestion> =>
  queryQuestions(
    db,
    "SELECT * FROM agent_delegation_questions WHERE delegation_id = ? ORDER BY created_at ASC, rowid ASC",
    delegationId,
  );

export const listPendingQuestionIdsByAgent = (
  db: Database,
  agentId: string,
): ReadonlyArray<AgentDelegationQuestionId> =>
  db
    .query<{ readonly id: string }, [string]>(
      "SELECT id FROM agent_delegation_questions WHERE agent_id = ? AND status = 'pending'",
    )
    .all(agentId)
    .map((row) => AgentDelegationQuestionId.make(row.id));

export const recoverStaleDelegations = (db: Database): void => {
  ensureDelegationSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_delegations SET status = 'canceled', result_summary = COALESCE(result_summary, 'Interrupted before completion'), completed_at = COALESCE(completed_at, ?)
     WHERE status IN ('running', 'waiting_parent') AND NOT EXISTS (SELECT 1 FROM turns t WHERE t.thread_id = agent_delegations.child_thread_id AND t.status = 'running')`,
  ).run(now);
  db.prepare(
    `UPDATE agent_delegation_questions SET status = 'canceled', error = COALESCE(error, 'Interrupted before parent answered'), answered_at = COALESCE(answered_at, ?)
     WHERE status = 'pending' AND (NOT EXISTS (SELECT 1 FROM agent_delegations d WHERE d.id = agent_delegation_questions.delegation_id AND d.status = 'waiting_parent') OR NOT EXISTS (SELECT 1 FROM turns t WHERE t.thread_id = agent_delegation_questions.child_thread_id AND t.status = 'running'))`,
  ).run(now);
};

import type { Database } from "bun:sqlite";
import {
  type AgentDelegation,
  AgentDelegationKind,
  AgentDelegationStatus,
  type AgentIssue,
  AgentIssueState,
  AgentModelRole,
  ModelSelection,
} from "@scuttle/contracts";
import {
  AgentDelegationId,
  AgentId,
  AgentIssueId,
  ProviderId,
  ThreadId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

interface IssueRow {
  readonly id: string;
  readonly agent_id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly state: string;
  readonly labels_json: string;
  readonly external_url: string | null;
  readonly assigned_thread_id: string | null;
  readonly pr_number: number | null;
  readonly pr_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface DelegationRow {
  readonly id: string;
  readonly agent_id: string;
  readonly parent_thread_id: string;
  readonly child_thread_id: string;
  readonly role: string;
  readonly kind: string;
  readonly title: string;
  readonly brief: string;
  readonly model_selection_json: string;
  readonly status: string;
  readonly issue_id: string | null;
  readonly pr_url: string | null;
  readonly result_summary: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

const decodeIssueState = Schema.decodeUnknownOption(AgentIssueState);
const decodeLabels = Schema.decodeUnknownOption(Schema.Array(Schema.String));
const decodeRole = Schema.decodeUnknownOption(AgentModelRole);
const decodeKind = Schema.decodeUnknownOption(AgentDelegationKind);
const decodeStatus = Schema.decodeUnknownOption(AgentDelegationStatus);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);

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

const rowToIssue = (row: IssueRow): AgentIssue => {
  const stateOpt = decodeIssueState(row.state);
  const labelsOpt = decodeLabels(safeJsonParse(row.labels_json));
  return {
    id: AgentIssueId.make(row.id),
    agentId: AgentId.make(row.agent_id),
    key: row.key,
    title: row.title,
    description: row.description,
    state: stateOpt._tag === "Some" ? stateOpt.value : "backlog",
    labels: labelsOpt._tag === "Some" ? [...labelsOpt.value] : [],
    ...(row.external_url !== null ? { externalUrl: row.external_url } : {}),
    ...(row.assigned_thread_id !== null
      ? { assignedThreadId: ThreadId.make(row.assigned_thread_id) }
      : {}),
    ...(row.pr_number !== null ? { prNumber: row.pr_number } : {}),
    ...(row.pr_url !== null ? { prUrl: row.pr_url } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const rowToDelegation = (row: DelegationRow): AgentDelegation => {
  const roleOpt = decodeRole(row.role);
  const kindOpt = decodeKind(row.kind);
  const statusOpt = decodeStatus(row.status);
  const modelOpt = decodeModelSelection(safeJsonParse(row.model_selection_json));
  return {
    id: AgentDelegationId.make(row.id),
    agentId: AgentId.make(row.agent_id),
    parentThreadId: ThreadId.make(row.parent_thread_id),
    childThreadId: ThreadId.make(row.child_thread_id),
    role: roleOpt._tag === "Some" ? roleOpt.value : "workhorse",
    kind: kindOpt._tag === "Some" ? kindOpt.value : "task",
    title: row.title,
    brief: row.brief,
    modelSelection: modelOpt._tag === "Some" ? modelOpt.value : FALLBACK_MODEL,
    status: statusOpt._tag === "Some" ? statusOpt.value : "running",
    ...(row.issue_id !== null ? { issueId: AgentIssueId.make(row.issue_id) } : {}),
    ...(row.pr_url !== null ? { prUrl: row.pr_url } : {}),
    ...(row.result_summary !== null ? { resultSummary: row.result_summary } : {}),
    createdAt: row.created_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
  };
};

export const issueKeyPrefix = (projectName: string): string => {
  const cleaned = projectName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return cleaned.length >= 2 ? cleaned : "TASK";
};

export const nextIssueKey = (db: Database, agentId: string, projectName: string): string => {
  const prefix = issueKeyPrefix(projectName);
  const rows = db
    .query<{ readonly key: string }, [string]>("SELECT key FROM agent_issues WHERE agent_id = ?")
    .all(agentId);
  let maxNum = 0;
  const matcher = new RegExp(`^${prefix}-(\\d+)$`);
  for (const row of rows) {
    const match = matcher.exec(row.key);
    if (match !== null) {
      const n = Number.parseInt(match[1]!, 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `${prefix}-${maxNum + 1}`;
};

export const listIssues = (db: Database, agentId: string): ReadonlyArray<AgentIssue> =>
  db
    .query<IssueRow, [string]>(
      "SELECT * FROM agent_issues WHERE agent_id = ? ORDER BY updated_at DESC",
    )
    .all(agentId)
    .map(rowToIssue);

export const readIssueById = (
  db: Database,
  agentId: string,
  issueId: string,
): AgentIssue | null => {
  const row = db
    .query<IssueRow, [string, string]>("SELECT * FROM agent_issues WHERE id = ? AND agent_id = ?")
    .get(issueId, agentId);
  return row ? rowToIssue(row) : null;
};

export const readIssueByKey = (db: Database, agentId: string, key: string): AgentIssue | null => {
  const row = db
    .query<IssueRow, [string, string]>("SELECT * FROM agent_issues WHERE key = ? AND agent_id = ?")
    .get(key, agentId);
  return row ? rowToIssue(row) : null;
};

export const insertIssue = (db: Database, issue: AgentIssue): void => {
  db.prepare(
    `INSERT INTO agent_issues
       (id, agent_id, key, title, description, state, labels_json, external_url, assigned_thread_id, pr_number, pr_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    issue.id,
    issue.agentId,
    issue.key,
    issue.title,
    issue.description,
    issue.state,
    JSON.stringify(issue.labels),
    issue.externalUrl ?? null,
    issue.assignedThreadId ?? null,
    issue.prNumber ?? null,
    issue.prUrl ?? null,
    issue.createdAt,
    issue.updatedAt,
  );
};

export const updateIssueRow = (db: Database, issue: AgentIssue): void => {
  db.prepare(
    `UPDATE agent_issues
     SET title = ?, description = ?, state = ?, labels_json = ?, external_url = ?,
         assigned_thread_id = ?, pr_number = ?, pr_url = ?, updated_at = ?
     WHERE id = ? AND agent_id = ?`,
  ).run(
    issue.title,
    issue.description,
    issue.state,
    JSON.stringify(issue.labels),
    issue.externalUrl ?? null,
    issue.assignedThreadId ?? null,
    issue.prNumber ?? null,
    issue.prUrl ?? null,
    issue.updatedAt,
    issue.id,
    issue.agentId,
  );
};

export const deleteIssueRow = (db: Database, agentId: string, issueId: string): void => {
  db.prepare("DELETE FROM agent_issues WHERE id = ? AND agent_id = ?").run(issueId, agentId);
};

export const listDelegations = (
  db: Database,
  agentId: string,
  limit = 50,
): ReadonlyArray<AgentDelegation> =>
  db
    .query<DelegationRow, [string, number]>(
      "SELECT * FROM agent_delegations WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(agentId, limit)
    .map(rowToDelegation);

export const readDelegationById = (
  db: Database,
  agentId: string,
  delegationId: string,
): AgentDelegation | null => {
  const row = db
    .query<DelegationRow, [string, string]>(
      "SELECT * FROM agent_delegations WHERE id = ? AND agent_id = ?",
    )
    .get(delegationId, agentId);
  return row ? rowToDelegation(row) : null;
};

export const readRunningDelegationByChildThread = (
  db: Database,
  childThreadId: string,
): AgentDelegation | null => {
  const row = db
    .query<DelegationRow, [string]>(
      "SELECT * FROM agent_delegations WHERE child_thread_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1",
    )
    .get(childThreadId);
  return row ? rowToDelegation(row) : null;
};

export const readAgentIdForThread = (db: Database, threadId: string): string | null => {
  const primary = db
    .query<{ readonly id: string }, [string]>(
      "SELECT id FROM agents WHERE primary_thread_id = ? LIMIT 1",
    )
    .get(threadId);
  if (primary) return primary.id;
  const child = db
    .query<{ readonly agent_id: string }, [string]>(
      "SELECT agent_id FROM agent_delegations WHERE child_thread_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(threadId);
  return child ? child.agent_id : null;
};

export const insertDelegation = (db: Database, delegation: AgentDelegation): void => {
  db.prepare(
    `INSERT INTO agent_delegations
       (id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief,
        model_selection_json, status, issue_id, pr_url, result_summary, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    delegation.id,
    delegation.agentId,
    delegation.parentThreadId,
    delegation.childThreadId,
    delegation.role,
    delegation.kind,
    delegation.title,
    delegation.brief,
    JSON.stringify(delegation.modelSelection),
    delegation.status,
    delegation.issueId ?? null,
    delegation.prUrl ?? null,
    delegation.resultSummary ?? null,
    delegation.createdAt,
    delegation.completedAt ?? null,
  );
};

export const updateDelegationRow = (db: Database, delegation: AgentDelegation): void => {
  db.prepare(
    `UPDATE agent_delegations
     SET status = ?, pr_url = ?, result_summary = ?, completed_at = ?
     WHERE id = ? AND agent_id = ?`,
  ).run(
    delegation.status,
    delegation.prUrl ?? null,
    delegation.resultSummary ?? null,
    delegation.completedAt ?? null,
    delegation.id,
    delegation.agentId,
  );
};

export const recoverStaleDelegations = (db: Database): void => {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE agent_delegations
     SET status = 'canceled',
         result_summary = COALESCE(result_summary, 'Interrupted before completion'),
         completed_at = COALESCE(completed_at, ?)
     WHERE status = 'running'
       AND NOT EXISTS (
         SELECT 1 FROM turns t
         WHERE t.thread_id = agent_delegations.child_thread_id AND t.status = 'running'
       )`,
  ).run(now);
};

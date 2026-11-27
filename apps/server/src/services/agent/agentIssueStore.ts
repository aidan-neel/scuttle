import type { Database } from "bun:sqlite";
import {
  type AgentIssue,
  type AgentIssueActivity,
  AgentIssueActivityKind,
  type AgentIssueAssignee,
  AgentIssuePriority,
  AgentIssueState,
  IssueActorKind,
} from "@scuttle/contracts";
import { AgentId, AgentIssueActivityId, AgentIssueId, ThreadId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

interface IssueRow {
  readonly id: string;
  readonly agent_id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly state: string;
  readonly priority: string;
  readonly assignee_kind: string;
  readonly assignee_agent_id: string | null;
  readonly created_by: string;
  readonly labels_json: string;
  readonly due_date: string | null;
  readonly related_issue_id: string | null;
  readonly external_url: string | null;
  readonly assigned_thread_id: string | null;
  readonly pr_number: number | null;
  readonly pr_url: string | null;
  readonly comment_count?: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface IssueActivityRow {
  readonly id: string;
  readonly issue_id: string;
  readonly agent_id: string;
  readonly actor_kind: string;
  readonly actor_agent_id: string | null;
  readonly kind: string;
  readonly body: string;
  readonly created_at: string;
}

const decodeIssueState = Schema.decodeUnknownOption(AgentIssueState);
const decodeIssuePriority = Schema.decodeUnknownOption(AgentIssuePriority);
const decodeActorKind = Schema.decodeUnknownOption(IssueActorKind);
const decodeActivityKind = Schema.decodeUnknownOption(AgentIssueActivityKind);
const decodeLabels = Schema.decodeUnknownOption(Schema.Array(Schema.String));

const safeJsonParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const decodeAssignee = (kind: string, agentId: string | null): AgentIssueAssignee => {
  if (kind === "user") return { kind: "user" };
  if (kind === "agent" && agentId !== null && agentId.length > 0) {
    return { kind: "agent", agentId: AgentId.make(agentId) };
  }
  return { kind: "unassigned" };
};

const ISSUE_SELECT = `
  SELECT i.*,
         (SELECT COUNT(*) FROM agent_issue_activities act
          WHERE act.issue_id = i.id AND act.kind = 'comment') AS comment_count
  FROM agent_issues i
`;

const rowToIssue = (row: IssueRow): AgentIssue => {
  const stateOpt = decodeIssueState(row.state);
  const priorityOpt = decodeIssuePriority(row.priority);
  const createdByOpt = decodeActorKind(row.created_by);
  const labelsOpt = decodeLabels(safeJsonParse(row.labels_json));
  return {
    id: AgentIssueId.make(row.id),
    agentId: AgentId.make(row.agent_id),
    key: row.key,
    title: row.title,
    description: row.description,
    state: stateOpt._tag === "Some" ? stateOpt.value : "backlog",
    priority: priorityOpt._tag === "Some" ? priorityOpt.value : "normal",
    assignee: decodeAssignee(row.assignee_kind, row.assignee_agent_id),
    createdBy: createdByOpt._tag === "Some" ? createdByOpt.value : "user",
    labels: labelsOpt._tag === "Some" ? [...labelsOpt.value] : [],
    ...(row.due_date !== null ? { dueDate: row.due_date } : {}),
    ...(row.related_issue_id !== null
      ? { relatedIssueId: AgentIssueId.make(row.related_issue_id) }
      : {}),
    ...(typeof row.comment_count === "number" && row.comment_count > 0
      ? { commentCount: row.comment_count }
      : {}),
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

const rowToActivity = (row: IssueActivityRow): AgentIssueActivity => {
  const actorOpt = decodeActorKind(row.actor_kind);
  const kindOpt = decodeActivityKind(row.kind);
  return {
    id: AgentIssueActivityId.make(row.id),
    issueId: AgentIssueId.make(row.issue_id),
    agentId: AgentId.make(row.agent_id),
    actorKind: actorOpt._tag === "Some" ? actorOpt.value : "user",
    ...(row.actor_agent_id !== null ? { actorAgentId: AgentId.make(row.actor_agent_id) } : {}),
    kind: kindOpt._tag === "Some" ? kindOpt.value : "updated",
    body: row.body,
    createdAt: row.created_at,
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

export const listAllIssues = (db: Database): ReadonlyArray<AgentIssue> =>
  db.query<IssueRow, []>(`${ISSUE_SELECT} ORDER BY i.updated_at DESC`).all().map(rowToIssue);

export const listIssues = (db: Database, agentId: string): ReadonlyArray<AgentIssue> =>
  db
    .query<IssueRow, [string]>(`${ISSUE_SELECT} WHERE i.agent_id = ? ORDER BY i.updated_at DESC`)
    .all(agentId)
    .map(rowToIssue);

export const listIssuesAssignedToAgent = (
  db: Database,
  agentId: string,
): ReadonlyArray<AgentIssue> =>
  db
    .query<IssueRow, [string, string]>(
      `${ISSUE_SELECT}
       WHERE i.agent_id = ? OR (i.assignee_kind = 'agent' AND i.assignee_agent_id = ?)
       ORDER BY i.updated_at DESC`,
    )
    .all(agentId, agentId)
    .map(rowToIssue);

export const readIssueById = (
  db: Database,
  agentId: string,
  issueId: string,
): AgentIssue | null => {
  const row = db
    .query<IssueRow, [string, string]>(`${ISSUE_SELECT} WHERE i.id = ? AND i.agent_id = ?`)
    .get(issueId, agentId);
  return row ? rowToIssue(row) : null;
};

export const readIssueByKey = (db: Database, agentId: string, key: string): AgentIssue | null => {
  const row = db
    .query<IssueRow, [string, string]>(`${ISSUE_SELECT} WHERE i.key = ? AND i.agent_id = ?`)
    .get(key, agentId);
  return row ? rowToIssue(row) : null;
};

export const insertIssue = (db: Database, issue: AgentIssue): void => {
  db.prepare(
    `INSERT INTO agent_issues
       (id, agent_id, key, title, description, state, priority, assignee_kind, assignee_agent_id,
        created_by, labels_json, due_date, related_issue_id, external_url, assigned_thread_id,
        pr_number, pr_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    issue.id,
    issue.agentId,
    issue.key,
    issue.title,
    issue.description,
    issue.state,
    issue.priority,
    issue.assignee.kind,
    issue.assignee.kind === "agent" ? issue.assignee.agentId : null,
    issue.createdBy,
    JSON.stringify(issue.labels),
    issue.dueDate ?? null,
    issue.relatedIssueId ?? null,
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
     SET title = ?, description = ?, state = ?, priority = ?, assignee_kind = ?,
         assignee_agent_id = ?, labels_json = ?, due_date = ?, related_issue_id = ?,
         external_url = ?, assigned_thread_id = ?, pr_number = ?, pr_url = ?, updated_at = ?
     WHERE id = ? AND agent_id = ?`,
  ).run(
    issue.title,
    issue.description,
    issue.state,
    issue.priority,
    issue.assignee.kind,
    issue.assignee.kind === "agent" ? issue.assignee.agentId : null,
    JSON.stringify(issue.labels),
    issue.dueDate ?? null,
    issue.relatedIssueId ?? null,
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

export const insertIssueActivity = (db: Database, activity: AgentIssueActivity): void => {
  db.prepare(
    `INSERT INTO agent_issue_activities
       (id, issue_id, agent_id, actor_kind, actor_agent_id, kind, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.id,
    activity.issueId,
    activity.agentId,
    activity.actorKind,
    activity.actorAgentId ?? null,
    activity.kind,
    activity.body,
    activity.createdAt,
  );
};

export const listIssueActivities = (
  db: Database,
  issueId: string,
  limit = 100,
): ReadonlyArray<AgentIssueActivity> =>
  db
    .query<IssueActivityRow, [string, number]>(
      "SELECT * FROM agent_issue_activities WHERE issue_id = ? ORDER BY created_at ASC LIMIT ?",
    )
    .all(issueId, limit)
    .map(rowToActivity);

export const listRecentUserIssueActivities = (
  db: Database,
  agentId: string,
  limit = 6,
): ReadonlyArray<{
  readonly activity: AgentIssueActivity;
  readonly issueKey: string;
  readonly issueTitle: string;
}> =>
  db
    .query<
      IssueActivityRow & { readonly issue_key: string; readonly issue_title: string },
      [string, string, number]
    >(
      `SELECT a.*, i.key AS issue_key, i.title AS issue_title
       FROM agent_issue_activities a
       JOIN agent_issues i ON i.id = a.issue_id
       WHERE a.actor_kind = 'user'
         AND (i.agent_id = ? OR (i.assignee_kind = 'agent' AND i.assignee_agent_id = ?))
         AND i.state NOT IN ('done', 'canceled')
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(agentId, agentId, limit)
    .map((row) => ({
      activity: rowToActivity(row),
      issueKey: row.issue_key,
      issueTitle: row.issue_title,
    }));

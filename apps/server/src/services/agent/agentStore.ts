import type { Database } from "bun:sqlite";
import {
  type Agent,
  type AgentCheckIn,
  AgentModelStack,
  ModelSelection,
  ThreadRuntime,
  type UpdateAgentInput,
} from "@scuttle/contracts";
import { AgentCheckInId, AgentId, ProjectId, ProviderId, ThreadId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

export {
  deleteMemoryRow,
  findActiveMemoryByNormalizedTitle,
  insertMemory,
  listMemories,
  normalizeMemoryTitle,
  readMemoryById,
  recordMemoryAccess,
  searchMemories,
  toFtsMatchQuery,
  updateMemoryRow,
} from "./agentMemoryStore.ts";

interface AgentJoinRow {
  readonly id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly project_path: string;
  readonly name: string;
  readonly purpose: string;
  readonly primary_thread_id: string;
  readonly runtime: string;
  readonly model_selection_json: string;
  readonly model_stack_json: string;
  readonly instructions_md: string;
  readonly check_in_interval_minutes: number | null;
  readonly last_check_in_at: string | null;
  readonly last_summary: string | null;
  readonly pinned: number;
  readonly needs_attention: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CheckInRow {
  readonly id: string;
  readonly agent_id: string;
  readonly summary: string;
  readonly active_delegations: number;
  readonly open_prs: number;
  readonly open_issues: number;
  readonly created_at: string;
}

const decodeRuntime = Schema.decodeUnknownOption(ThreadRuntime);
const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeModelStack = Schema.decodeUnknownOption(AgentModelStack);

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

const normalizeModelStack = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const entries = Object.entries(raw);
  const hasAgent = entries.some(([key]) => key === "agent");
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key === "captain") {
      if (!hasAgent) normalized.agent = value;
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
};

const rowToAgent = (row: AgentJoinRow): Agent => {
  const runtimeOpt = decodeRuntime(row.runtime);
  const modelOpt = decodeModelSelection(safeJsonParse(row.model_selection_json));
  const stackOpt = decodeModelStack(normalizeModelStack(safeJsonParse(row.model_stack_json)));
  return {
    id: AgentId.make(row.id),
    projectId: ProjectId.make(row.project_id),
    projectName: row.project_name,
    projectPath: row.project_path,
    name: row.name,
    purpose: row.purpose,
    primaryThreadId: ThreadId.make(row.primary_thread_id),
    runtime: runtimeOpt._tag === "Some" ? runtimeOpt.value : "local",
    modelSelection: modelOpt._tag === "Some" ? modelOpt.value : FALLBACK_MODEL,
    modelStack: stackOpt._tag === "Some" ? stackOpt.value : {},
    instructionsMd: row.instructions_md,
    ...(row.check_in_interval_minutes !== null
      ? { checkInIntervalMinutes: row.check_in_interval_minutes }
      : {}),
    ...(row.last_check_in_at !== null ? { lastCheckInAt: row.last_check_in_at } : {}),
    ...(row.last_summary !== null ? { lastSummary: row.last_summary } : {}),
    pinned: row.pinned === 1,
    needsAttention: row.needs_attention === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const rowToCheckIn = (row: CheckInRow): AgentCheckIn => ({
  id: AgentCheckInId.make(row.id),
  agentId: AgentId.make(row.agent_id),
  summary: row.summary,
  activeDelegations: row.active_delegations,
  openPrs: row.open_prs,
  openIssues: row.open_issues,
  createdAt: row.created_at,
});

const AGENT_SELECT = `
  SELECT a.*, p.name AS project_name, p.path AS project_path
  FROM agents a
  JOIN projects p ON p.id = a.project_id
`;

export const listAgents = (db: Database): ReadonlyArray<Agent> =>
  db
    .query<AgentJoinRow, []>(
      `${AGENT_SELECT} ORDER BY a.pinned DESC, a.needs_attention DESC, a.updated_at DESC`,
    )
    .all()
    .map(rowToAgent);

export const readAgentById = (db: Database, agentId: string): Agent | null => {
  const row = db.query<AgentJoinRow, [string]>(`${AGENT_SELECT} WHERE a.id = ?`).get(agentId);
  return row ? rowToAgent(row) : null;
};

export const readAgentByPrimaryThreadId = (db: Database, threadId: string): Agent | null => {
  const row = db
    .query<AgentJoinRow, [string]>(`${AGENT_SELECT} WHERE a.primary_thread_id = ?`)
    .get(threadId);
  return row ? rowToAgent(row) : null;
};

export const listProjectsMissingAgents = (
  db: Database,
): ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly default_branch: string;
}> =>
  db
    .query<
      {
        readonly id: string;
        readonly name: string;
        readonly path: string;
        readonly default_branch: string;
      },
      []
    >(
      `SELECT p.id, p.name, p.path, p.default_branch
       FROM projects p
       WHERE NOT EXISTS (SELECT 1 FROM agents a WHERE a.project_id = p.id)`,
    )
    .all();

export const insertAgent = (db: Database, agent: Agent): void => {
  db.prepare(
    `INSERT INTO agents
       (id, project_id, name, purpose, primary_thread_id, runtime, model_selection_json, model_stack_json,
        instructions_md, check_in_interval_minutes, last_check_in_at, last_summary, pinned, needs_attention, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    agent.projectId,
    agent.name,
    agent.purpose,
    agent.primaryThreadId,
    agent.runtime,
    JSON.stringify(agent.modelSelection),
    JSON.stringify(agent.modelStack),
    agent.instructionsMd,
    agent.checkInIntervalMinutes ?? null,
    agent.lastCheckInAt ?? null,
    agent.lastSummary ?? null,
    agent.pinned ? 1 : 0,
    agent.needsAttention ? 1 : 0,
    agent.createdAt,
    agent.updatedAt,
  );
};

export const updateAgentRow = (db: Database, agent: Agent): void => {
  db.prepare(
    `UPDATE agents
     SET name = ?, purpose = ?, runtime = ?, model_selection_json = ?, model_stack_json = ?,
         instructions_md = ?, check_in_interval_minutes = ?, last_check_in_at = ?, last_summary = ?,
         pinned = ?, needs_attention = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    agent.name,
    agent.purpose,
    agent.runtime,
    JSON.stringify(agent.modelSelection),
    JSON.stringify(agent.modelStack),
    agent.instructionsMd,
    agent.checkInIntervalMinutes ?? null,
    agent.lastCheckInAt ?? null,
    agent.lastSummary ?? null,
    agent.pinned ? 1 : 0,
    agent.needsAttention ? 1 : 0,
    agent.updatedAt,
    agent.id,
  );
};

export const updateAgentCheckInMeta = (
  db: Database,
  agentId: string,
  meta: {
    readonly lastCheckInAt: string;
    readonly lastSummary: string;
    readonly updatedAt: string;
  },
): void => {
  db.prepare(
    `UPDATE agents
     SET last_check_in_at = ?, last_summary = ?, updated_at = ?
     WHERE id = ?`,
  ).run(meta.lastCheckInAt, meta.lastSummary, meta.updatedAt, agentId);
};

export const deleteAgentRow = (db: Database, agentId: string): void => {
  db.transaction(() => {
    db.prepare("DELETE FROM agent_memories_fts WHERE agent_id = ?").run(agentId);
    db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  })();
};

export const listCheckIns = (
  db: Database,
  agentId: string,
  limit = 25,
): ReadonlyArray<AgentCheckIn> =>
  db
    .query<CheckInRow, [string, number]>(
      "SELECT * FROM agent_checkins WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(agentId, limit)
    .map(rowToCheckIn);

export const insertCheckIn = (db: Database, checkIn: AgentCheckIn): void => {
  db.prepare(
    `INSERT INTO agent_checkins
       (id, agent_id, summary, active_delegations, open_prs, open_issues, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    checkIn.id,
    checkIn.agentId,
    checkIn.summary,
    checkIn.activeDelegations,
    checkIn.openPrs,
    checkIn.openIssues,
    checkIn.createdAt,
  );
};

export const buildUpdatedAgent = (existing: Agent, input: UpdateAgentInput): Agent => {
  const nextInterval =
    input.checkInIntervalMinutes === undefined
      ? existing.checkInIntervalMinutes
      : input.checkInIntervalMinutes === null
        ? undefined
        : input.checkInIntervalMinutes;
  const nextName = input.name?.trim() || existing.name;
  return {
    id: existing.id,
    projectId: existing.projectId,
    projectName: existing.projectName,
    projectPath: existing.projectPath,
    name: nextName,
    purpose: input.purpose !== undefined ? input.purpose : existing.purpose,
    primaryThreadId: existing.primaryThreadId,
    runtime: input.runtime ?? existing.runtime,
    modelSelection: input.modelSelection ?? existing.modelSelection,
    modelStack: input.modelStack ?? existing.modelStack,
    instructionsMd:
      input.instructionsMd !== undefined ? input.instructionsMd : existing.instructionsMd,
    ...(nextInterval !== undefined ? { checkInIntervalMinutes: nextInterval } : {}),
    ...(existing.lastCheckInAt !== undefined ? { lastCheckInAt: existing.lastCheckInAt } : {}),
    ...(existing.lastSummary !== undefined ? { lastSummary: existing.lastSummary } : {}),
    pinned: input.pinned ?? existing.pinned,
    needsAttention: input.needsAttention ?? existing.needsAttention,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
};

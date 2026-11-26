import type { Database } from "bun:sqlite";
import {
  type AgentDelegationQuestion,
  AgentDelegationQuestionKind,
  AgentDelegationQuestionStatus,
} from "@scuttle/contracts";
import {
  AgentDelegationId,
  AgentDelegationQuestionId,
  AgentId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

interface QuestionRow {
  readonly id: string;
  readonly delegation_id: string;
  readonly agent_id: string;
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

const decodeQuestionKind = Schema.decodeUnknownOption(AgentDelegationQuestionKind);
const decodeQuestionStatus = Schema.decodeUnknownOption(AgentDelegationQuestionStatus);

const rowToQuestion = (row: QuestionRow): AgentDelegationQuestion => {
  const kindOpt = decodeQuestionKind(row.kind);
  const statusOpt = decodeQuestionStatus(row.status);
  return {
    id: AgentDelegationQuestionId.make(row.id),
    delegationId: AgentDelegationId.make(row.delegation_id),
    agentId: AgentId.make(row.agent_id),
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

export const insertQuestion = (db: Database, question: AgentDelegationQuestion): void => {
  db.prepare(
    `INSERT INTO agent_delegation_questions
       (id, delegation_id, agent_id, child_thread_id, parent_thread_id, parent_turn_id,
        kind, question, attempted, context, status, answer, error, bounce_number, created_at, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    question.id,
    question.delegationId,
    question.agentId,
    question.childThreadId,
    question.parentThreadId,
    question.parentTurnId ?? null,
    question.kind,
    question.question,
    question.attempted ?? null,
    question.context ?? null,
    question.status,
    question.answer ?? null,
    question.error ?? null,
    question.bounceNumber,
    question.createdAt,
    question.answeredAt ?? null,
  );
};

export const updateQuestionRow = (db: Database, question: AgentDelegationQuestion): void => {
  db.prepare(
    `UPDATE agent_delegation_questions
     SET parent_turn_id = ?, status = ?, answer = ?, error = ?, answered_at = ?
     WHERE id = ?`,
  ).run(
    question.parentTurnId ?? null,
    question.status,
    question.answer ?? null,
    question.error ?? null,
    question.answeredAt ?? null,
    question.id,
  );
};

export const readQuestionById = (
  db: Database,
  questionId: string,
): AgentDelegationQuestion | null => {
  const row = db
    .query<QuestionRow, [string]>("SELECT * FROM agent_delegation_questions WHERE id = ?")
    .get(questionId);
  return row ? rowToQuestion(row) : null;
};

export const readPendingQuestionForDelegation = (
  db: Database,
  delegationId: string,
): AgentDelegationQuestion | null => {
  const row = db
    .query<QuestionRow, [string]>(
      "SELECT * FROM agent_delegation_questions WHERE delegation_id = ? AND status = 'pending' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(delegationId);
  return row ? rowToQuestion(row) : null;
};

export const listQuestionsForDelegation = (
  db: Database,
  agentId: string,
  delegationId: string,
): ReadonlyArray<AgentDelegationQuestion> =>
  db
    .query<QuestionRow, [string, string]>(
      "SELECT * FROM agent_delegation_questions WHERE agent_id = ? AND delegation_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(agentId, delegationId)
    .map(rowToQuestion);

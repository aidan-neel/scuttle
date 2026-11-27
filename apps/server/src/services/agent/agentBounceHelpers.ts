import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentDelegation,
  AgentDelegationQuestion,
  AskDelegationParentInput,
  ThreadTurn,
} from "@scuttle/contracts";
import type { AgentDelegationId, AgentId, ThreadId, TurnId } from "@scuttle/shared/ids";
import type * as EventBus from "../EventBus.ts";
import { readThreadById, readTurnsForThread } from "../threadStore.ts";
import { readQuestionById, updateQuestionRow } from "./agentQuestionStore.ts";
import { readAgentById, updateAgentRow } from "./agentStore.ts";
import {
  readDelegationByDelegationId,
  readDelegationById,
  updateDelegationRow,
} from "./agentWorkStore.ts";

export const MAX_QUESTION_CHARS = 4_000;
export const MAX_ATTEMPTED_CHARS = 4_000;
export const MAX_CONTEXT_CHARS = 8_000;

export interface QuestionSettlementPatch {
  readonly status: "answered" | "failed" | "canceled";
  readonly answer?: string;
  readonly error?: string;
  readonly answeredAt: string;
}

export const hasRunningTurnOnThread = (db: Database, threadId: string): boolean =>
  db
    .query<{ readonly present: number }, [string]>(
      "SELECT 1 AS present FROM turns WHERE thread_id = ? AND status = 'running' LIMIT 1",
    )
    .get(threadId) !== null;

export const readSettledTurn = (
  db: Database,
  threadId: ThreadId,
  turnId: TurnId,
): ThreadTurn | undefined => {
  const thread = readThreadById(db, threadId);
  if (!thread) return undefined;
  return readTurnsForThread(db, thread).find((t) => t.id === turnId && t.status !== "running");
};

export const validateAskInput = (input: AskDelegationParentInput): string | null => {
  if (input.question.trim().length === 0) {
    return "Question must not be blank.";
  }
  if (input.question.length > MAX_QUESTION_CHARS) {
    return `Question exceeds ${MAX_QUESTION_CHARS} characters.`;
  }
  if (input.attempted !== undefined && input.attempted.length > MAX_ATTEMPTED_CHARS) {
    return `Attempted summary exceeds ${MAX_ATTEMPTED_CHARS} characters.`;
  }
  if (input.context !== undefined && input.context.length > MAX_CONTEXT_CHARS) {
    return `Context exceeds ${MAX_CONTEXT_CHARS} characters.`;
  }
  return null;
};

export const applyQuestionPatch = (
  question: AgentDelegationQuestion,
  patch: QuestionSettlementPatch,
): AgentDelegationQuestion => ({
  ...question,
  status: patch.status,
  ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
  ...(patch.error !== undefined ? { error: patch.error } : {}),
  answeredAt: patch.answeredAt,
});

export const restoreDelegationIfWaiting = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  agentId: AgentId | undefined,
  delegationId: AgentDelegationId,
): void => {
  const delegation = agentId
    ? readDelegationById(db, agentId, delegationId)
    : readDelegationByDelegationId(db, delegationId);
  if (!delegation || delegation.status !== "waiting_parent") return;
  const restored: AgentDelegation = { ...delegation, status: "running" };
  updateDelegationRow(db, restored);
  eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: restored });
};

export const markParentNeedsAttention = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  agentId: AgentId,
  updatedAt: string,
): void => {
  const parent = readAgentById(db, agentId);
  if (!parent || parent.needsAttention) return;
  const nextParent: Agent = { ...parent, needsAttention: true, updatedAt };
  updateAgentRow(db, nextParent);
  eventBus.publishSync({ kind: "agent.upserted", agent: nextParent });
};

export const buildParentTurnOutcomePatch = (
  turn: ThreadTurn,
):
  | { readonly ok: true; readonly patch: QuestionSettlementPatch }
  | {
      readonly ok: false;
      readonly patch: QuestionSettlementPatch;
      readonly completedAt: string;
    } => {
  const completedAt = turn.completedAt ?? new Date().toISOString();
  const answer = turn.assistantMessage.trim();
  if (turn.status === "completed" && answer.length > 0) {
    return {
      ok: true,
      patch: { status: "answered", answer, answeredAt: completedAt },
    };
  }
  const emptyReason =
    turn.status === "completed"
      ? "Parent agent returned an empty response."
      : `Parent turn ${turn.status}.`;
  return {
    ok: false,
    completedAt,
    patch: { status: "failed", error: turn.error?.trim() || emptyReason, answeredAt: completedAt },
  };
};

export const persistPendingQuestionPatch = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  questionId: string,
  patch: QuestionSettlementPatch,
  restoreDelegation: boolean,
): AgentDelegationQuestion | null => {
  const current = readQuestionById(db, questionId);
  if (!current) return null;
  if (current.status !== "pending") return current;
  const updated = applyQuestionPatch(current, patch);
  updateQuestionRow(db, updated);
  if (restoreDelegation) {
    restoreDelegationIfWaiting(db, eventBus, current.agentId, current.delegationId);
  }
  eventBus.publishSync({ kind: "agent.delegation.question.upserted", question: updated });
  return updated;
};

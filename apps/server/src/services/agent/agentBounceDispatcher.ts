import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentDelegationQuestion,
  SendTurnInput,
  ThreadTurn,
  TurnOrigin,
} from "@scuttle/contracts";
import type { AgentDelegationQuestionId, AgentId, ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import {
  hasRunningTurnOnThread,
  markParentNeedsAttention,
  type QuestionSettlementPatch,
  readSettledTurn,
} from "./agentBounceHelpers.ts";
import { buildParentQuestionPrompt } from "./agentPrompts.ts";
import { readQuestionById, updateQuestionRow } from "./agentQuestionStore.ts";
import { readAgentById } from "./agentStore.ts";
import { readDelegationById } from "./agentWorkStore.ts";
import type { AgentServiceError } from "./errors.ts";

export interface ActiveParentTurn {
  readonly agentId: AgentId;
  readonly parentThreadId: ThreadId;
  readonly questionId: AgentDelegationQuestionId;
}

export const makeAgentBounceDispatcher = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly queues: Map<AgentId, AgentDelegationQuestionId[]>;
  readonly activeParentTurns: Map<TurnId, ActiveParentTurn>;
  readonly isDisposed: () => boolean;
  readonly removeFromQueue: (agentId: AgentId, questionId: AgentDelegationQuestionId) => void;
  readonly interruptTurn: (threadId: ThreadId, turnId: TurnId) => void;
  readonly sendAgentTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly settlePendingQuestion: (
    questionId: AgentDelegationQuestionId,
    patch: QuestionSettlementPatch,
    options: { readonly restoreDelegation: boolean; readonly fallbackAgentId?: AgentId },
  ) => AgentDelegationQuestion | null;
  readonly settleParentTurnQuestion: (
    agentId: AgentId,
    questionId: AgentDelegationQuestionId,
    turn: ThreadTurn,
  ) => void;
}) => {
  const {
    db,
    eventBus,
    queues,
    activeParentTurns,
    isDisposed,
    removeFromQueue,
    interruptTurn,
    sendAgentTurn,
    settlePendingQuestion,
    settleParentTurnQuestion,
  } = deps;
  const pumpingAgents = new Set<AgentId>();

  const hasActiveParentTurnForAgent = (agentId: AgentId): boolean => {
    for (const entry of activeParentTurns.values()) {
      if (entry.agentId === agentId) return true;
    }
    return false;
  };

  const failQueuedQuestions = (agentId: AgentId, detail: string) => {
    const queue = [...(queues.get(agentId) ?? [])];
    const now = new Date().toISOString();
    for (const qid of queue) {
      settlePendingQuestion(
        qid,
        { status: "failed", error: detail, answeredAt: now },
        { restoreDelegation: true, fallbackAgentId: agentId },
      );
    }
  };

  const dispatchQueuedQuestion = async (
    agent: Agent,
    question: AgentDelegationQuestion,
  ): Promise<"dispatched" | "busy" | "settled"> => {
    const delegation = readDelegationById(db, agent.id, question.delegationId);
    const prompt = buildParentQuestionPrompt({ agent, delegation, question });
    const result = await Effect.runPromise(
      sendAgentTurn(agent.id, { prompt }, { origin: "system" }).pipe(Effect.result),
    );
    if (isDisposed()) return "busy";

    if (result._tag === "Failure") {
      const detail = result.failure.message;
      if (detail.includes("already has a turn running")) return "busy";
      const now = new Date().toISOString();
      markParentNeedsAttention(db, eventBus, agent.id, now);
      settlePendingQuestion(
        question.id,
        { status: "failed", error: detail, answeredAt: now },
        { restoreDelegation: true, fallbackAgentId: agent.id },
      );
      return "settled";
    }

    const turn = result.success;
    removeFromQueue(agent.id, question.id);
    const refreshed = readQuestionById(db, question.id);
    if (!refreshed || refreshed.status !== "pending") {
      interruptTurn(agent.primaryThreadId, turn.id);
      return "settled";
    }

    const settledTurn = readSettledTurn(db, agent.primaryThreadId, turn.id);
    if (settledTurn) {
      settleParentTurnQuestion(agent.id, question.id, settledTurn);
      return "settled";
    }

    activeParentTurns.set(turn.id, {
      agentId: agent.id,
      parentThreadId: agent.primaryThreadId,
      questionId: question.id,
    });
    const linked: AgentDelegationQuestion = { ...refreshed, parentTurnId: turn.id };
    updateQuestionRow(db, linked);
    eventBus.publishSync({ kind: "agent.delegation.question.upserted", question: linked });
    return "dispatched";
  };

  const pumpAgentQueue = async (agentId: AgentId): Promise<void> => {
    if (isDisposed() || pumpingAgents.has(agentId) || hasActiveParentTurnForAgent(agentId)) return;
    pumpingAgents.add(agentId);
    let repump = false;
    try {
      while (!isDisposed() && !hasActiveParentTurnForAgent(agentId)) {
        const queue = queues.get(agentId);
        if (!queue || queue.length === 0) break;

        const question = readQuestionById(db, queue[0]!);
        if (!question || question.status !== "pending") {
          queue.shift();
          if (queue.length === 0) queues.delete(agentId);
          continue;
        }

        const agent = readAgentById(db, agentId);
        if (!agent) {
          failQueuedQuestions(agentId, `Agent "${agentId}" was not found.`);
          break;
        }
        if (hasRunningTurnOnThread(db, agent.primaryThreadId)) break;

        const outcome = await dispatchQueuedQuestion(agent, question);
        if (outcome !== "settled") break;
      }
    } finally {
      pumpingAgents.delete(agentId);
      const remaining = queues.get(agentId);
      const agent =
        !isDisposed() && remaining && remaining.length > 0 ? readAgentById(db, agentId) : null;
      if (
        agent &&
        !hasActiveParentTurnForAgent(agentId) &&
        !hasRunningTurnOnThread(db, agent.primaryThreadId)
      ) {
        repump = true;
      }
    }
    if (repump) {
      queueMicrotask(() => {
        triggerPump(agentId);
      });
    }
  };

  const triggerPump = (agentId: AgentId) => {
    void pumpAgentQueue(agentId).catch(() => undefined);
  };

  return { triggerPump };
};

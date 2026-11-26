import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentDelegation,
  AgentDelegationQuestion,
  AskDelegationParentInput,
  SendTurnInput,
  ThreadTurn,
  TurnOrigin,
} from "@scuttle/contracts";
import {
  type AgentDelegationId,
  AgentDelegationQuestionId,
  type AgentId,
  type ThreadId,
  type TurnId,
} from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import { type ActiveParentTurn, makeAgentBounceDispatcher } from "./agentBounceDispatcher.ts";
import {
  applyQuestionPatch,
  buildParentTurnOutcomePatch,
  markParentNeedsAttention,
  persistPendingQuestionPatch,
  type QuestionSettlementPatch,
  validateAskInput,
} from "./agentBounceHelpers.ts";
import {
  insertQuestion,
  listPendingQuestionIdsForAgent,
  listQuestionsForDelegation,
  readPendingQuestionForDelegation,
  readQuestionById,
} from "./agentQuestionStore.ts";
import { readAgentByPrimaryThreadId } from "./agentStore.ts";
import { readDelegationById, updateDelegationRow } from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";

export const DEFAULT_ASK_PARENT_TIMEOUT_MS = 300_000;

interface QuestionWaiter {
  readonly question: AgentDelegationQuestion;
  readonly resolve: (settled: AgentDelegationQuestion) => void;
}

export const makeAgentBounceOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
  readonly sendAgentTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly interruptThreadTurn: (
    threadId: ThreadId,
    expectedTurnId?: TurnId,
  ) => Effect.Effect<void, unknown>;
  readonly askParentTimeoutMs?: number;
}) => {
  const {
    db,
    eventBus,
    requireAgent,
    sendAgentTurn,
    interruptThreadTurn,
    askParentTimeoutMs = DEFAULT_ASK_PARENT_TIMEOUT_MS,
  } = deps;

  const waiters = new Map<AgentDelegationQuestionId, QuestionWaiter>();
  const questionTimers = new Map<AgentDelegationQuestionId, ReturnType<typeof setTimeout>>();
  const queues = new Map<AgentId, AgentDelegationQuestionId[]>();
  const activeParentTurns = new Map<TurnId, ActiveParentTurn>();
  let disposed = false;

  const clearQuestionTimer = (questionId: AgentDelegationQuestionId) => {
    const timer = questionTimers.get(questionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    questionTimers.delete(questionId);
  };

  const removeFromQueue = (agentId: AgentId, questionId: AgentDelegationQuestionId) => {
    const queue = queues.get(agentId);
    if (!queue) return;
    const idx = queue.indexOf(questionId);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) queues.delete(agentId);
  };

  const resolveWaiter = (
    questionId: AgentDelegationQuestionId,
    question: AgentDelegationQuestion,
  ) => {
    const waiter = waiters.get(questionId);
    if (!waiter) return;
    waiters.delete(questionId);
    waiter.resolve(question);
  };

  const interruptTurn = (threadId: ThreadId, turnId: TurnId) => {
    Effect.runFork(interruptThreadTurn(threadId, turnId).pipe(Effect.ignore));
  };

  const interruptActiveParentTurnForQuestion = (
    questionId: AgentDelegationQuestionId,
  ): AgentId | null => {
    for (const [turnId, entry] of activeParentTurns.entries()) {
      if (entry.questionId !== questionId) continue;
      activeParentTurns.delete(turnId);
      interruptTurn(entry.parentThreadId, turnId);
      return entry.agentId;
    }
    return null;
  };

  const settlePendingQuestion = (
    questionId: AgentDelegationQuestionId,
    patch: QuestionSettlementPatch,
    options: { readonly restoreDelegation: boolean; readonly fallbackAgentId?: AgentId },
  ): AgentDelegationQuestion | null => {
    clearQuestionTimer(questionId);
    const waiter = waiters.get(questionId);
    const persisted = persistPendingQuestionPatch(
      db,
      eventBus,
      questionId,
      patch,
      options.restoreDelegation,
    );
    const agentId = persisted?.agentId ?? waiter?.question.agentId ?? options.fallbackAgentId;
    if (agentId) {
      removeFromQueue(agentId, questionId);
    }
    if (!persisted) {
      if (!waiter) return null;
      const fallback = applyQuestionPatch(waiter.question, patch);
      resolveWaiter(questionId, fallback);
      return fallback;
    }
    resolveWaiter(questionId, persisted);
    return persisted;
  };

  const settleParentTurnQuestion = (
    agentId: AgentId,
    questionId: AgentDelegationQuestionId,
    turn: ThreadTurn,
  ) => {
    const question = readQuestionById(db, questionId);
    if (!question || question.status !== "pending") return;
    const outcome = buildParentTurnOutcomePatch(turn);
    if (!outcome.ok) {
      markParentNeedsAttention(db, eventBus, agentId, outcome.completedAt);
    }
    settlePendingQuestion(question.id, outcome.patch, { restoreDelegation: true });
  };

  const { triggerPump } = makeAgentBounceDispatcher({
    db,
    eventBus,
    queues,
    activeParentTurns,
    isDisposed: () => disposed,
    removeFromQueue,
    interruptTurn,
    sendAgentTurn,
    settlePendingQuestion,
    settleParentTurnQuestion,
  });

  const cancelPendingQuestion = (
    questionId: AgentDelegationQuestionId,
    error: string,
    options: {
      readonly restoreDelegation: boolean;
      readonly fallbackAgentId?: AgentId;
      readonly pumpAfter?: boolean;
    },
  ): AgentDelegationQuestion | null => {
    const interruptedAgentId = interruptActiveParentTurnForQuestion(questionId);
    const settled = settlePendingQuestion(
      questionId,
      { status: "canceled", error, answeredAt: new Date().toISOString() },
      options,
    );
    const agentId = settled?.agentId ?? interruptedAgentId ?? options.fallbackAgentId;
    if (options.pumpAfter !== false && interruptedAgentId && agentId && !disposed) {
      triggerPump(agentId);
    }
    return settled;
  };

  const startQuestionTimer = (agentId: AgentId, questionId: AgentDelegationQuestionId) => {
    if (askParentTimeoutMs <= 0 || !Number.isFinite(askParentTimeoutMs)) return;
    clearQuestionTimer(questionId);
    const timer = setTimeout(() => {
      questionTimers.delete(questionId);
      cancelPendingQuestion(
        questionId,
        `Timed out after ${askParentTimeoutMs}ms waiting for parent Agent.`,
        { restoreDelegation: true, fallbackAgentId: agentId },
      );
    }, askParentTimeoutMs);
    questionTimers.set(questionId, timer);
  };

  const askParent = Effect.fn("AgentService.askParent")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) {
    const inputError = validateAskInput(input);
    if (inputError !== null) {
      return yield* new AgentServiceError({ reason: "invalid", detail: inputError });
    }
    const agent = yield* requireAgent(agentId);
    const delegation = readDelegationById(db, agent.id, delegationId);
    if (!delegation) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Delegation "${delegationId}" was not found.`,
      });
    }
    if (delegation.status !== "running") {
      return yield* new AgentServiceError({
        reason: "rejected",
        detail:
          delegation.status === "waiting_parent"
            ? "Delegation already has a pending question awaiting the parent Agent."
            : `Delegation is "${delegation.status}" and cannot ask parent.`,
      });
    }
    if (delegation.bounceCount >= delegation.maxBounces) {
      return yield* new AgentServiceError({
        reason: "rejected",
        detail: `Bounce limit reached (${delegation.bounceCount}/${delegation.maxBounces}). Stop retrying and report your findings and blockers cleanly.`,
      });
    }
    if (options?.signal?.aborted) {
      return yield* new AgentServiceError({
        reason: "rejected",
        detail: "Request aborted before submitting question.",
      });
    }

    const now = new Date().toISOString();
    const trimmedAttempted = input.attempted?.trim();
    const trimmedContext = input.context?.trim();
    const question: AgentDelegationQuestion = {
      id: AgentDelegationQuestionId.make(crypto.randomUUID()),
      delegationId: delegation.id,
      agentId: agent.id,
      childThreadId: delegation.childThreadId,
      parentThreadId: delegation.parentThreadId,
      kind: input.kind ?? "other",
      question: input.question.trim(),
      ...(trimmedAttempted && trimmedAttempted.length > 0 ? { attempted: trimmedAttempted } : {}),
      ...(trimmedContext && trimmedContext.length > 0 ? { context: trimmedContext } : {}),
      status: "pending",
      bounceNumber: delegation.bounceCount + 1,
      createdAt: now,
    };
    const waitingDelegation: AgentDelegation = {
      ...delegation,
      status: "waiting_parent",
      bounceCount: delegation.bounceCount + 1,
    };

    db.transaction(() => {
      insertQuestion(db, question);
      updateDelegationRow(db, waitingDelegation);
    })();
    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: waitingDelegation });
    eventBus.publishSync({ kind: "agent.delegation.question.upserted", question });

    return yield* Effect.callback<AgentDelegationQuestion>((resume) => {
      let detached = false;

      const detachWaiter = (): boolean => {
        if (detached) return false;
        detached = true;
        options?.signal?.removeEventListener("abort", onAbort);
        waiters.delete(question.id);
        return true;
      };

      const finish = (settledQuestion: AgentDelegationQuestion) => {
        if (!detachWaiter()) return;
        resume(Effect.succeed(settledQuestion));
      };

      const onAbort = () => {
        if (!detachWaiter()) return;
        resume(Effect.succeed(readQuestionById(db, question.id) ?? question));
      };

      waiters.set(question.id, { question, resolve: finish });
      const queue = queues.get(agent.id) ?? [];
      queue.push(question.id);
      queues.set(agent.id, queue);
      startQuestionTimer(agent.id, question.id);
      triggerPump(agent.id);

      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      return Effect.sync(() => {
        detachWaiter();
      });
    });
  });

  const listQuestions = Effect.fn("AgentService.listDelegationQuestions")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) {
    yield* requireAgent(agentId);
    const delegation = readDelegationById(db, agentId, delegationId);
    if (!delegation) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Delegation "${delegationId}" was not found.`,
      });
    }
    return listQuestionsForDelegation(db, agentId, delegationId);
  });

  const handlePrimaryOrParentTurnSettled = (turn: ThreadTurn): boolean => {
    const active = activeParentTurns.get(turn.id);
    if (active) {
      activeParentTurns.delete(turn.id);
      settleParentTurnQuestion(active.agentId, active.questionId, turn);
      triggerPump(active.agentId);
      return true;
    }

    const primaryAgent = readAgentByPrimaryThreadId(db, turn.threadId);
    if (!primaryAgent) return false;
    triggerPump(primaryAgent.id);
    return true;
  };

  const cancelForDelegation = (
    delegationId: AgentDelegationId,
    error: string,
    options?: { readonly restoreDelegation?: boolean },
  ) => {
    const pendingId =
      readPendingQuestionForDelegation(db, delegationId)?.id ??
      Array.from(waiters.values()).find((w) => w.question.delegationId === delegationId)?.question
        .id;
    if (!pendingId) return;
    cancelPendingQuestion(pendingId, error, {
      restoreDelegation: options?.restoreDelegation ?? false,
    });
  };

  const cancelPendingForAgent = (agentId: AgentId, reason: string) => {
    const questionIds = new Set<AgentDelegationQuestionId>(queues.get(agentId) ?? []);
    for (const entry of activeParentTurns.values()) {
      if (entry.agentId === agentId) questionIds.add(entry.questionId);
    }
    for (const waiter of waiters.values()) {
      if (waiter.question.agentId === agentId) questionIds.add(waiter.question.id);
    }
    for (const qid of listPendingQuestionIdsForAgent(db, agentId)) {
      questionIds.add(qid);
    }
    for (const questionId of questionIds) {
      cancelPendingQuestion(questionId, reason, {
        restoreDelegation: false,
        fallbackAgentId: agentId,
        pumpAfter: false,
      });
    }
    queues.delete(agentId);
  };

  const dispose = () => {
    disposed = true;
    for (const timer of questionTimers.values()) {
      clearTimeout(timer);
    }
    questionTimers.clear();
    const now = new Date().toISOString();
    for (const [questionId, waiter] of Array.from(waiters.entries())) {
      try {
        settlePendingQuestion(
          questionId,
          { status: "canceled", error: "Server shutting down.", answeredAt: now },
          { restoreDelegation: true, fallbackAgentId: waiter.question.agentId },
        );
      } catch {
        waiters.delete(questionId);
      }
    }
    waiters.clear();
    queues.clear();
    activeParentTurns.clear();
  };

  return {
    askParent,
    listQuestions,
    handlePrimaryOrParentTurnSettled,
    cancelForDelegation,
    cancelPendingForAgent,
    dispose,
  };
};

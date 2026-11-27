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
  type QuestionSettlementPatch,
  validateAskInput,
} from "./agentBounceHelpers.ts";
import { readAgentByPrimaryThreadId } from "./agentStore.ts";
import {
  insertThreadQuestion,
  listPendingQuestionIdsByAgent,
  listQuestionsByDelegationId,
  readDelegationByDelegationId,
  readDelegationById,
  readPendingThreadQuestionForDelegation,
  readThreadQuestionById,
  updateDelegationRow,
  updateThreadQuestionRow,
} from "./agentWorkStore.ts";
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
  readonly sendThreadTurn: (
    threadId: ThreadId,
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
    sendThreadTurn,
    interruptThreadTurn,
    askParentTimeoutMs = DEFAULT_ASK_PARENT_TIMEOUT_MS,
  } = deps;
  const waiters = new Map<AgentDelegationQuestionId, QuestionWaiter>();
  const questionTimers = new Map<AgentDelegationQuestionId, ReturnType<typeof setTimeout>>();
  const queues = new Map<ThreadId, AgentDelegationQuestionId[]>();
  const activeParentTurns = new Map<TurnId, ActiveParentTurn>();
  let disposed = false;

  const clearQuestionTimer = (questionId: AgentDelegationQuestionId) => {
    const timer = questionTimers.get(questionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    questionTimers.delete(questionId);
  };

  const removeFromQueue = (parentThreadId: ThreadId, questionId: AgentDelegationQuestionId) => {
    const queue = queues.get(parentThreadId);
    if (!queue) return;
    const idx = queue.indexOf(questionId);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) queues.delete(parentThreadId);
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
  ): ThreadId | null => {
    for (const [turnId, entry] of activeParentTurns.entries()) {
      if (entry.questionId !== questionId) continue;
      activeParentTurns.delete(turnId);
      interruptTurn(entry.parentThreadId, turnId);
      return entry.parentThreadId;
    }
    return null;
  };

  const persistPendingPatch = (
    questionId: string,
    patch: QuestionSettlementPatch,
    restoreDelegation: boolean,
  ): AgentDelegationQuestion | null => {
    const current = readThreadQuestionById(db, questionId);
    if (!current) return null;
    if (current.status !== "pending") return current;
    const updated = applyQuestionPatch(current, patch);
    updateThreadQuestionRow(db, updated);
    if (restoreDelegation) {
      const delegation = readDelegationByDelegationId(db, current.delegationId);
      if (delegation && delegation.status === "waiting_parent") {
        const restored: AgentDelegation = { ...delegation, status: "running" };
        updateDelegationRow(db, restored);
        eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: restored });
      }
    }
    eventBus.publishSync({ kind: "agent.delegation.question.upserted", question: updated });
    return updated;
  };

  const settlePendingQuestion = (
    questionId: AgentDelegationQuestionId,
    patch: QuestionSettlementPatch,
    options: { readonly restoreDelegation: boolean; readonly fallbackParentThreadId?: ThreadId },
  ): AgentDelegationQuestion | null => {
    clearQuestionTimer(questionId);
    const waiter = waiters.get(questionId);
    const persisted = persistPendingPatch(questionId, patch, options.restoreDelegation);
    const parentThreadId =
      persisted?.parentThreadId ??
      waiter?.question.parentThreadId ??
      options.fallbackParentThreadId;
    if (parentThreadId) removeFromQueue(parentThreadId, questionId);
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
    parentThreadId: ThreadId,
    questionId: AgentDelegationQuestionId,
    turn: ThreadTurn,
    agentId?: AgentId,
  ) => {
    const question = readThreadQuestionById(db, questionId);
    if (!question || question.status !== "pending") return;
    const outcome = buildParentTurnOutcomePatch(turn);
    if (!outcome.ok) {
      const resolvedAgentId =
        agentId ?? question.agentId ?? readAgentByPrimaryThreadId(db, parentThreadId)?.id;
      if (resolvedAgentId)
        markParentNeedsAttention(db, eventBus, resolvedAgentId, outcome.completedAt);
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
    sendThreadTurn,
    settlePendingQuestion,
    settleParentTurnQuestion,
  });

  const cancelPendingQuestion = (
    questionId: AgentDelegationQuestionId,
    error: string,
    options: {
      readonly restoreDelegation: boolean;
      readonly fallbackParentThreadId?: ThreadId;
      readonly pumpAfter?: boolean;
    },
  ): AgentDelegationQuestion | null => {
    const interruptedParent = interruptActiveParentTurnForQuestion(questionId);
    const settled = settlePendingQuestion(
      questionId,
      { status: "canceled", error, answeredAt: new Date().toISOString() },
      options,
    );
    const parentThreadId =
      settled?.parentThreadId ?? interruptedParent ?? options.fallbackParentThreadId;
    if (options.pumpAfter !== false && interruptedParent && parentThreadId && !disposed)
      triggerPump(parentThreadId);
    return settled;
  };

  const startQuestionTimer = (parentThreadId: ThreadId, questionId: AgentDelegationQuestionId) => {
    if (askParentTimeoutMs <= 0 || !Number.isFinite(askParentTimeoutMs)) return;
    clearQuestionTimer(questionId);
    const timer = setTimeout(() => {
      questionTimers.delete(questionId);
      cancelPendingQuestion(
        questionId,
        `Timed out after ${askParentTimeoutMs}ms waiting for parent thread.`,
        {
          restoreDelegation: true,
          fallbackParentThreadId: parentThreadId,
        },
      );
    }, askParentTimeoutMs);
    questionTimers.set(questionId, timer);
  };

  const resolveOwnedDelegation = Effect.fn("AgentService.resolveOwnedDelegation")(function* (
    delegationId: AgentDelegationId,
    agentId?: AgentId,
  ) {
    if (agentId) yield* requireAgent(agentId);
    const delegation = agentId
      ? readDelegationById(db, agentId, delegationId)
      : readDelegationByDelegationId(db, delegationId);
    if (!delegation) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Delegation "${delegationId}" was not found.`,
      });
    }
    return delegation;
  });

  const askWithDelegation = Effect.fn("AgentService.askWithDelegation")(function* (
    delegation: AgentDelegation,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) {
    const inputError = validateAskInput(input);
    if (inputError !== null)
      return yield* new AgentServiceError({ reason: "invalid", detail: inputError });
    if (delegation.status !== "running") {
      return yield* new AgentServiceError({
        reason: "rejected",
        detail:
          delegation.status === "waiting_parent"
            ? "Delegation already has a pending question awaiting the parent."
            : `Delegation is "${delegation.status}" and cannot ask parent.`,
      });
    }
    if (delegation.bounceCount >= delegation.maxBounces) {
      return yield* new AgentServiceError({
        reason: "rejected",
        detail: `Bounce limit reached (${delegation.bounceCount}/${delegation.maxBounces}). Stop retrying and report your findings and blockers cleanly.`,
      });
    }
    if (options?.signal?.aborted)
      return yield* new AgentServiceError({
        reason: "rejected",
        detail: "Request aborted before submitting question.",
      });

    const now = new Date().toISOString();
    const trimmedAttempted = input.attempted?.trim();
    const trimmedContext = input.context?.trim();
    const question: AgentDelegationQuestion = {
      id: AgentDelegationQuestionId.make(crypto.randomUUID()),
      delegationId: delegation.id,
      ...(delegation.agentId !== undefined ? { agentId: delegation.agentId } : {}),
      childThreadId: delegation.childThreadId,
      parentThreadId: delegation.parentThreadId,
      kind: input.kind ?? "other",
      question: input.question.trim(),
      ...(trimmedAttempted ? { attempted: trimmedAttempted } : {}),
      ...(trimmedContext ? { context: trimmedContext } : {}),
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
      insertThreadQuestion(db, question);
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
      const finish = (settled: AgentDelegationQuestion) => {
        if (detachWaiter()) resume(Effect.succeed(settled));
      };
      const onAbort = () => {
        if (detachWaiter())
          resume(Effect.succeed(readThreadQuestionById(db, question.id) ?? question));
      };
      waiters.set(question.id, { question, resolve: finish });
      const queue = queues.get(delegation.parentThreadId) ?? [];
      queue.push(question.id);
      queues.set(delegation.parentThreadId, queue);
      startQuestionTimer(delegation.parentThreadId, question.id);
      triggerPump(delegation.parentThreadId);
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

  const askParentByDelegation = Effect.fn("AgentService.askParentByDelegation")(function* (
    delegationId: AgentDelegationId,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) {
    return yield* askWithDelegation(yield* resolveOwnedDelegation(delegationId), input, options);
  });

  const askParent = Effect.fn("AgentService.askParent")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) {
    return yield* askWithDelegation(
      yield* resolveOwnedDelegation(delegationId, agentId),
      input,
      options,
    );
  });

  const listDelegationQuestionsById = Effect.fn("AgentService.listDelegationQuestionsById")(
    function* (delegationId: AgentDelegationId) {
      yield* resolveOwnedDelegation(delegationId);
      return listQuestionsByDelegationId(db, delegationId);
    },
  );

  const listQuestions = Effect.fn("AgentService.listDelegationQuestions")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) {
    yield* resolveOwnedDelegation(delegationId, agentId);
    return listQuestionsByDelegationId(db, delegationId);
  });

  const handlePrimaryOrParentTurnSettled = (turn: ThreadTurn): boolean => {
    const active = activeParentTurns.get(turn.id);
    if (active) {
      activeParentTurns.delete(turn.id);
      settleParentTurnQuestion(active.parentThreadId, active.questionId, turn, active.agentId);
      triggerPump(active.parentThreadId);
      return true;
    }
    if (queues.has(turn.threadId) || readAgentByPrimaryThreadId(db, turn.threadId) !== null)
      triggerPump(turn.threadId);
    return false;
  };

  const cancelForDelegation = (
    delegationId: AgentDelegationId,
    error: string,
    options?: { readonly restoreDelegation?: boolean },
  ) => {
    const pendingId =
      readPendingThreadQuestionForDelegation(db, delegationId)?.id ??
      Array.from(waiters.values()).find((w) => w.question.delegationId === delegationId)?.question
        .id;
    if (pendingId)
      cancelPendingQuestion(pendingId, error, {
        restoreDelegation: options?.restoreDelegation ?? false,
      });
  };

  const cancelPendingForAgent = (agentId: AgentId, reason: string) => {
    const questionIds = new Set<AgentDelegationQuestionId>();
    for (const entry of activeParentTurns.values())
      if (entry.agentId === agentId) questionIds.add(entry.questionId);
    for (const waiter of waiters.values())
      if (waiter.question.agentId === agentId) questionIds.add(waiter.question.id);
    for (const qid of listPendingQuestionIdsByAgent(db, agentId)) questionIds.add(qid);
    for (const questionId of questionIds)
      cancelPendingQuestion(questionId, reason, { restoreDelegation: false, pumpAfter: false });
  };

  const dispose = () => {
    disposed = true;
    for (const timer of questionTimers.values()) clearTimeout(timer);
    questionTimers.clear();
    const now = new Date().toISOString();
    for (const [questionId, waiter] of Array.from(waiters.entries())) {
      try {
        settlePendingQuestion(
          questionId,
          { status: "canceled", error: "Server shutting down.", answeredAt: now },
          { restoreDelegation: true, fallbackParentThreadId: waiter.question.parentThreadId },
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
    askParentByDelegation,
    listQuestions,
    listDelegationQuestionsById,
    handlePrimaryOrParentTurnSettled,
    cancelForDelegation,
    cancelPendingForAgent,
    dispose,
  };
};

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
  type TurnId,
} from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import { buildParentQuestionPrompt } from "./agentPrompts.ts";
import {
  insertQuestion,
  listQuestionsForDelegation,
  readPendingQuestionForDelegation,
  readQuestionById,
  updateQuestionRow,
} from "./agentQuestionStore.ts";
import { readAgentById, readAgentByPrimaryThreadId, updateAgentRow } from "./agentStore.ts";
import { readDelegationById, updateDelegationRow } from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";

export const DEFAULT_ASK_PARENT_TIMEOUT_MS = 300_000;

const hasRunningTurnOnThread = (db: Database, threadId: string): boolean =>
  db
    .query<{ readonly present: number }, [string]>(
      "SELECT 1 AS present FROM turns WHERE thread_id = ? AND status = 'running' LIMIT 1",
    )
    .get(threadId) !== null;

export const makeAgentBounceOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
  readonly sendAgentTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly askParentTimeoutMs?: number;
}) => {
  const {
    db,
    eventBus,
    requireAgent,
    sendAgentTurn,
    askParentTimeoutMs = DEFAULT_ASK_PARENT_TIMEOUT_MS,
  } = deps;

  const waiters = new Map<AgentDelegationQuestionId, (settled: AgentDelegationQuestion) => void>();
  const queues = new Map<AgentId, AgentDelegationQuestionId[]>();
  const activeParentTurns = new Map<
    TurnId,
    { readonly agentId: AgentId; readonly questionId: AgentDelegationQuestionId }
  >();
  const pumpingAgents = new Set<AgentId>();
  let disposed = false;

  const removeFromQueue = (agentId: AgentId, questionId: AgentDelegationQuestionId) => {
    const queue = queues.get(agentId);
    if (!queue) return;
    const idx = queue.indexOf(questionId);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) queues.delete(agentId);
  };

  const hasActiveParentTurnForAgent = (agentId: AgentId): boolean => {
    for (const entry of activeParentTurns.values()) {
      if (entry.agentId === agentId) return true;
    }
    return false;
  };

  const restoreDelegationIfWaiting = (agentId: AgentId, delegationId: AgentDelegationId) => {
    const delegation = readDelegationById(db, agentId, delegationId);
    if (!delegation || delegation.status !== "waiting_parent") return;
    const restored: AgentDelegation = { ...delegation, status: "running" };
    updateDelegationRow(db, restored);
    eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: restored });
  };

  const markParentNeedsAttention = (agentId: AgentId, updatedAt: string) => {
    const parent = readAgentById(db, agentId);
    if (!parent || parent.needsAttention) return;
    const nextParent: Agent = { ...parent, needsAttention: true, updatedAt };
    updateAgentRow(db, nextParent);
    eventBus.publishSync({ kind: "agent.upserted", agent: nextParent });
  };

  const settlePendingQuestion = (
    questionId: AgentDelegationQuestionId,
    patch: {
      readonly status: "answered" | "failed" | "canceled";
      readonly answer?: string;
      readonly error?: string;
      readonly answeredAt: string;
    },
    options: { readonly restoreDelegation: boolean },
  ): AgentDelegationQuestion | null => {
    const current = readQuestionById(db, questionId);
    if (!current) return null;
    if (current.status !== "pending") return current;

    removeFromQueue(current.agentId, current.id);
    const updated: AgentDelegationQuestion = {
      ...current,
      status: patch.status,
      ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      answeredAt: patch.answeredAt,
    };
    updateQuestionRow(db, updated);
    if (options.restoreDelegation) {
      restoreDelegationIfWaiting(current.agentId, current.delegationId);
    }
    eventBus.publishSync({ kind: "agent.delegation.question.upserted", question: updated });
    const resolveWaiter = waiters.get(updated.id);
    if (resolveWaiter) {
      waiters.delete(updated.id);
      resolveWaiter(updated);
    }
    return updated;
  };

  const failQueuedQuestions = (agentId: AgentId, detail: string) => {
    const queue = [...(queues.get(agentId) ?? [])];
    const now = new Date().toISOString();
    for (const qid of queue) {
      settlePendingQuestion(
        qid,
        { status: "failed", error: detail, answeredAt: now },
        { restoreDelegation: true },
      );
    }
  };

  const dispatchQueuedQuestion = async (
    agent: Agent,
    question: AgentDelegationQuestion,
  ): Promise<"dispatched" | "busy" | "failed"> => {
    const delegation = readDelegationById(db, agent.id, question.delegationId);
    const prompt = buildParentQuestionPrompt({ agent, delegation, question });
    const result = await Effect.runPromise(
      sendAgentTurn(agent.id, { prompt }, { origin: "system" }).pipe(Effect.result),
    );
    if (disposed) return "busy";

    if (result._tag === "Failure") {
      const detail = result.failure.message;
      if (detail.includes("already has a turn running")) return "busy";
      const now = new Date().toISOString();
      markParentNeedsAttention(agent.id, now);
      settlePendingQuestion(
        question.id,
        { status: "failed", error: detail, answeredAt: now },
        { restoreDelegation: true },
      );
      return "failed";
    }

    const turn = result.success;
    removeFromQueue(agent.id, question.id);
    activeParentTurns.set(turn.id, { agentId: agent.id, questionId: question.id });
    const refreshed = readQuestionById(db, question.id);
    if (refreshed && refreshed.status === "pending") {
      const linked: AgentDelegationQuestion = { ...refreshed, parentTurnId: turn.id };
      updateQuestionRow(db, linked);
      eventBus.publishSync({ kind: "agent.delegation.question.upserted", question: linked });
    }
    return "dispatched";
  };

  const pumpAgentQueue = async (agentId: AgentId): Promise<void> => {
    if (disposed || pumpingAgents.has(agentId) || hasActiveParentTurnForAgent(agentId)) return;
    pumpingAgents.add(agentId);
    let repump = false;
    try {
      while (!disposed && !hasActiveParentTurnForAgent(agentId)) {
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
        if (outcome !== "failed") break;
      }
    } finally {
      pumpingAgents.delete(agentId);
      const remaining = queues.get(agentId);
      const agent =
        !disposed && remaining && remaining.length > 0 ? readAgentById(db, agentId) : null;
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
        void pumpAgentQueue(agentId);
      });
    }
  };

  const askParent = Effect.fn("AgentService.askParent")(function* (
    agentId: AgentId,
    delegationId: AgentDelegationId,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) {
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
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (settledQuestion: AgentDelegationQuestion) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        options?.signal?.removeEventListener("abort", onAbort);
        waiters.delete(question.id);
        resume(Effect.succeed(settledQuestion));
      };

      const cancelNow = (reason: string) => {
        const result = settlePendingQuestion(
          question.id,
          { status: "canceled", error: reason, answeredAt: new Date().toISOString() },
          { restoreDelegation: true },
        );
        finish(
          result ?? {
            ...question,
            status: "canceled",
            error: reason,
            answeredAt: new Date().toISOString(),
          },
        );
      };

      const onAbort = () => cancelNow("Request aborted while waiting for parent Agent.");

      waiters.set(question.id, finish);
      const queue = queues.get(agent.id) ?? [];
      queue.push(question.id);
      queues.set(agent.id, queue);

      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      if (askParentTimeoutMs > 0 && Number.isFinite(askParentTimeoutMs)) {
        timer = setTimeout(() => {
          cancelNow(`Timed out after ${askParentTimeoutMs}ms waiting for parent Agent.`);
        }, askParentTimeoutMs);
      }

      void pumpAgentQueue(agent.id);

      return Effect.sync(() => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        options?.signal?.removeEventListener("abort", onAbort);
        waiters.delete(question.id);
        settlePendingQuestion(
          question.id,
          {
            status: "canceled",
            error: "Interrupted while waiting for parent Agent.",
            answeredAt: new Date().toISOString(),
          },
          { restoreDelegation: true },
        );
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

  const settleParentTurnQuestion = (
    agentId: AgentId,
    questionId: AgentDelegationQuestionId,
    turn: ThreadTurn,
  ) => {
    const question = readQuestionById(db, questionId);
    if (!question || question.status !== "pending") return;
    const completedAt = turn.completedAt ?? new Date().toISOString();
    const answer = turn.assistantMessage.trim();
    if (turn.status === "completed" && answer.length > 0) {
      settlePendingQuestion(
        question.id,
        { status: "answered", answer, answeredAt: completedAt },
        { restoreDelegation: true },
      );
      return;
    }
    const emptyReason =
      turn.status === "completed"
        ? "Parent agent returned an empty response."
        : `Parent turn ${turn.status}.`;
    const error = turn.error?.trim() || emptyReason;
    markParentNeedsAttention(agentId, completedAt);
    settlePendingQuestion(
      question.id,
      { status: "failed", error, answeredAt: completedAt },
      { restoreDelegation: true },
    );
  };

  const handlePrimaryOrParentTurnSettled = (turn: ThreadTurn): boolean => {
    const active = activeParentTurns.get(turn.id);
    if (active) {
      activeParentTurns.delete(turn.id);
      settleParentTurnQuestion(active.agentId, active.questionId, turn);
      void pumpAgentQueue(active.agentId);
      return true;
    }

    const primaryAgent = readAgentByPrimaryThreadId(db, turn.threadId);
    if (!primaryAgent) return false;
    void pumpAgentQueue(primaryAgent.id);
    return true;
  };

  const cancelForDelegation = (
    delegationId: AgentDelegationId,
    error: string,
    options?: { readonly restoreDelegation?: boolean },
  ) => {
    const pending = readPendingQuestionForDelegation(db, delegationId);
    if (!pending) return;
    settlePendingQuestion(
      pending.id,
      { status: "canceled", error, answeredAt: new Date().toISOString() },
      { restoreDelegation: options?.restoreDelegation ?? false },
    );
  };

  const dispose = () => {
    disposed = true;
    const now = new Date().toISOString();
    for (const [questionId, finish] of Array.from(waiters.entries())) {
      try {
        const settled = settlePendingQuestion(
          questionId,
          { status: "canceled", error: "Server shutting down.", answeredAt: now },
          { restoreDelegation: true },
        );
        if (settled) finish(settled);
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
    dispose,
  };
};

import type { Database } from "bun:sqlite";
import {
  resolveEffectiveModelTiers,
  resolveModelForRole,
  type Agent,
  type AgentDelegation,
  type AgentDelegationKind,
  type AgentDelegationQuestion,
  type AgentIssue,
  type AgentModelRole,
  type CreateThreadDelegationInput,
  type ModelSelection,
  type Project,
  type ProviderSnapshot,
  type SendTurnInput,
  type ThreadTurn,
  type TurnOrigin,
} from "@scuttle/contracts";
import type {
  AgentDelegationId,
  AgentDelegationQuestionId,
  AgentId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import { readScopedModelTierConfigs } from "../ModelTierService.ts";
import { readThreadById } from "../threadStore.ts";
import {
  hasRunningTurnOnThread,
  markParentNeedsAttention,
  type QuestionSettlementPatch,
  readSettledTurn,
} from "./agentBounceHelpers.ts";
import { readAgentById, readAgentByPrimaryThreadId, updateAgentRow } from "./agentStore.ts";
import {
  readDelegationByDelegationId,
  readIssueById,
  readThreadQuestionById,
  updateDelegationRow,
  updateIssueRow,
  updateThreadQuestionRow,
} from "./agentWorkStore.ts";
import type { AgentServiceError } from "./errors.ts";

export interface ActiveParentTurn {
  readonly parentThreadId: ThreadId;
  readonly agentId?: AgentId;
  readonly questionId: AgentDelegationQuestionId;
}

export const extractPrFromText = (
  text: string,
): { readonly url?: string; readonly number?: number } => {
  const match = /https:\/\/[^\s)>]+?\/(?:pull|merge_requests)\/(\d+)/.exec(text);
  if (match === null) return {};
  const num = Number.parseInt(match[1]!, 10);
  return { url: match[0], ...(Number.isFinite(num) ? { number: num } : {}) };
};

export const summarizeTurnOutput = (turn: ThreadTurn, fallbackStatus: string): string => {
  const text = turn.assistantMessage.trim();
  if (text.length > 0) return text.length <= 500 ? text : `${text.slice(0, 497)}...`;
  if (turn.error && turn.error.trim().length > 0) return turn.error.trim().slice(0, 500);
  return `Delegation ${fallbackStatus}.`;
};

export const settleChildDelegationOutcome = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  turn: ThreadTurn,
  delegation: AgentDelegation,
): void => {
  const latest = readDelegationByDelegationId(db, delegation.id) ?? delegation;
  const status =
    turn.status === "completed" ? "completed" : turn.status === "failed" ? "failed" : "canceled";
  const completedAt = turn.completedAt ?? new Date().toISOString();
  const resultSummary = summarizeTurnOutput(turn, status);
  const pr = extractPrFromText(turn.assistantMessage);
  const nextDelegation: AgentDelegation = {
    ...latest,
    status,
    resultSummary,
    completedAt,
    ...(pr.url ? { prUrl: pr.url } : latest.prUrl ? { prUrl: latest.prUrl } : {}),
  };
  updateDelegationRow(db, nextDelegation);
  eventBus.publishSync({ kind: "agent.delegation.upserted", delegation: nextDelegation });
  if (delegation.issueId && delegation.agentId) {
    const issue = readIssueById(db, delegation.agentId, delegation.issueId);
    if (issue) {
      const nextState =
        status === "completed" &&
        (issue.state === "backlog" || issue.state === "todo" || issue.state === "in_progress")
          ? "in_review"
          : issue.state;
      const nextIssue: AgentIssue = {
        ...issue,
        state: nextState,
        ...(pr.url ? { prUrl: pr.url } : {}),
        ...(pr.number !== undefined ? { prNumber: pr.number } : {}),
        updatedAt: completedAt,
      };
      updateIssueRow(db, nextIssue);
      eventBus.publishSync({ kind: "agent.issue.upserted", issue: nextIssue });
    }
  }
  if (delegation.agentId) {
    const parent = readAgentById(db, delegation.agentId);
    if (parent) {
      const nextAgent: Agent = {
        ...parent,
        lastSummary: `[${delegation.title}] ${resultSummary.slice(0, 200)}`,
        needsAttention: true,
        updatedAt: completedAt,
      };
      updateAgentRow(db, nextAgent);
      eventBus.publishSync({ kind: "agent.upserted", agent: nextAgent });
    }
  }
};

export const buildThreadDelegationBrief = (input: {
  readonly project: Project;
  readonly delegationId: AgentDelegationId;
  readonly maxBounces: number;
  readonly role: AgentModelRole;
  readonly kind: AgentDelegationKind;
  readonly title: string;
  readonly brief: string;
}): string =>
  [
    `You are a delegated **${input.role}** worker on project **${input.project.name}** (\`${input.project.path}\`).`,
    `Task (${input.kind}): ${input.title}`,
    `Delegation ID: ${input.delegationId}`,
    "",
    "## Brief",
    input.brief,
    ...(input.kind === "pr"
      ? [
          "",
          "## E2E PR Workflow",
          "1. Work cleanly in this branch/worktree, make focused edits, and run verification checks.",
          "2. Commit, push, and open a ready-for-review PR.",
        ]
      : []),
    ...(input.maxBounces > 0
      ? [
          "",
          "## Asking Your Parent Thread",
          `Ask your parent thread if blocked (budget ${input.maxBounces}): \`POST "$SCUTTLE_API_URL/api/delegations/$SCUTTLE_DELEGATION_ID/ask"\` with \`{"kind":"missing_context","question":"...","attempted":"...","context":"..."}\`. Poll \`GET "$SCUTTLE_API_URL/api/delegations/$SCUTTLE_DELEGATION_ID/questions"\` on disconnect.`,
        ]
      : []),
  ].join("\n");

export const resolveDelegationModelSelection = (input: {
  readonly db: Database;
  readonly snapshots: ReadonlyArray<ProviderSnapshot>;
  readonly fallback: ModelSelection;
  readonly projectId: Project["id"];
  readonly agent: Agent | null;
  readonly role: AgentModelRole;
  readonly explicitSelection?: ModelSelection;
  readonly providerId?: CreateThreadDelegationInput["providerId"];
  readonly model?: string;
  readonly effort?: CreateThreadDelegationInput["effort"];
}): ModelSelection | { readonly missingProviderId: string } => {
  if (input.explicitSelection) return input.explicitSelection;
  if (input.providerId || input.model) {
    const snap = input.providerId
      ? input.snapshots.find((s) => s.id === input.providerId)
      : (input.snapshots.find((s) => s.enabled && s.models.some((m) => m.slug === input.model)) ??
        input.snapshots.find((s) => s.id === input.fallback.providerId));
    if (input.providerId && !snap) return { missingProviderId: input.providerId };
    const target = snap ?? input.snapshots[0];
    const effort = input.effort ?? input.fallback.effort;
    return {
      providerId: target ? target.id : input.fallback.providerId,
      providerKind: target ? target.kind : input.fallback.providerKind,
      model: input.model ?? target?.defaultModel ?? target?.models[0]?.slug ?? input.fallback.model,
      ...(effort ? { effort } : {}),
    };
  }
  const tiers = resolveEffectiveModelTiers(readScopedModelTierConfigs(input.db), {
    projectId: input.projectId,
    ...(input.agent ? { agentId: input.agent.id } : {}),
  });
  const resolved =
    resolveModelForRole(tiers, input.role) ?? input.agent?.modelStack[input.role] ?? input.fallback;
  return input.effort ? { ...resolved, effort: input.effort } : resolved;
};

const formatParentQuestionPrompt = (
  delegation: AgentDelegation | null,
  question: AgentDelegationQuestion,
): string => {
  const header = delegation
    ? `Worker question from **${delegation.title}** (${delegation.role} / ${delegation.kind}, delegation \`${delegation.id}\`, bounce ${question.bounceNumber}/${delegation.maxBounces}):`
    : `Worker question (delegation \`${question.delegationId}\`, bounce ${question.bounceNumber}):`;
  const lines = [
    header,
    `Kind: \`${question.kind}\` (question \`${question.id}\`)`,
    "",
    "Question:",
    question.question,
  ];
  if (question.attempted) {
    lines.push("", "What the worker already attempted:", question.attempted);
  }
  if (question.context) {
    lines.push("", "Additional context:", question.context);
  }
  lines.push(
    "",
    "Reply directly in this message with the concrete answer, decision, or fix guidance, or tell the worker to stop cleanly. Do not call `POST .../cancel` from inside this reply turn; your response goes straight back to the waiting worker so it can resume.",
  );
  return lines.join("\n");
};

export const makeAgentBounceDispatcher = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly queues: Map<ThreadId, AgentDelegationQuestionId[]>;
  readonly activeParentTurns: Map<TurnId, ActiveParentTurn>;
  readonly isDisposed: () => boolean;
  readonly removeFromQueue: (
    parentThreadId: ThreadId,
    questionId: AgentDelegationQuestionId,
  ) => void;
  readonly interruptTurn: (threadId: ThreadId, turnId: TurnId) => void;
  readonly sendThreadTurn: (
    threadId: ThreadId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly settlePendingQuestion: (
    questionId: AgentDelegationQuestionId,
    patch: QuestionSettlementPatch,
    options: { readonly restoreDelegation: boolean; readonly fallbackParentThreadId?: ThreadId },
  ) => AgentDelegationQuestion | null;
  readonly settleParentTurnQuestion: (
    parentThreadId: ThreadId,
    questionId: AgentDelegationQuestionId,
    turn: ThreadTurn,
    agentId?: AgentId,
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
    sendThreadTurn,
    settlePendingQuestion,
    settleParentTurnQuestion,
  } = deps;
  const pumpingThreads = new Set<ThreadId>();

  const hasActiveParentTurnForThread = (parentThreadId: ThreadId): boolean => {
    for (const entry of activeParentTurns.values()) {
      if (entry.parentThreadId === parentThreadId) return true;
    }
    return false;
  };

  const failQueuedQuestions = (parentThreadId: ThreadId, detail: string) => {
    const queue = [...(queues.get(parentThreadId) ?? [])];
    const now = new Date().toISOString();
    for (const qid of queue) {
      settlePendingQuestion(
        qid,
        { status: "failed", error: detail, answeredAt: now },
        { restoreDelegation: true, fallbackParentThreadId: parentThreadId },
      );
    }
  };

  const dispatchQueuedQuestion = async (
    parentThreadId: ThreadId,
    question: AgentDelegationQuestion,
  ): Promise<"dispatched" | "busy" | "settled"> => {
    const delegation = readDelegationByDelegationId(db, question.delegationId);
    const prompt = formatParentQuestionPrompt(delegation, question);
    const result = await Effect.runPromise(
      sendThreadTurn(parentThreadId, { prompt }, { origin: "system" }).pipe(Effect.result),
    );
    if (isDisposed()) return "busy";

    const agentId =
      question.agentId ?? readAgentByPrimaryThreadId(db, parentThreadId)?.id ?? undefined;

    if (result._tag === "Failure") {
      const detail = result.failure.message;
      if (detail.includes("already has a turn running")) return "busy";
      const now = new Date().toISOString();
      if (agentId) markParentNeedsAttention(db, eventBus, agentId, now);
      settlePendingQuestion(
        question.id,
        { status: "failed", error: detail, answeredAt: now },
        { restoreDelegation: true, fallbackParentThreadId: parentThreadId },
      );
      return "settled";
    }

    const turn = result.success;
    removeFromQueue(parentThreadId, question.id);
    const refreshed = readThreadQuestionById(db, question.id);
    if (!refreshed || refreshed.status !== "pending") {
      interruptTurn(parentThreadId, turn.id);
      return "settled";
    }

    const settledTurn = readSettledTurn(db, parentThreadId, turn.id);
    if (settledTurn) {
      settleParentTurnQuestion(parentThreadId, question.id, settledTurn, agentId);
      return "settled";
    }

    activeParentTurns.set(turn.id, {
      parentThreadId,
      ...(agentId ? { agentId } : {}),
      questionId: question.id,
    });
    const linked: AgentDelegationQuestion = { ...refreshed, parentTurnId: turn.id };
    updateThreadQuestionRow(db, linked);
    eventBus.publishSync({ kind: "agent.delegation.question.upserted", question: linked });
    return "dispatched";
  };

  const pumpThreadQueue = async (parentThreadId: ThreadId): Promise<void> => {
    if (
      isDisposed() ||
      pumpingThreads.has(parentThreadId) ||
      hasActiveParentTurnForThread(parentThreadId)
    ) {
      return;
    }
    pumpingThreads.add(parentThreadId);
    let repump = false;
    try {
      while (!isDisposed() && !hasActiveParentTurnForThread(parentThreadId)) {
        const queue = queues.get(parentThreadId);
        if (!queue || queue.length === 0) break;

        const question = readThreadQuestionById(db, queue[0]!);
        if (!question || question.status !== "pending") {
          queue.shift();
          if (queue.length === 0) queues.delete(parentThreadId);
          continue;
        }

        const parentThread = readThreadById(db, parentThreadId);
        if (!parentThread) {
          failQueuedQuestions(parentThreadId, `Parent thread "${parentThreadId}" was not found.`);
          break;
        }
        if (hasRunningTurnOnThread(db, parentThreadId)) break;

        const outcome = await dispatchQueuedQuestion(parentThreadId, question);
        if (outcome !== "settled") break;
      }
    } finally {
      pumpingThreads.delete(parentThreadId);
      const remaining = queues.get(parentThreadId);
      const parentThread =
        !isDisposed() && remaining && remaining.length > 0
          ? readThreadById(db, parentThreadId)
          : null;
      if (
        parentThread &&
        !hasActiveParentTurnForThread(parentThreadId) &&
        !hasRunningTurnOnThread(db, parentThreadId)
      ) {
        repump = true;
      }
    }
    if (repump) {
      queueMicrotask(() => {
        triggerPump(parentThreadId);
      });
    }
  };

  const triggerPump = (parentThreadId: ThreadId) => {
    void pumpThreadQueue(parentThreadId).catch(() => undefined);
  };

  return { triggerPump };
};

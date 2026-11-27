import type { Database } from "bun:sqlite";
import type {
  PendingApproval,
  RespondApprovalInput,
  Thread,
  ThreadStatus,
  UserInputQuestion,
} from "@scuttle/contracts";
import { ApprovalId, type ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type { ApprovalDecision } from "../providers/types.ts";
import type * as EventBus from "./EventBus.ts";
import type { AskUserInput, AskUserResult } from "./threadServiceTypes.ts";
import { readApprovalById, readTurnStartedAt } from "./turnQueries.ts";
import type { ActiveRun, PendingApprovalResolver } from "./turnRunner.ts";
import { insertApprovalRow } from "./turnRunnerHelpers.ts";

export const isValidApprovalResponse = (response: RespondApprovalInput): boolean =>
  response.optionId !== undefined || response.answers !== undefined || response.dismissed === true;

export const resolvePendingApproval = (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly pendingApprovals: Map<string, PendingApprovalResolver>;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly threadId: ThreadId;
  readonly approvalId: ApprovalId;
  readonly response: RespondApprovalInput;
}): boolean => {
  const { db, eventBus, pendingApprovals, updateThreadStatus, threadId, approvalId, response } =
    input;
  if (!isValidApprovalResponse(response)) return false;
  const resolver = pendingApprovals.get(approvalId);
  if (!resolver || resolver.threadId !== threadId) return false;
  pendingApprovals.delete(approvalId);
  const selectedOptionId = response.optionId ?? (response.dismissed ? "__dismissed__" : null);
  const answersJson = response.answers ? JSON.stringify(response.answers) : null;
  const dismissedFlag = response.dismissed ? 1 : 0;
  db.query(
    "UPDATE approvals SET status = 'resolved', selected_option_id = ?, answers_json = ?, dismissed = ? WHERE id = ?",
  ).run(selectedOptionId, answersJson, dismissedFlag, approvalId);
  const approval = readApprovalById(db, approvalId);
  if (approval) eventBus.publishSync({ kind: "approval.updated", approval });
  const startedAt = readTurnStartedAt(db, resolver.turnId);
  if (startedAt !== null) {
    updateThreadStatus(threadId, { kind: "running", startedAt, phase: "working" });
  }
  resolver.resolve({
    optionId: response.optionId ?? "",
    ...(response.customText ? { customText: response.customText } : {}),
    ...(response.answers ? { answers: response.answers } : {}),
    ...(response.dismissed ? { dismissed: true } : {}),
  });
  return true;
};

const normalizeQuestions = (raw: AskUserInput["questions"]): ReadonlyArray<UserInputQuestion> => {
  const usedIds = new Set<string>();
  return raw.map((q, index) => {
    const baseId = q.id?.trim() || q.header?.trim() || `q${index + 1}`;
    const id = usedIds.has(baseId) ? `${baseId}_${index + 1}` : baseId;
    usedIds.add(id);
    const header = q.header?.trim();
    return {
      id,
      ...(header ? { header } : {}),
      question: q.question,
      options: q.options.map((opt) => ({
        id: opt.label,
        label: opt.label,
        ...(opt.description !== undefined && opt.description.length > 0
          ? { description: opt.description }
          : {}),
      })),
      ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
      allowCustom: q.allowCustom ?? true,
    };
  });
};

export const askUserOnThread = Effect.fn("threadApprovals.askUserOnThread")(function* (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly activeRuns: ReadonlyMap<string, ActiveRun>;
  readonly pendingApprovals: Map<string, PendingApprovalResolver>;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly isDisposed?: () => boolean;
  readonly threadId: ThreadId;
  readonly input: AskUserInput;
}) {
  const { db, eventBus, activeRuns, pendingApprovals, updateThreadStatus, threadId, input } = deps;
  if (input.questions.length === 0) {
    return yield* Effect.fail("At least one question is required.");
  }
  const active = activeRuns.get(threadId);
  const latestTurnId =
    active?.turnId ??
    db
      .query<{ readonly id: string }, [string]>(
        "SELECT id FROM turns WHERE thread_id = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(threadId)?.id;
  if (!latestTurnId) {
    return yield* Effect.fail("No turn found on thread to attach question.");
  }
  const turnId = TurnId.make(latestTurnId);
  const signal = active?.controller.signal;
  if (signal?.aborted) {
    return { answered: false, dismissed: true, answers: {} } satisfies AskUserResult;
  }

  const questions = normalizeQuestions(input.questions);
  const first = questions[0];
  const approvalId = ApprovalId.make(crypto.randomUUID());
  const approval: PendingApproval = {
    id: approvalId,
    threadId,
    turnId,
    kind: "question",
    title: input.title?.trim() || first?.header || "Agent has a question",
    ...(first?.question ? { description: first.question } : {}),
    options: first ? [...first.options] : [],
    questions,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  insertApprovalRow(db, approval);

  const dismissPendingRow = () => {
    if (deps.isDisposed?.()) return;
    const res = db
      .query(
        "UPDATE approvals SET status = 'resolved', selected_option_id = '__dismissed__', dismissed = 1 WHERE id = ? AND status = 'pending'",
      )
      .run(approvalId);
    if (res.changes > 0) {
      const updated = readApprovalById(db, approvalId);
      if (updated) eventBus.publishSync({ kind: "approval.updated", approval: updated });
    }
  };

  const decision = yield* Effect.promise(
    () =>
      new Promise<ApprovalDecision>((resolve) => {
        if (signal?.aborted) {
          dismissPendingRow();
          resolve({ optionId: "", dismissed: true });
          return;
        }
        let settled = false;
        const settle = (value: ApprovalDecision) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          pendingApprovals.delete(approvalId);
          if (value.dismissed) dismissPendingRow();
          resolve(value);
        };
        const onAbort = () => settle({ optionId: "", dismissed: true });
        pendingApprovals.set(approvalId, { threadId, turnId, resolve: settle });
        signal?.addEventListener("abort", onAbort, { once: true });
        eventBus.publishSync({ kind: "approval.updated", approval });
        updateThreadStatus(threadId, { kind: "needs-input", approvalId });
      }),
  );

  if (decision.dismissed) {
    return { answered: false, dismissed: true, answers: {} } satisfies AskUserResult;
  }
  const answers: Record<string, string | ReadonlyArray<string>> = {};
  if (decision.answers && Object.keys(decision.answers).length > 0) {
    for (const [k, v] of Object.entries(decision.answers)) {
      answers[k] = Array.isArray(v) ? [...v] : v;
    }
  } else if (first) {
    const fallback = decision.customText?.trim() || decision.optionId;
    if (fallback) answers[first.id] = fallback;
  }
  return { answered: true, dismissed: false, answers } satisfies AskUserResult;
});

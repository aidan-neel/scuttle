import type { Database } from "bun:sqlite";
import type {
  ProviderConfig,
  RespondApprovalInput,
  Thread,
  ThreadAttachment,
  ThreadStatus,
  ThreadTurn,
  TurnOrigin,
} from "@scuttle/contracts";
import { type ApprovalId, type ThreadId, TurnId } from "@scuttle/shared/ids";
import { wrapPromptForThread } from "./agent/agentContext.ts";
import type * as EventBus from "./EventBus.ts";
import {
  formatPromptWithAttachments,
  insertTurnRow,
  readThreadById,
  readTurnsForThread,
} from "./threadStore.ts";
import {
  launchTurnExecution,
  type PendingApprovalResolver,
  type TurnRunnerDeps,
} from "./turnRunner.ts";

export const dispatchThreadTurn = (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly runnerDeps: TurnRunnerDeps;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly thread: Thread;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<ThreadAttachment> | undefined;
  readonly origin: TurnOrigin;
  readonly providerConfig: ProviderConfig;
  readonly apiBaseUrl: string;
}): ThreadTurn => {
  const {
    db,
    eventBus,
    runnerDeps,
    updateThreadStatus,
    thread,
    prompt,
    attachments,
    origin,
    providerConfig,
    apiBaseUrl,
  } = input;

  const seqRow = db
    .query<{ next_seq: number }, [string]>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM turns WHERE thread_id = ?",
    )
    .get(thread.id);
  const seq = seqRow?.next_seq ?? 1;
  const turnId = TurnId.make(crypto.randomUUID());
  const startedAt = new Date().toISOString();
  const sessionEpoch = thread.sessionEpoch ?? 0;

  const turn: ThreadTurn = {
    id: turnId,
    threadId: thread.id,
    ...(origin === "system" ? { origin } : {}),
    sessionEpoch,
    userMessage: prompt,
    assistantMessage: "",
    thinkingText: "",
    status: "running",
    startedAt,
    modelSelection: thread.modelSelection,
    activities: [],
    approvals: [],
  };

  insertTurnRow(db, seq, turn);
  updateThreadStatus(thread.id, { kind: "running", startedAt, phase: "thinking" });
  eventBus.publishSync({ kind: "turn.upserted", turn });

  const refreshed = readThreadById(db, thread.id) ?? thread;
  const wrapped = wrapPromptForThread({ db, thread: refreshed, userPrompt: prompt, apiBaseUrl });
  const fullPrompt = formatPromptWithAttachments(wrapped.prompt, attachments);
  const freshSessionPrompt = wrapped.freshSessionPrompt
    ? formatPromptWithAttachments(wrapped.freshSessionPrompt, attachments)
    : undefined;
  const extraEnv: Record<string, string> = {
    SCUTTLE_API_URL: apiBaseUrl,
    ...(wrapped.agentId ? { SCUTTLE_AGENT_ID: wrapped.agentId } : {}),
    ...(wrapped.delegationId ? { SCUTTLE_DELEGATION_ID: wrapped.delegationId } : {}),
  };
  launchTurnExecution(runnerDeps, refreshed, turn, fullPrompt, providerConfig, extraEnv, {
    ...(freshSessionPrompt !== undefined ? { freshSessionPrompt } : {}),
    ...(wrapped.agentId !== undefined ? { agentId: wrapped.agentId } : {}),
    ...(wrapped.pendingContextHash !== undefined
      ? { pendingContextHash: wrapped.pendingContextHash }
      : {}),
    pendingNotifiedDelegationIds: wrapped.pendingNotifiedDelegationIds,
    pendingAccessedMemoryIds: wrapped.pendingAccessedMemoryIds,
  });
  return turn;
};

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
  const resolver = pendingApprovals.get(approvalId);
  if (!resolver || resolver.threadId !== threadId) {
    return false;
  }
  pendingApprovals.delete(approvalId);
  db.prepare("UPDATE approvals SET status = 'resolved', selected_option_id = ? WHERE id = ?").run(
    response.optionId,
    approvalId,
  );
  const thread = readThreadById(db, threadId);
  if (thread) {
    const turns = readTurnsForThread(db, thread);
    const turn = turns.find((t) => t.id === resolver.turnId);
    const approval = turn?.approvals.find((a) => a.id === approvalId);
    if (approval) {
      eventBus.publishSync({ kind: "approval.updated", approval });
    }
    if (turn) {
      updateThreadStatus(threadId, {
        kind: "running",
        startedAt: turn.startedAt,
        phase: "working",
      });
    }
  }
  resolver.resolve({
    optionId: response.optionId,
    ...(response.customText ? { customText: response.customText } : {}),
  });
  return true;
};

import type { Database } from "bun:sqlite";
import type {
  ActivityItem,
  ModelPerfRun,
  PendingApproval,
  ProviderConfig,
  RecordMeasuredRunInput,
  Thread,
  ThreadAttachment,
  ThreadStatus,
  ThreadTurn,
  TurnStatus,
  TurnUsage,
} from "@scuttle/contracts";
import { ActivityId, ApprovalId, type ThreadId, type TurnId } from "@scuttle/shared/ids";
import { getHarnessAdapter } from "../providers/registry.ts";
import type {
  ApprovalDecision,
  HarnessEvent,
  ResolvedAttachment,
  SteerHandler,
} from "../providers/types.ts";
import type * as CheckpointService from "./CheckpointService.ts";
import type * as EventBus from "./EventBus.ts";
import { commitTurnContextEffects } from "./agent/agentContext.ts";
import { LiveTurnBuffer } from "./liveTurnBuffer.ts";
import { capturePostTurnCheckpoint, ensureBaselineCheckpoint } from "./threadCheckpointStore.ts";
import { readThreadById, readTurnById, updateTurnOutcomeRow } from "./threadStore.ts";
import { readTurnChildren } from "./turnQueries.ts";
import {
  emitMeasuredTurnPerformance,
  finishActivityRow,
  insertActivityRow,
  insertApprovalRow,
  refreshThreadTitleOnSettle,
  updateActivityRow,
} from "./turnRunnerHelpers.ts";

export interface ActiveRun {
  readonly turnId: TurnId;
  readonly controller: AbortController;
  steerHandler?: SteerHandler;
  readonly steerPrompts: string[];
}

export interface PendingApprovalResolver {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly resolve: (decision: ApprovalDecision) => void;
}

export interface TurnRunnerDeps {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly activeRuns: Map<string, ActiveRun>;
  readonly pendingApprovals: Map<string, PendingApprovalResolver>;
  readonly liveTurnBuffer?: LiveTurnBuffer;
  readonly checkpointService?: CheckpointService.CheckpointService["Service"];
  readonly recordPerformance?: (input: RecordMeasuredRunInput) => Promise<ModelPerfRun | null>;
  readonly onTurnSettled?: (threadId: ThreadId, status: TurnStatus) => void;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly onProjectActivity: (thread: Thread, summary: string) => void;
  readonly isDisposed?: () => boolean;
}

export interface TurnLaunchOptions {
  readonly freshSessionPrompt?: string;
  readonly attachments?: ReadonlyArray<ThreadAttachment>;
  readonly resolvedAttachments?: ReadonlyArray<ResolvedAttachment>;
  readonly mcpServer?: {
    readonly url: string;
    readonly authorizationHeader: string;
    readonly threadId: string;
  };
  readonly agentId?: string;
  readonly pendingContextHash?: string;
  readonly pendingNotifiedDelegationIds?: ReadonlyArray<string>;
  readonly pendingAccessedMemoryIds?: ReadonlyArray<string>;
}

export const launchTurnExecution = (
  deps: TurnRunnerDeps,
  thread: Thread,
  turn: ThreadTurn,
  fullPrompt: string,
  providerConfig: ProviderConfig,
  extraEnv?: Readonly<Record<string, string>>,
  launchOptions?: TurnLaunchOptions,
): void => {
  const {
    db,
    eventBus,
    activeRuns,
    pendingApprovals,
    updateThreadStatus,
    onProjectActivity,
    isDisposed,
  } = deps;
  const isClosed = () => isDisposed?.() === true;
  const liveTurnBuffer = deps.liveTurnBuffer ?? new LiveTurnBuffer(db);
  const turnEpoch = turn.sessionEpoch ?? thread.sessionEpoch ?? 0;
  const controller = new AbortController();
  const activeRun: ActiveRun = { turnId: turn.id, controller, steerPrompts: [] };
  activeRuns.set(thread.id, activeRun);

  const startedMs = Date.parse(turn.startedAt);
  let assistantText = "";
  let thinkingText = "";
  let activitySeq = 0;
  const activitiesByKey = new Map<string, ActivityItem>();
  let thinkingActivityKey: string | null = null;
  let currentPhase: "thinking" | "working" = "thinking";
  let latestUsage: TurnUsage | undefined;
  let firstTokenMs: number | undefined;

  const closeThinkingIfOpen = () => {
    if (!thinkingActivityKey) return;
    const item = activitiesByKey.get(thinkingActivityKey);
    thinkingActivityKey = null;
    if (!item || item.status !== "running") return;
    const now = new Date().toISOString();
    const updated: ActivityItem = {
      ...item,
      status: "completed",
      completedAt: now,
      durationMs: Math.max(0, Date.parse(now) - Date.parse(item.startedAt)),
    };
    activitiesByKey.set(item.id, updated);
    finishActivityRow(db, updated);
    eventBus.publishSync({ kind: "turn.activity", activity: updated });
  };

  const ensureThinkingActivity = () => {
    if (thinkingActivityKey) return;
    const id = ActivityId.make(crypto.randomUUID());
    activitySeq += 1;
    const item: ActivityItem = {
      id,
      turnId: turn.id,
      threadId: thread.id,
      kind: "thinking",
      label: "Thought",
      activeLabel: "Thinking",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    thinkingActivityKey = id;
    activitiesByKey.set(id, item);
    insertActivityRow(db, activitySeq, item);
    eventBus.publishSync({ kind: "turn.activity", activity: item });
  };

  const handleEvent = (event: HarnessEvent) => {
    if (isClosed()) return;
    switch (event.kind) {
      case "session": {
        const res = db
          .query(
            "UPDATE threads SET provider_session_id = ?, updated_at = ? WHERE id = ? AND session_epoch = ?",
          )
          .run(event.providerSessionId, new Date().toISOString(), thread.id, turnEpoch);
        if (res.changes > 0) {
          const refreshed = readThreadById(db, thread.id);
          if (refreshed) eventBus.publishSync({ kind: "thread.upserted", thread: refreshed });
        }
        return;
      }
      case "thinking.delta": {
        if (firstTokenMs === undefined) firstTokenMs = Math.max(0, Date.now() - startedMs);
        ensureThinkingActivity();
        const offset = thinkingText.length;
        thinkingText += event.text;
        liveTurnBuffer.update(turn.id, assistantText, thinkingText);
        eventBus.publishSync({
          kind: "turn.delta",
          threadId: thread.id,
          turnId: turn.id,
          channel: "thinking",
          delta: event.text,
          offset,
        });
        return;
      }
      case "assistant.delta": {
        if (firstTokenMs === undefined) firstTokenMs = Math.max(0, Date.now() - startedMs);
        closeThinkingIfOpen();
        const offset = assistantText.length;
        assistantText += event.text;
        liveTurnBuffer.update(turn.id, assistantText, thinkingText);
        eventBus.publishSync({
          kind: "turn.delta",
          threadId: thread.id,
          turnId: turn.id,
          channel: "assistant",
          delta: event.text,
          offset,
        });
        return;
      }
      case "assistant.replace": {
        closeThinkingIfOpen();
        assistantText = event.text;
        liveTurnBuffer.update(turn.id, assistantText, thinkingText);
        liveTurnBuffer.flush(turn.id);
        const refreshed = readThreadById(db, thread.id);
        if (refreshed) {
          const currentTurn = readTurnById(db, turn.id, refreshed.modelSelection);
          if (currentTurn) eventBus.publishSync({ kind: "turn.upserted", turn: currentTurn });
        }
        return;
      }
      case "activity.started": {
        closeThinkingIfOpen();
        if (currentPhase !== "working") {
          currentPhase = "working";
          updateThreadStatus(thread.id, {
            kind: "running",
            startedAt: turn.startedAt,
            phase: "working",
          });
        }
        if (activitiesByKey.has(event.key)) return;
        const id = ActivityId.make(crypto.randomUUID());
        activitySeq += 1;
        const item: ActivityItem = {
          id,
          turnId: turn.id,
          threadId: thread.id,
          kind: event.activityKind,
          label: event.label,
          activeLabel: event.activeLabel,
          ...(event.detail ? { detail: event.detail } : {}),
          status: "running",
          startedAt: new Date().toISOString(),
        };
        activitiesByKey.set(event.key, item);
        insertActivityRow(db, activitySeq, item);
        eventBus.publishSync({ kind: "turn.activity", activity: item });
        return;
      }
      case "activity.updated": {
        const item = activitiesByKey.get(event.key);
        if (!item) return;
        const now = new Date().toISOString();
        const finished = event.status === "completed" || event.status === "failed";
        const durationMs = finished
          ? Math.max(0, Date.parse(now) - Date.parse(item.startedAt))
          : item.durationMs;
        const updated: ActivityItem = {
          ...item,
          status: event.status,
          label: event.label ?? item.label,
          activeLabel: event.activeLabel ?? item.activeLabel,
          ...(event.detail !== undefined
            ? { detail: event.detail }
            : item.detail
              ? { detail: item.detail }
              : {}),
          ...(finished ? { completedAt: now } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
        activitiesByKey.set(event.key, updated);
        updateActivityRow(db, updated);
        eventBus.publishSync({ kind: "turn.activity", activity: updated });
        return;
      }
      case "approval.requested": {
        const approvalId = ApprovalId.make(crypto.randomUUID());
        const approval: PendingApproval = {
          id: approvalId,
          threadId: thread.id,
          turnId: turn.id,
          kind: event.approvalKind,
          title: event.title,
          ...(event.description ? { description: event.description } : {}),
          ...(event.command ? { command: event.command } : {}),
          options: [...event.options],
          ...(event.questions ? { questions: [...event.questions] } : {}),
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        insertApprovalRow(db, approval);
        pendingApprovals.set(approvalId, {
          threadId: thread.id,
          turnId: turn.id,
          resolve: event.resolve,
        });
        eventBus.publishSync({ kind: "approval.updated", approval });
        updateThreadStatus(thread.id, { kind: "needs-input", approvalId });
        return;
      }
      case "usage": {
        latestUsage = event.usage;
        const encoded = JSON.stringify(event.usage);
        liveTurnBuffer.flush(turn.id);
        db.query("UPDATE turns SET usage_json = ? WHERE id = ?").run(encoded, turn.id);
        db.query(
          "UPDATE threads SET last_usage_json = ?, updated_at = ? WHERE id = ? AND session_epoch = ?",
        ).run(encoded, new Date().toISOString(), thread.id, turnEpoch);
        const refreshed = readThreadById(db, thread.id);
        if (refreshed) {
          eventBus.publishSync({ kind: "thread.upserted", thread: refreshed });
          const currentTurn = readTurnById(db, turn.id, refreshed.modelSelection);
          if (currentTurn) eventBus.publishSync({ kind: "turn.upserted", turn: currentTurn });
        }
        return;
      }
    }
  };

  const closeRunningActivities = (completedAt: string, finalStatus: "completed" | "failed") => {
    for (const [key, item] of activitiesByKey.entries()) {
      if (item.status !== "running") continue;
      const doneItem: ActivityItem = {
        ...item,
        status: finalStatus,
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(item.startedAt)),
      };
      activitiesByKey.set(key, doneItem);
      finishActivityRow(db, doneItem);
      eventBus.publishSync({ kind: "turn.activity", activity: doneItem });
    }
  };

  const releaseRun = () => {
    if (activeRuns.get(thread.id)?.turnId === turn.id) activeRuns.delete(thread.id);
    for (const [approvalId, entry] of pendingApprovals.entries()) {
      if (entry.turnId === turn.id) pendingApprovals.delete(approvalId);
    }
  };

  const settleTurn = async (outcome: {
    readonly status: TurnStatus;
    readonly finalMessage: string;
    readonly costUsd?: number;
    readonly usage?: TurnUsage;
    readonly firstTokenMs?: number;
    readonly errorMessage?: string;
    readonly commitEffects: boolean;
  }) => {
    if (isClosed()) return;
    closeThinkingIfOpen();
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - startedMs);
    closeRunningActivities(completedAt, outcome.status === "failed" ? "failed" : "completed");
    const { activities, approvals } = readTurnChildren(db, turn.id);
    const settledTurn: ThreadTurn = {
      ...turn,
      assistantMessage: outcome.finalMessage,
      thinkingText,
      status: outcome.status,
      completedAt,
      durationMs,
      ...(outcome.costUsd !== undefined && outcome.costUsd > 0 ? { costUsd: outcome.costUsd } : {}),
      ...(outcome.usage ? { usage: outcome.usage } : {}),
      ...(outcome.errorMessage !== undefined ? { error: outcome.errorMessage } : {}),
      activities,
      approvals,
    };
    updateTurnOutcomeRow(db, thread.id, turnEpoch, settledTurn);
    liveTurnBuffer.delete(turn.id);
    if (outcome.commitEffects) {
      commitTurnContextEffects({
        db,
        eventBus,
        threadId: thread.id,
        sessionEpoch: turnEpoch,
        completedAt,
        ...(launchOptions?.agentId !== undefined ? { agentId: launchOptions.agentId } : {}),
        ...(launchOptions?.pendingContextHash !== undefined
          ? { pendingContextHash: launchOptions.pendingContextHash }
          : {}),
        ...(launchOptions?.pendingNotifiedDelegationIds !== undefined
          ? { pendingNotifiedDelegationIds: launchOptions.pendingNotifiedDelegationIds }
          : {}),
        ...(launchOptions?.pendingAccessedMemoryIds !== undefined
          ? { pendingAccessedMemoryIds: launchOptions.pendingAccessedMemoryIds }
          : {}),
      });
      refreshThreadTitleOnSettle(db, eventBus, thread.id);
      if (deps.checkpointService) {
        await capturePostTurnCheckpoint({
          db,
          eventBus,
          checkpointService: deps.checkpointService,
          thread,
          turnId: turn.id,
        });
      }
    }
    const ttft = outcome.firstTokenMs ?? firstTokenMs;
    await emitMeasuredTurnPerformance({
      ...(deps.recordPerformance ? { recordPerformance: deps.recordPerformance } : {}),
      eventBus,
      isClosed,
      thread,
      turnId: turn.id,
      durationMs,
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
      ...(ttft !== undefined ? { firstTokenMs: ttft } : {}),
    });
    releaseRun();
    updateThreadStatus(
      thread.id,
      outcome.status === "failed"
        ? { kind: "error", message: outcome.errorMessage ?? "Turn failed" }
        : { kind: "idle" },
    );
    eventBus.publishSync({ kind: "turn.upserted", turn: settledTurn });
    if (outcome.status !== "failed") {
      if (outcome.status === "completed") {
        onProjectActivity(thread, outcome.finalMessage.trim() || turn.userMessage);
      }
      deps.onTurnSettled?.(thread.id, outcome.status);
    }
  };

  const adapter = getHarnessAdapter(thread.modelSelection.providerKind);
  void Promise.resolve()
    .then(async () => {
      if (deps.checkpointService && !controller.signal.aborted && !isClosed()) {
        await ensureBaselineCheckpoint({
          db,
          eventBus,
          checkpointService: deps.checkpointService,
          thread,
        });
      }
      if (controller.signal.aborted) return { interrupted: true };
      return adapter.runTurn({
        config: providerConfig,
        cwd: thread.cwd,
        prompt: fullPrompt,
        ...(launchOptions?.freshSessionPrompt
          ? { freshSessionPrompt: launchOptions.freshSessionPrompt }
          : {}),
        model: thread.modelSelection.model,
        ...(thread.modelSelection.effort ? { effort: thread.modelSelection.effort } : {}),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        ...(thread.providerSessionId ? { providerSessionId: thread.providerSessionId } : {}),
        ...(launchOptions?.attachments ? { attachments: launchOptions.attachments } : {}),
        ...(launchOptions?.resolvedAttachments
          ? { resolvedAttachments: launchOptions.resolvedAttachments }
          : {}),
        ...(launchOptions?.mcpServer ? { mcpServer: launchOptions.mcpServer } : {}),
        ...(extraEnv ? { extraEnv } : {}),
        registerSteer: (handler) => {
          if (activeRuns.get(thread.id)?.turnId === turn.id) activeRun.steerHandler = handler;
        },
        signal: controller.signal,
        emit: handleEvent,
      });
    })
    .then((result) => {
      const isInterrupted = Boolean(result.interrupted || controller.signal.aborted);
      const settledUsage = result.usage ?? latestUsage;
      return settleTurn({
        status: isInterrupted ? "interrupted" : "completed",
        finalMessage:
          assistantText.length > 0 ? assistantText : (result.finalText ?? assistantText),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        ...(settledUsage !== undefined ? { usage: settledUsage } : {}),
        ...(result.firstTokenMs !== undefined ? { firstTokenMs: result.firstTokenMs } : {}),
        commitEffects: !isInterrupted,
      });
    })
    .catch((error: unknown) => {
      const isAborted = controller.signal.aborted;
      return settleTurn({
        status: isAborted ? "interrupted" : "failed",
        finalMessage: assistantText,
        ...(latestUsage ? { usage: latestUsage } : {}),
        ...(isAborted
          ? {}
          : { errorMessage: error instanceof Error ? error.message : String(error) }),
        commitEffects: false,
      });
    })
    .finally(() => {
      releaseRun();
      liveTurnBuffer.delete(turn.id);
    });
};

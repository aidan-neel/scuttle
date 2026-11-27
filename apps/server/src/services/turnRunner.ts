import type { Database } from "bun:sqlite";
import type {
  ActivityItem,
  PendingApproval,
  ProviderConfig,
  Thread,
  ThreadStatus,
  ThreadTurn,
  TurnUsage,
} from "@scuttle/contracts";
import { ActivityId, ApprovalId, type ThreadId, type TurnId } from "@scuttle/shared/ids";
import { getHarnessAdapter } from "../providers/registry.ts";
import type { ApprovalDecision, HarnessEvent } from "../providers/types.ts";
import type * as EventBus from "./EventBus.ts";
import { commitTurnContextEffects } from "./agent/agentContext.ts";
import { readAgentByPrimaryThreadId } from "./agent/agentStore.ts";
import { LiveTurnBuffer } from "./liveTurnBuffer.ts";
import { readThreadById, updateTurnOutcomeRow } from "./threadStore.ts";
import { deriveThreadTitle, shouldRefreshThreadTitle } from "./threadTitle.ts";
import {
  readCompletedTurnCount,
  readRecentCompletedTitleTurns,
  readTurnById,
  readTurnChildren,
} from "./turnQueries.ts";

export interface ActiveRun {
  readonly turnId: TurnId;
  readonly controller: AbortController;
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
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly onProjectActivity: (thread: Thread, summary: string) => void;
  readonly isDisposed?: () => boolean;
}

export interface TurnLaunchOptions {
  readonly freshSessionPrompt?: string;
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
  activeRuns.set(thread.id, { turnId: turn.id, controller });

  const startedMs = Date.parse(turn.startedAt);
  let assistantText = "";
  let thinkingText = "";
  let activitySeq = 0;
  const activitiesByKey = new Map<string, ActivityItem>();
  let thinkingActivityKey: string | null = null;
  let currentPhase: "thinking" | "working" = "thinking";
  let latestUsage: TurnUsage | undefined;

  const insertActivityRow = (seq: number, item: ActivityItem) => {
    db.query(
      `INSERT INTO activities
         (id, turn_id, thread_id, seq, kind, label, active_label, detail, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      item.id,
      item.turnId,
      item.threadId,
      seq,
      item.kind,
      item.label,
      item.activeLabel,
      item.detail ?? null,
      item.status,
      item.startedAt,
    );
  };

  const finishActivityRow = (item: ActivityItem) => {
    db.query(
      "UPDATE activities SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
    ).run(item.status, item.completedAt ?? null, item.durationMs ?? 0, item.id);
  };

  const closeThinkingIfOpen = () => {
    if (!thinkingActivityKey) return;
    const item = activitiesByKey.get(thinkingActivityKey);
    thinkingActivityKey = null;
    if (!item || item.status !== "running") return;
    const now = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(now) - Date.parse(item.startedAt));
    const updated: ActivityItem = {
      ...item,
      status: "completed",
      completedAt: now,
      durationMs,
    };
    activitiesByKey.set(item.id, updated);
    finishActivityRow(updated);
    eventBus.publishSync({ kind: "turn.activity", activity: updated });
  };

  const ensureThinkingActivity = () => {
    if (thinkingActivityKey) return;
    const id = ActivityId.make(crypto.randomUUID());
    const now = new Date().toISOString();
    activitySeq += 1;
    const item: ActivityItem = {
      id,
      turnId: turn.id,
      threadId: thread.id,
      kind: "thinking",
      label: "Thought",
      activeLabel: "Thinking",
      status: "running",
      startedAt: now,
    };
    thinkingActivityKey = id;
    activitiesByKey.set(id, item);
    insertActivityRow(activitySeq, item);
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
        const now = new Date().toISOString();
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
          startedAt: now,
        };
        activitiesByKey.set(event.key, item);
        insertActivityRow(activitySeq, item);
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
        db.query(
          `UPDATE activities
           SET status = ?, label = ?, active_label = ?, detail = ?, completed_at = ?, duration_ms = ?
           WHERE id = ?`,
        ).run(
          updated.status,
          updated.label,
          updated.activeLabel,
          updated.detail ?? null,
          updated.completedAt ?? null,
          updated.durationMs ?? null,
          updated.id,
        );
        eventBus.publishSync({ kind: "turn.activity", activity: updated });
        return;
      }
      case "approval.requested": {
        const approvalId = ApprovalId.make(crypto.randomUUID());
        const now = new Date().toISOString();
        const approval: PendingApproval = {
          id: approvalId,
          threadId: thread.id,
          turnId: turn.id,
          kind: event.approvalKind,
          title: event.title,
          ...(event.description ? { description: event.description } : {}),
          ...(event.command ? { command: event.command } : {}),
          options: [...event.options],
          status: "pending",
          createdAt: now,
        };
        db.query(
          `INSERT INTO approvals
             (id, thread_id, turn_id, kind, title, description, command, options_json, status, selected_option_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        ).run(
          approvalId,
          thread.id,
          turn.id,
          approval.kind,
          approval.title,
          approval.description ?? null,
          approval.command ?? null,
          JSON.stringify(approval.options),
          approval.status,
          now,
        );
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
        const now = new Date().toISOString();
        liveTurnBuffer.flush(turn.id);
        db.query("UPDATE turns SET usage_json = ? WHERE id = ?").run(encoded, turn.id);
        db.query(
          "UPDATE threads SET last_usage_json = ?, updated_at = ? WHERE id = ? AND session_epoch = ?",
        ).run(encoded, now, thread.id, turnEpoch);
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
      finishActivityRow(doneItem);
      eventBus.publishSync({ kind: "turn.activity", activity: doneItem });
    }
  };

  const refreshThreadTitle = () => {
    try {
      if (readAgentByPrimaryThreadId(db, thread.id) !== null) return;
      const completedCount = readCompletedTurnCount(db, thread.id);
      if (!shouldRefreshThreadTitle(completedCount)) return;
      const current = readThreadById(db, thread.id);
      if (!current) return;
      const recentTurns = readRecentCompletedTitleTurns(db, thread.id, 3);
      const nextTitle = deriveThreadTitle(recentTurns);
      if (nextTitle.length === 0 || nextTitle === current.title) return;
      db.query("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?").run(
        nextTitle,
        new Date().toISOString(),
        thread.id,
      );
      const refreshed = readThreadById(db, thread.id);
      if (refreshed) eventBus.publishSync({ kind: "thread.upserted", thread: refreshed });
    } catch {
      return;
    }
  };

  const releaseRun = () => {
    if (activeRuns.get(thread.id)?.turnId === turn.id) {
      activeRuns.delete(thread.id);
    }
    for (const [approvalId, entry] of pendingApprovals.entries()) {
      if (entry.turnId === turn.id) {
        pendingApprovals.delete(approvalId);
      }
    }
  };

  const adapter = getHarnessAdapter(thread.modelSelection.providerKind);
  void Promise.resolve()
    .then(() =>
      adapter.runTurn({
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
        ...(extraEnv ? { extraEnv } : {}),
        signal: controller.signal,
        emit: handleEvent,
      }),
    )
    .then((result) => {
      if (isClosed()) return;
      closeThinkingIfOpen();
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.parse(completedAt) - startedMs);
      closeRunningActivities(completedAt, "completed");
      const finalMessage =
        assistantText.length > 0 ? assistantText : (result.finalText ?? assistantText);
      const { activities, approvals } = readTurnChildren(db, turn.id);
      const finalUsage = result.usage ?? latestUsage;
      const finalTurn: ThreadTurn = {
        ...turn,
        assistantMessage: finalMessage,
        thinkingText,
        status: result.interrupted ? "interrupted" : "completed",
        completedAt,
        durationMs,
        ...(result.costUsd !== undefined && result.costUsd > 0 ? { costUsd: result.costUsd } : {}),
        ...(finalUsage ? { usage: finalUsage } : {}),
        activities,
        approvals,
      };
      updateTurnOutcomeRow(db, thread.id, turnEpoch, finalTurn);
      liveTurnBuffer.delete(turn.id);
      if (!result.interrupted) {
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
        refreshThreadTitle();
      }
      releaseRun();
      updateThreadStatus(thread.id, { kind: "idle" });
      eventBus.publishSync({ kind: "turn.upserted", turn: finalTurn });
      onProjectActivity(thread, finalMessage.trim() || turn.userMessage);
    })
    .catch((error: unknown) => {
      if (isClosed()) return;
      closeThinkingIfOpen();
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.parse(completedAt) - startedMs);
      closeRunningActivities(completedAt, controller.signal.aborted ? "completed" : "failed");
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { activities, approvals } = readTurnChildren(db, turn.id);
      const failedTurn: ThreadTurn = {
        ...turn,
        assistantMessage: assistantText,
        thinkingText,
        status: controller.signal.aborted ? "interrupted" : "failed",
        completedAt,
        durationMs,
        ...(latestUsage ? { usage: latestUsage } : {}),
        ...(controller.signal.aborted ? {} : { error: errorMessage }),
        activities,
        approvals,
      };
      releaseRun();
      updateTurnOutcomeRow(db, thread.id, turnEpoch, failedTurn);
      liveTurnBuffer.delete(turn.id);
      updateThreadStatus(
        thread.id,
        controller.signal.aborted ? { kind: "idle" } : { kind: "error", message: errorMessage },
      );
      eventBus.publishSync({ kind: "turn.upserted", turn: failedTurn });
    })
    .finally(() => {
      releaseRun();
      liveTurnBuffer.delete(turn.id);
    });
};

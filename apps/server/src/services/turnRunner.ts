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
import { readThreadById, readTurnsForThread, updateTurnOutcomeRow } from "./threadStore.ts";
import { deriveThreadTitle, shouldRefreshThreadTitle } from "./threadTitle.ts";

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

  const persistTurn = (next: ThreadTurn) => {
    updateTurnOutcomeRow(db, thread.id, turnEpoch, next);
    eventBus.publishSync({ kind: "turn.upserted", turn: next });
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
    db.prepare(
      "UPDATE activities SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
    ).run(updated.status, now, durationMs, updated.id);
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
    db.prepare(
      `INSERT INTO activities
         (id, turn_id, thread_id, seq, kind, label, active_label, detail, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      turn.id,
      thread.id,
      activitySeq,
      item.kind,
      item.label,
      item.activeLabel,
      null,
      item.status,
      now,
    );
    eventBus.publishSync({ kind: "turn.activity", activity: item });
  };

  const handleEvent = (event: HarnessEvent) => {
    if (isClosed()) return;
    switch (event.kind) {
      case "session": {
        const res = db
          .prepare(
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
        thinkingText += event.text;
        db.prepare("UPDATE turns SET thinking_text = ? WHERE id = ?").run(thinkingText, turn.id);
        eventBus.publishSync({
          kind: "turn.delta",
          threadId: thread.id,
          turnId: turn.id,
          channel: "thinking",
          delta: event.text,
        });
        return;
      }
      case "assistant.delta": {
        closeThinkingIfOpen();
        assistantText += event.text;
        db.prepare("UPDATE turns SET assistant_message = ? WHERE id = ?").run(
          assistantText,
          turn.id,
        );
        eventBus.publishSync({
          kind: "turn.delta",
          threadId: thread.id,
          turnId: turn.id,
          channel: "assistant",
          delta: event.text,
        });
        return;
      }
      case "assistant.replace": {
        closeThinkingIfOpen();
        assistantText = event.text;
        db.prepare("UPDATE turns SET assistant_message = ? WHERE id = ?").run(
          assistantText,
          turn.id,
        );
        const refreshed = readThreadById(db, thread.id);
        if (refreshed) {
          const currentTurn = readTurnsForThread(db, refreshed).find((t) => t.id === turn.id);
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
        db.prepare(
          `INSERT INTO activities
             (id, turn_id, thread_id, seq, kind, label, active_label, detail, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          turn.id,
          thread.id,
          activitySeq,
          item.kind,
          item.label,
          item.activeLabel,
          item.detail ?? null,
          item.status,
          now,
        );
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
        db.prepare(
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
        db.prepare(
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
        db.prepare("UPDATE turns SET usage_json = ? WHERE id = ?").run(encoded, turn.id);
        db.prepare(
          "UPDATE threads SET last_usage_json = ?, updated_at = ? WHERE id = ? AND session_epoch = ?",
        ).run(encoded, now, thread.id, turnEpoch);
        const refreshed = readThreadById(db, thread.id);
        if (refreshed) {
          eventBus.publishSync({ kind: "thread.upserted", thread: refreshed });
          const currentTurn = readTurnsForThread(db, refreshed).find((t) => t.id === turn.id);
          if (currentTurn) eventBus.publishSync({ kind: "turn.upserted", turn: currentTurn });
        }
        return;
      }
    }
  };

  const readLatestTurnChildren = () => {
    const refreshed = readThreadById(db, thread.id);
    const current = refreshed
      ? readTurnsForThread(db, refreshed).find((t) => t.id === turn.id)
      : undefined;
    return {
      activities: current?.activities ?? [],
      approvals: current?.approvals ?? [],
    };
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
      db.prepare(
        "UPDATE activities SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
      ).run(doneItem.status, completedAt, doneItem.durationMs ?? 0, doneItem.id);
      eventBus.publishSync({ kind: "turn.activity", activity: doneItem });
    }
  };

  const refreshThreadTitle = () => {
    try {
      if (readAgentByPrimaryThreadId(db, thread.id) !== null) return;
      const current = readThreadById(db, thread.id);
      if (!current) return;
      const completedTurns = readTurnsForThread(db, current).filter(
        (t) => t.status === "completed",
      );
      if (!shouldRefreshThreadTitle(completedTurns.length)) return;
      const nextTitle = deriveThreadTitle(completedTurns);
      if (nextTitle.length === 0 || nextTitle === current.title) return;
      db.prepare("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?").run(
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
      const { activities, approvals } = readLatestTurnChildren();
      const finalUsage = result.usage ?? latestUsage;
      persistTurn({
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
      });
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
      updateThreadStatus(thread.id, { kind: "idle" });
      onProjectActivity(thread, finalMessage.trim() || turn.userMessage);
    })
    .catch((error: unknown) => {
      if (isClosed()) return;
      closeThinkingIfOpen();
      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.parse(completedAt) - startedMs);
      closeRunningActivities(completedAt, controller.signal.aborted ? "completed" : "failed");
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { activities, approvals } = readLatestTurnChildren();
      persistTurn({
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
      });
      updateThreadStatus(
        thread.id,
        controller.signal.aborted ? { kind: "idle" } : { kind: "error", message: errorMessage },
      );
    })
    .finally(() => {
      if (activeRuns.get(thread.id)?.turnId === turn.id) {
        activeRuns.delete(thread.id);
      }
      for (const [approvalId, entry] of pendingApprovals.entries()) {
        if (entry.turnId === turn.id) {
          pendingApprovals.delete(approvalId);
        }
      }
    });
};

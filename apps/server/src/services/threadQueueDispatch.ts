import type { Database } from "bun:sqlite";
import type {
  EditQueuedTurnInput,
  ProviderConfig,
  QueuedTurn,
  SendTurnInput,
  SendTurnResult,
  Thread,
  ThreadStatus,
  ThreadTurn,
  TurnOrigin,
} from "@scuttle/contracts";
import type { ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "./EventBus.ts";
import type { LiveTurnBuffer } from "./liveTurnBuffer.ts";
import type * as ProviderService from "./ProviderService.ts";
import {
  cancelQueuedTurnRow,
  editQueuedTurnRow,
  enqueueTurn,
  listQueuedTurnsByThread,
  markQueuedTurnPromoted,
  moveQueuedTurnToFront,
  popNextQueuedTurn,
  readQueuedTurnById,
  resolveAttachmentPayloads,
} from "./threadQueueStore.ts";
import { readThreadById, readTurnById } from "./threadStore.ts";
import type { ActiveRun, TurnRunnerDeps } from "./turnRunner.ts";

export const dispatchMidRunTurn = async (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly activeRuns: Map<string, ActiveRun>;
  readonly liveTurnBuffer: LiveTurnBuffer;
  readonly existing: Thread;
  readonly turnInput: SendTurnInput;
  readonly origin: TurnOrigin;
}): Promise<{ readonly error?: string; readonly result?: SendTurnResult }> => {
  const { db, eventBus, activeRuns, liveTurnBuffer, existing, turnInput, origin } = input;
  if (origin === "system") {
    return {
      error: "This thread already has a turn running. Stop it before sending another message.",
    };
  }
  const mode = turnInput.mode ?? "steer";
  const nextSelection = turnInput.modelSelection ?? existing.modelSelection;
  const selectionChanged =
    nextSelection.providerId !== existing.modelSelection.providerId ||
    nextSelection.model !== existing.modelSelection.model;
  if (mode !== "queue" && selectionChanged) {
    return {
      error: "This thread already has a turn running. Stop it before changing provider or model.",
    };
  }

  const enqueue = (front: boolean): SendTurnResult => {
    const queuedTurn = enqueueTurn(db, {
      threadId: existing.id,
      prompt: turnInput.prompt,
      ...(turnInput.attachments ? { attachments: turnInput.attachments } : {}),
      ...(turnInput.modelSelection ? { modelSelection: turnInput.modelSelection } : {}),
      ...(turnInput.runtimeMode ? { runtimeMode: turnInput.runtimeMode } : {}),
      ...(turnInput.interactionMode ? { interactionMode: turnInput.interactionMode } : {}),
      front,
    });
    eventBus.publishSync({
      kind: "queue.updated",
      threadId: existing.id,
      queuedTurns: listQueuedTurnsByThread(db, existing.id),
    });
    return { kind: "queued", queuedTurn };
  };

  if (mode === "queue") return { result: enqueue(false) };

  const active = activeRuns.get(existing.id);
  if (active?.steerHandler) {
    const attachments = resolveAttachmentPayloads(db, turnInput.attachments);
    const steered = await active
      .steerHandler({
        prompt: turnInput.prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
      })
      .catch(() => false);
    if (steered && activeRuns.get(existing.id)?.turnId === active.turnId) {
      active.steerPrompts.push(turnInput.prompt);
      const rawTurn = readTurnById(db, active.turnId, existing.modelSelection);
      const turn = rawTurn ? liveTurnBuffer.overlayTurn(rawTurn) : null;
      if (turn) return { result: { kind: "steered", turn } };
    }
  }

  return { result: enqueue(true) };
};

export const promoteQueuedTurnOnThread = async (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly activeRuns: Map<string, ActiveRun>;
  readonly liveTurnBuffer: LiveTurnBuffer;
  readonly thread: Thread;
  readonly queuedId: string;
}): Promise<
  | { readonly error: string }
  | { readonly kind: "steered"; readonly turn: ThreadTurn }
  | { readonly kind: "queued"; readonly queuedTurn: QueuedTurn }
> => {
  const { db, eventBus, activeRuns, liveTurnBuffer, thread, queuedId } = input;
  const item = readQueuedTurnById(db, thread.id, queuedId);
  if (!item) return { error: `Queued turn "${queuedId}" was not found.` };

  const active = activeRuns.get(thread.id);
  if (active?.steerHandler) {
    const attachments = resolveAttachmentPayloads(db, item.attachments);
    const steered = await active
      .steerHandler({
        prompt: item.prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
      })
      .catch(() => false);
    if (steered && activeRuns.get(thread.id)?.turnId === active.turnId) {
      active.steerPrompts.push(item.prompt);
      markQueuedTurnPromoted(db, thread.id, queuedId);
      eventBus.publishSync({
        kind: "queue.updated",
        threadId: thread.id,
        queuedTurns: listQueuedTurnsByThread(db, thread.id),
      });
      const rawTurn = readTurnById(db, active.turnId, thread.modelSelection);
      const turn = rawTurn ? liveTurnBuffer.overlayTurn(rawTurn) : null;
      if (turn) return { kind: "steered", turn };
    }
  }

  const moved = moveQueuedTurnToFront(db, thread.id, queuedId) ?? item;
  eventBus.publishSync({
    kind: "queue.updated",
    threadId: thread.id,
    queuedTurns: listQueuedTurnsByThread(db, thread.id),
  });
  return { kind: "queued", queuedTurn: moved };
};

export const editQueuedTurnOnThread = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  threadId: ThreadId,
  queuedId: string,
  input: EditQueuedTurnInput,
): QueuedTurn | null => {
  const updated = editQueuedTurnRow(db, threadId, queuedId, input);
  if (!updated) return null;
  eventBus.publishSync({
    kind: "queue.updated",
    threadId,
    queuedTurns: listQueuedTurnsByThread(db, threadId),
  });
  return updated;
};

export const cancelQueuedTurnOnThread = (
  db: Database,
  eventBus: EventBus.EventBus["Service"],
  threadId: ThreadId,
  queuedId: string,
): boolean => {
  if (!cancelQueuedTurnRow(db, threadId, queuedId)) return false;
  eventBus.publishSync({
    kind: "queue.updated",
    threadId,
    queuedTurns: listQueuedTurnsByThread(db, threadId),
  });
  return true;
};

export const drainNextQueuedTurn = async (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly runnerDeps: TurnRunnerDeps;
  readonly updateThreadStatus: (threadId: ThreadId, status: ThreadStatus) => Thread | null;
  readonly providers: ProviderService.ProviderService["Service"];
  readonly threadId: ThreadId;
  readonly isClosed: () => boolean;
  readonly startTurn: (existing: Thread, next: QueuedTurn, providerConfig: ProviderConfig) => void;
}): Promise<void> => {
  const { db, eventBus, runnerDeps, updateThreadStatus, providers, threadId, isClosed } = input;
  if (isClosed() || runnerDeps.activeRuns.has(threadId)) return;
  if (!readThreadById(db, threadId)) return;
  const next = popNextQueuedTurn(db, threadId);
  if (!next) return;

  eventBus.publishSync({
    kind: "queue.updated",
    threadId,
    queuedTurns: listQueuedTurnsByThread(db, threadId),
  });

  const latestThread = readThreadById(db, threadId);
  if (!latestThread) return;
  const providerId = next.modelSelection?.providerId ?? latestThread.modelSelection.providerId;
  const providerConfig = await Effect.runPromise(
    providers.getConfig(providerId).pipe(Effect.result),
  );
  if (isClosed() || runnerDeps.activeRuns.has(threadId) || !readThreadById(db, threadId)) return;
  if (providerConfig._tag === "Failure") {
    updateThreadStatus(threadId, { kind: "error", message: providerConfig.failure.message });
    return;
  }
  if (!providerConfig.success.enabled) {
    updateThreadStatus(threadId, {
      kind: "error",
      message: `Provider "${providerConfig.success.name}" is disabled. Enable it in Settings.`,
    });
    return;
  }
  input.startTurn(latestThread, next, providerConfig.success);
};

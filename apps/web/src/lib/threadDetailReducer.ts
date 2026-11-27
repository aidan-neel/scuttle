import type {
  QueuedTurn,
  RewindThreadResult,
  ServerPushEvent,
  ThreadCheckpoint,
  ThreadDetail,
  ThreadTurn,
  ThreadVisualization,
} from "@scuttle/contracts";

const THREAD_DETAILS_CACHE_LIMIT = 12;

export const touchThreadDetail = (
  threadDetails: Readonly<Record<string, ThreadDetail>>,
  threadId: string,
  detail: ThreadDetail,
  activeThreadId: string | null,
): Readonly<Record<string, ThreadDetail>> => {
  const keys = Object.keys(threadDetails);
  const existing = Object.hasOwn(threadDetails, threadId);
  let skipCount = keys.length + (existing ? 0 : 1) - THREAD_DETAILS_CACHE_LIMIT;
  const next: Record<string, ThreadDetail> = {};
  for (const key of keys) {
    if (key === threadId) continue;
    if (skipCount > 0 && key !== activeThreadId) {
      skipCount -= 1;
      continue;
    }
    const entry = threadDetails[key];
    if (entry !== undefined) {
      next[key] = entry;
    }
  }
  next[threadId] = detail;
  return next;
};

export const mergeThreadDetailSnapshot = (
  existing: ThreadDetail | undefined,
  incoming: ThreadDetail,
): ThreadDetail => {
  if (existing === undefined) return incoming;
  if (!incoming.turns.some((turn) => turn.status === "running")) return incoming;

  const prevById = new Map<string, ThreadTurn>();
  for (const turn of existing.turns) {
    prevById.set(turn.id, turn);
  }

  let merged = false;
  const turns = incoming.turns.map((turn): ThreadTurn => {
    if (turn.status !== "running") return turn;
    const prev = prevById.get(turn.id);
    if (prev === undefined) return turn;
    if (prev.status !== "running") {
      merged = true;
      return prev;
    }
    const keepAssistant =
      prev.assistantMessage.length > turn.assistantMessage.length &&
      prev.assistantMessage.startsWith(turn.assistantMessage);
    const keepThinking =
      prev.thinkingText.length > turn.thinkingText.length &&
      prev.thinkingText.startsWith(turn.thinkingText);
    if (!keepAssistant && !keepThinking) return turn;
    merged = true;
    return {
      ...turn,
      assistantMessage: keepAssistant ? prev.assistantMessage : turn.assistantMessage,
      thinkingText: keepThinking ? prev.thinkingText : turn.thinkingText,
    };
  });
  return merged ? { ...incoming, turns } : incoming;
};

export const applyChannelDelta = (
  current: string,
  delta: string,
  offset: number | undefined,
): string => {
  if (delta.length === 0) return current;
  if (offset === undefined) return current + delta;
  const endOffset = offset + delta.length;
  if (endOffset <= current.length) return current;
  if (offset <= current.length) {
    return current + delta.slice(current.length - offset);
  }
  return current + delta;
};

export interface PendingChannelDelta {
  text: string;
  offset: number | undefined;
}

export interface PendingTurnDelta {
  assistant: PendingChannelDelta | null;
  thinking: PendingChannelDelta | null;
}

const mergePendingChannel = (
  existing: PendingChannelDelta | null,
  delta: string,
  offset: number | undefined,
): PendingChannelDelta | null | "flush" => {
  if (delta.length === 0) return existing;
  if (existing === null) return { text: delta, offset };
  if (existing.offset === undefined && offset === undefined) {
    existing.text += delta;
    return existing;
  }
  if (existing.offset !== undefined && offset !== undefined) {
    const existingEnd = existing.offset + existing.text.length;
    if (offset === existingEnd) {
      existing.text += delta;
      return existing;
    }
    if (offset >= existing.offset && offset <= existingEnd) {
      const sliceFrom = existingEnd - offset;
      if (sliceFrom < delta.length) {
        existing.text += delta.slice(sliceFrom);
      }
      return existing;
    }
  }
  return "flush";
};

export const queuePendingDelta = (
  pendingByThread: Map<string, Map<string, PendingTurnDelta>>,
  threadId: string,
  turnId: string,
  channel: "assistant" | "thinking",
  delta: string,
  offset: number | undefined,
): boolean => {
  let turnsMap = pendingByThread.get(threadId);
  if (turnsMap === undefined) {
    turnsMap = new Map<string, PendingTurnDelta>();
    pendingByThread.set(threadId, turnsMap);
  }
  let entry = turnsMap.get(turnId);
  if (entry === undefined) {
    entry = { assistant: null, thinking: null };
    turnsMap.set(turnId, entry);
  }
  const merged = mergePendingChannel(entry[channel], delta, offset);
  if (merged === "flush") return false;
  entry[channel] = merged;
  return true;
};

export const applyPendingTurnDeltas = (
  threadDetails: Readonly<Record<string, ThreadDetail>>,
  activeThreadId: string | null,
  pendingByThread: Map<string, Map<string, PendingTurnDelta>>,
): Readonly<Record<string, ThreadDetail>> => {
  if (pendingByThread.size === 0) return threadDetails;

  let nextThreadDetails = threadDetails;
  for (const [threadId, turnsMap] of pendingByThread) {
    const detail = nextThreadDetails[threadId];
    if (detail === undefined) continue;
    let changed = false;
    const turns = detail.turns.map((turn): ThreadTurn => {
      const delta = turnsMap.get(turn.id);
      if (delta === undefined) return turn;
      const nextAssistant =
        delta.assistant !== null
          ? applyChannelDelta(turn.assistantMessage, delta.assistant.text, delta.assistant.offset)
          : turn.assistantMessage;
      const nextThinking =
        delta.thinking !== null
          ? applyChannelDelta(turn.thinkingText, delta.thinking.text, delta.thinking.offset)
          : turn.thinkingText;
      if (nextAssistant === turn.assistantMessage && nextThinking === turn.thinkingText) {
        return turn;
      }
      changed = true;
      return {
        ...turn,
        assistantMessage: nextAssistant,
        thinkingText: nextThinking,
      };
    });
    if (changed) {
      nextThreadDetails = touchThreadDetail(
        nextThreadDetails,
        threadId,
        { ...detail, turns },
        activeThreadId,
      );
    }
  }
  pendingByThread.clear();
  return nextThreadDetails;
};

const byOrdinal = (a: ThreadCheckpoint, b: ThreadCheckpoint) => a.ordinal - b.ordinal;

export const activeQueuedTurns = (queued: ReadonlyArray<QueuedTurn>): ReadonlyArray<QueuedTurn> =>
  queued.filter((item) => item.status === "queued").toSorted((a, b) => a.position - b.position);

const upsertCheckpoint = (
  checkpoints: ReadonlyArray<ThreadCheckpoint>,
  next: ThreadCheckpoint,
): ReadonlyArray<ThreadCheckpoint> =>
  [...checkpoints.filter((cp) => cp.ordinal !== next.ordinal && cp.id !== next.id), next].toSorted(
    byOrdinal,
  );

const upsertVisualization = (
  visualizations: ReadonlyArray<ThreadVisualization>,
  next: ThreadVisualization,
): ReadonlyArray<ThreadVisualization> => {
  const index = visualizations.findIndex((viz) => viz.id === next.id);
  if (index === -1) return [...visualizations, next];
  const copy = [...visualizations];
  copy[index] = next;
  return copy;
};

export const rewindCutoffIndex = (
  turns: ReadonlyArray<ThreadTurn>,
  checkpoints: ReadonlyArray<ThreadCheckpoint>,
  ordinal: number,
): number => {
  if (ordinal === 0) return 0;
  const checkpoint = checkpoints.find((cp) => cp.ordinal === ordinal);
  const byTurn = checkpoint?.turnId ? turns.findIndex((turn) => turn.id === checkpoint.turnId) : -1;
  if (byTurn !== -1) return byTurn + 1;
  return Math.min(ordinal, turns.length);
};

const keepLinkedVisualizations = (
  visualizations: ReadonlyArray<ThreadVisualization> | undefined,
  turns: ReadonlyArray<ThreadTurn>,
): ReadonlyArray<ThreadVisualization> | undefined => {
  if (visualizations === undefined) return undefined;
  const kept = new Set(turns.map((turn) => turn.id));
  return visualizations.filter((viz) => viz.turnId === undefined || kept.has(viz.turnId));
};

export const applyRewindResult = (
  detail: ThreadDetail,
  result: RewindThreadResult,
): ThreadDetail => {
  const visualizations = keepLinkedVisualizations(detail.visualizations, result.turns);
  return {
    ...detail,
    thread: result.thread,
    turns: result.turns,
    checkpoints: result.checkpoints,
    ...(visualizations !== undefined ? { visualizations } : {}),
  };
};

export interface RewindPlan {
  readonly turn: ThreadTurn;
  readonly target: ThreadCheckpoint;
  readonly turnsRemoved: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly changedCheckpoints: number;
}

export const rewindTargetFor = (
  turns: ReadonlyArray<ThreadTurn>,
  checkpoints: ReadonlyArray<ThreadCheckpoint>,
  index: number,
): ThreadCheckpoint | undefined => {
  const previous = index > 0 ? turns[index - 1] : undefined;
  return previous === undefined
    ? checkpoints.find((cp) => cp.ordinal === 0)
    : checkpoints.find((cp) => cp.turnId === previous.id);
};

export const planRewind = (
  turns: ReadonlyArray<ThreadTurn>,
  checkpoints: ReadonlyArray<ThreadCheckpoint>,
  turnId: string,
): RewindPlan | null => {
  const index = turns.findIndex((turn) => turn.id === turnId);
  const turn = turns[index];
  const target = turn === undefined ? undefined : rewindTargetFor(turns, checkpoints, index);
  if (turn === undefined || target === undefined) return null;
  const after = checkpoints.filter((cp) => cp.ordinal > target.ordinal);
  return {
    turn,
    target,
    turnsRemoved: turns.length - index,
    insertions: after.reduce((sum, cp) => sum + cp.insertions, 0),
    deletions: after.reduce((sum, cp) => sum + cp.deletions, 0),
    changedCheckpoints: after.filter((cp) => cp.filesChanged > 0).length,
  };
};

export const threadIdOfExtrasEvent = (event: ServerPushEvent): string | null => {
  switch (event.kind) {
    case "checkpoint.created":
      return event.checkpoint.threadId;
    case "viz.upserted":
      return event.visualization.threadId;
    case "queue.updated":
    case "thread.rewound":
      return event.threadId;
    default:
      return null;
  }
};

export const applyThreadExtrasEvent = (
  detail: ThreadDetail,
  event: ServerPushEvent,
): ThreadDetail => {
  switch (event.kind) {
    case "checkpoint.created":
      return {
        ...detail,
        checkpoints: upsertCheckpoint(detail.checkpoints ?? [], event.checkpoint),
      };
    case "queue.updated":
      return { ...detail, queuedTurns: activeQueuedTurns(event.queuedTurns) };
    case "viz.upserted":
      return {
        ...detail,
        visualizations: upsertVisualization(detail.visualizations ?? [], event.visualization),
      };
    case "thread.rewound": {
      const checkpoints = detail.checkpoints ?? [];
      const cutoff = rewindCutoffIndex(detail.turns, checkpoints, event.checkpointOrdinal);
      const turns = detail.turns.slice(0, cutoff);
      const visualizations = keepLinkedVisualizations(detail.visualizations, turns);
      return {
        ...detail,
        turns,
        checkpoints: checkpoints.filter((cp) => cp.ordinal <= event.checkpointOrdinal),
        ...(visualizations !== undefined ? { visualizations } : {}),
      };
    }
    default:
      return detail;
  }
};

import { describe, expect, test } from "bun:test";
import type {
  ModelPerfRun,
  ModelSelection,
  QueuedTurn,
  ServerPushEvent,
  Thread,
  ThreadCheckpoint,
  ThreadDetail,
  ThreadTurn,
  ThreadVisualization,
} from "@scuttle/contracts";
import { VisualizationId } from "@scuttle/contracts";
import { ProjectId, ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import {
  activeQueuedTurns,
  applyRewindResult,
  applyThreadExtrasEvent,
  rewindCutoffIndex,
} from "../../src/lib/threadDetailReducer.ts";
import {
  createInitialWorkspaceState,
  reduceWorkspaceState,
} from "../../src/lib/workspaceReducer.ts";

const SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};
const THREAD_ID = ThreadId.make("thread-1");
const AT = "2026-11-26T00:00:00.000Z";

const thread: Thread = {
  id: THREAD_ID,
  projectId: ProjectId.make("proj-1"),
  projectName: "Scuttle",
  title: "Thread",
  runtime: "local",
  branch: "main",
  cwd: "/tmp/scuttle",
  modelSelection: SELECTION,
  runtimeMode: "auto",
  interactionMode: "default",
  status: { kind: "idle" },
  createdAt: AT,
  updatedAt: AT,
};

const turn = (id: string, userMessage = id): ThreadTurn => ({
  id: TurnId.make(id),
  threadId: THREAD_ID,
  userMessage,
  assistantMessage: "done",
  thinkingText: "",
  status: "completed",
  startedAt: AT,
  modelSelection: SELECTION,
  activities: [],
  approvals: [],
});

const checkpoint = (ordinal: number, turnId?: string): ThreadCheckpoint => ({
  id: `cp-${ordinal}`,
  threadId: THREAD_ID,
  ...(turnId !== undefined ? { turnId: TurnId.make(turnId) } : {}),
  ordinal,
  ref: `refs/scuttle/cp-${ordinal}`,
  commitOid: `oid-${ordinal}`,
  filesChanged: ordinal,
  insertions: ordinal * 10,
  deletions: ordinal,
  createdAt: AT,
});

const queued = (id: string, position: number, status: QueuedTurn["status"] = "queued") => ({
  id,
  threadId: THREAD_ID,
  prompt: `prompt ${id}`,
  position,
  status,
  createdAt: AT,
  updatedAt: AT,
});

const viz = (id: string, turnId?: string): ThreadVisualization => ({
  id: VisualizationId.make(id),
  threadId: THREAD_ID,
  ...(turnId !== undefined ? { turnId: TurnId.make(turnId) } : {}),
  title: id,
  spec: { mode: "structured", title: id, blocks: [] },
  createdAt: AT,
  updatedAt: AT,
});

const detail: ThreadDetail = {
  thread,
  turns: [turn("t1"), turn("t2"), turn("t3")],
  checkpoints: [checkpoint(0), checkpoint(1, "t1"), checkpoint(2, "t2"), checkpoint(3, "t3")],
  visualizations: [viz("v-thread"), viz("v1", "t1"), viz("v3", "t3")],
};

describe("applyThreadExtrasEvent", () => {
  test("checkpoint.created inserts the checkpoint in ordinal order and replaces duplicates", () => {
    const base = { ...detail, checkpoints: [checkpoint(0), checkpoint(2, "t2")] };
    const inserted = applyThreadExtrasEvent(base, {
      kind: "checkpoint.created",
      checkpoint: checkpoint(1, "t1"),
    });
    expect(inserted.checkpoints?.map((cp) => cp.ordinal)).toEqual([0, 1, 2]);

    const replaced = applyThreadExtrasEvent(inserted, {
      kind: "checkpoint.created",
      checkpoint: { ...checkpoint(2, "t2"), insertions: 99 },
    });
    expect(replaced.checkpoints).toHaveLength(3);
    expect(replaced.checkpoints?.[2]?.insertions).toBe(99);
  });

  test("queue.updated keeps only queued items sorted by position", () => {
    const next = applyThreadExtrasEvent(detail, {
      kind: "queue.updated",
      threadId: THREAD_ID,
      queuedTurns: [queued("b", 2), queued("gone", 0, "promoted"), queued("a", 1)],
    });
    expect(next.queuedTurns?.map((q) => q.id)).toEqual(["a", "b"]);
  });

  test("viz.upserted appends new visualizations and updates existing ones in place", () => {
    const added = applyThreadExtrasEvent(detail, {
      kind: "viz.upserted",
      visualization: viz("v2", "t2"),
    });
    expect(added.visualizations?.map((v) => v.title)).toEqual(["v-thread", "v1", "v3", "v2"]);

    const updated = applyThreadExtrasEvent(added, {
      kind: "viz.upserted",
      visualization: { ...viz("v1", "t1"), title: "renamed" },
    });
    expect(updated.visualizations?.[1]?.title).toBe("renamed");
  });

  test("thread.rewound drops turns, checkpoints, and turn visualizations after the checkpoint", () => {
    const next = applyThreadExtrasEvent(detail, {
      kind: "thread.rewound",
      threadId: THREAD_ID,
      checkpointOrdinal: 1,
    });
    expect(next.turns.map((t) => t.id)).toEqual([TurnId.make("t1")]);
    expect(next.checkpoints?.map((cp) => cp.ordinal)).toEqual([0, 1]);
    expect(next.visualizations?.map((v) => v.title)).toEqual(["v-thread", "v1"]);
  });

  test("thread.rewound to the baseline checkpoint clears every turn", () => {
    const next = applyThreadExtrasEvent(detail, {
      kind: "thread.rewound",
      threadId: THREAD_ID,
      checkpointOrdinal: 0,
    });
    expect(next.turns).toEqual([]);
  });

  test("unrelated events return the same detail", () => {
    const event: ServerPushEvent = { kind: "thread.upserted", thread };
    expect(applyThreadExtrasEvent(detail, event)).toBe(detail);
  });
});

describe("rewind helpers", () => {
  test("rewindCutoffIndex falls back to the ordinal when the checkpoint has no turn", () => {
    expect(rewindCutoffIndex(detail.turns, [checkpoint(2)], 2)).toBe(2);
    expect(rewindCutoffIndex(detail.turns, [], 9)).toBe(3);
  });

  test("applyRewindResult swaps in server turns and drops orphaned visualizations", () => {
    const next = applyRewindResult(detail, {
      thread,
      turns: [turn("t1")],
      checkpoints: [checkpoint(0), checkpoint(1, "t1")],
      restoredPrompt: "t2",
      filesRestored: true,
    });
    expect(next.turns).toHaveLength(1);
    expect(next.visualizations?.map((v) => v.title)).toEqual(["v-thread", "v1"]);
  });

  test("activeQueuedTurns ignores canceled items", () => {
    expect(
      activeQueuedTurns([queued("x", 1, "canceled"), queued("y", 2)]).map((q) => q.id),
    ).toEqual(["y"]);
  });
});

describe("workspace reducer wiring", () => {
  test("extras events update the cached thread detail and ignore uncached threads", () => {
    const loaded = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "threadDetailLoaded",
      detail,
    });
    const next = reduceWorkspaceState(loaded, {
      kind: "push",
      event: { kind: "queue.updated", threadId: THREAD_ID, queuedTurns: [queued("a", 1)] },
    });
    expect(next.threadDetails[THREAD_ID]?.queuedTurns).toHaveLength(1);

    const other = reduceWorkspaceState(next, {
      kind: "push",
      event: {
        kind: "queue.updated",
        threadId: ThreadId.make("missing"),
        queuedTurns: [queued("b", 1)],
      },
    });
    expect(other).toBe(next);
  });

  test("perf.recorded bumps the performance revision", () => {
    const run: ModelPerfRun = {
      id: "run-1",
      providerId: "claude",
      model: "claude-opus-5-5",
      durationMs: 1000,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      tokensPerSecond: 20,
      costUsd: 0.01,
      createdAt: AT,
    };
    const state = createInitialWorkspaceState();
    const next = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "perf.recorded", run },
    });
    expect(next.perfRevision).toBe(state.perfRevision + 1);
  });
});

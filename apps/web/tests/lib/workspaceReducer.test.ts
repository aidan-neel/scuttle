import { describe, expect, test } from "bun:test";
import type {
  ActivityItem,
  Agent,
  ModelSelection,
  Thread,
  ThreadDetail,
  ThreadTurn,
} from "@scuttle/contracts";
import { ActivityId, AgentId, ProjectId, ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import {
  createInitialWorkspaceState,
  reduceWorkspaceState,
} from "../../src/lib/workspaceReducer.ts";
import { createWorkspaceStore } from "../../src/lib/workspaceStore.ts";

const DEFAULT_SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};

const makeThread = (id: string, updatedAt: string, projectId = "proj-1"): Thread => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make(projectId),
  projectName: "Scuttle",
  title: `Thread ${id}`,
  runtime: "local",
  branch: "main",
  cwd: "/tmp/scuttle",
  modelSelection: DEFAULT_SELECTION,
  runtimeMode: "auto",
  interactionMode: "default",
  status: { kind: "idle" },
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt,
});

const makeTurn = (threadId: string, turnId: string, assistantMessage = ""): ThreadTurn => ({
  id: TurnId.make(turnId),
  threadId: ThreadId.make(threadId),
  userMessage: "hi",
  assistantMessage,
  thinkingText: "",
  status: "running",
  startedAt: "2026-11-26T00:00:00.000Z",
  modelSelection: DEFAULT_SELECTION,
  activities: [],
  approvals: [],
});

const makeDetail = (
  threadId: string,
  updatedAt = "2026-11-26T00:00:00.000Z",
  turns: ReadonlyArray<ThreadTurn> = [makeTurn(threadId, "turn-1")],
): ThreadDetail => ({
  thread: makeThread(threadId, updatedAt),
  turns,
});

const makeAgent = (id: string, primaryThreadId: string, projectId = "proj-1"): Agent => ({
  id: AgentId.make(id),
  projectId: ProjectId.make(projectId),
  projectName: "Scuttle",
  projectPath: "/tmp/scuttle",
  name: `Agent ${id}`,
  purpose: "Testing",
  primaryThreadId: ThreadId.make(primaryThreadId),
  runtime: "local",
  modelSelection: DEFAULT_SELECTION,
  modelStack: {},
  instructionsMd: "",
  pinned: false,
  needsAttention: false,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
});

const makeActivity = (threadId: string, turnId: string, id: string): ActivityItem => ({
  id: ActivityId.make(id),
  threadId: ThreadId.make(threadId),
  turnId: TurnId.make(turnId),
  kind: "tool",
  label: "Read file",
  activeLabel: "Reading file",
  status: "completed",
  startedAt: "2026-11-26T00:00:01.000Z",
});

describe("workspaceReducer", () => {
  test("pushBatch coalesces consecutive turn.delta events and preserves order across turn.upserted and turn.activity", () => {
    const tId = ThreadId.make("thread-1");
    const turnId = TurnId.make("turn-1");
    const initial = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "threadDetailLoaded",
      detail: makeDetail("thread-1"),
    });

    const next = reduceWorkspaceState(initial, {
      kind: "pushBatch",
      events: [
        { kind: "turn.delta", threadId: tId, turnId, channel: "thinking", delta: "step 1 " },
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: "hello " },
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: "world" },
        { kind: "turn.delta", threadId: tId, turnId, channel: "thinking", delta: "step 2" },
        { kind: "turn.activity", activity: makeActivity("thread-1", "turn-1", "act-1") },
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: "!" },
        {
          kind: "turn.upserted",
          turn: {
            ...makeTurn("thread-1", "turn-1", "authoritative"),
            thinkingText: "final thought",
            status: "completed",
          },
        },
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: " tail" },
      ],
    });

    const turn = next.threadDetails["thread-1"]?.turns[0];
    expect(turn).toBeDefined();
    expect(turn?.assistantMessage).toBe("authoritative tail");
    expect(turn?.thinkingText).toBe("final thought");
    expect(turn?.status).toBe("completed");
  });

  test("pushBatch preserves activity and delta ordering when turn.upserted is not overwriting", () => {
    const tId = ThreadId.make("thread-1");
    const turnId = TurnId.make("turn-1");
    const initial = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "threadDetailLoaded",
      detail: makeDetail("thread-1"),
    });

    const next = reduceWorkspaceState(initial, {
      kind: "pushBatch",
      events: [
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: "a" },
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: "b" },
        { kind: "turn.activity", activity: makeActivity("thread-1", "turn-1", "act-1") },
        { kind: "turn.delta", threadId: tId, turnId, channel: "assistant", delta: "c" },
      ],
    });

    const turn = next.threadDetails["thread-1"]?.turns[0];
    expect(turn?.assistantMessage).toBe("abc");
    expect(turn?.activities.map((a) => a.id)).toEqual([ActivityId.make("act-1")]);
  });

  test("thread.upserted sorts descending by updatedAt matching ISO chronological order", () => {
    const t1 = makeThread("t1", "2026-11-26T10:00:00.000Z");
    const t2 = makeThread("t2", "2026-11-26T12:00:00.000Z");
    const t3 = makeThread("t3", "2026-11-26T11:00:00.000Z");

    let state = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "loaded",
      projects: [],
      threads: [t2, t1],
      providers: [],
      agents: [],
    });

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "thread.upserted", thread: t3 },
    });
    expect(state.threads.map((t) => t.id)).toEqual([
      ThreadId.make("t2"),
      ThreadId.make("t3"),
      ThreadId.make("t1"),
    ]);

    const t1Updated = makeThread("t1", "2026-11-26T13:00:00.000Z");
    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "thread.upserted", thread: t1Updated },
    });
    expect(state.threads.map((t) => t.id)).toEqual([
      ThreadId.make("t1"),
      ThreadId.make("t2"),
      ThreadId.make("t3"),
    ]);

    const t1SameTime = { ...t1Updated, title: "Renamed" };
    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "thread.upserted", thread: t1SameTime },
    });
    expect(state.threads.map((t) => t.id)).toEqual([
      ThreadId.make("t1"),
      ThreadId.make("t2"),
      ThreadId.make("t3"),
    ]);
    expect(state.threads[0]?.title).toBe("Renamed");
  });

  test("agentThreadIds stays in sync across loaded, agent.upserted, agent.deleted, thread.deleted, and project.deleted", () => {
    const a1 = makeAgent("a1", "thr-a1", "proj-1");
    const a2 = makeAgent("a2", "thr-a2", "proj-2");

    let state = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "loaded",
      projects: [],
      threads: [],
      providers: [],
      agents: [a1],
    });
    expect([...state.agentThreadIds]).toEqual(["thr-a1"]);

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "agent.upserted", agent: a2 },
    });
    expect(state.agentThreadIds.has("thr-a1")).toBe(true);
    expect(state.agentThreadIds.has("thr-a2")).toBe(true);

    const a3 = makeAgent("a3", "thr-a3", "proj-2");
    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "agent.upserted", agent: a3 },
    });
    expect(state.agentThreadIds.size).toBe(3);

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "agent.deleted", agentId: a1.id },
    });
    expect(state.agentThreadIds.has("thr-a1")).toBe(false);
    expect(state.agentThreadIds.size).toBe(2);

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "thread.deleted", threadId: a2.primaryThreadId },
    });
    expect(state.agentThreadIds.has("thr-a2")).toBe(false);
    expect([...state.agentThreadIds]).toEqual(["thr-a3"]);

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "project.deleted", projectId: ProjectId.make("proj-2") },
    });
    expect(state.agentThreadIds.size).toBe(0);
  });

  test("threadDetails LRU caps at 12 entries and keeps most recently touched threads", () => {
    let state = createInitialWorkspaceState();
    for (let i = 1; i <= 12; i++) {
      state = reduceWorkspaceState(state, {
        kind: "threadDetailLoaded",
        detail: makeDetail(`t-${i}`),
      });
    }
    expect(Object.keys(state.threadDetails)).toHaveLength(12);

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: {
        kind: "turn.delta",
        threadId: ThreadId.make("t-1"),
        turnId: TurnId.make("turn-1"),
        channel: "assistant",
        delta: "keep me",
      },
    });

    state = reduceWorkspaceState(state, {
      kind: "threadDetailLoaded",
      detail: makeDetail("t-13"),
    });

    expect(Object.keys(state.threadDetails)).toHaveLength(12);
    expect(state.threadDetails["t-1"]).toBeDefined();
    expect(state.threadDetails["t-1"]?.turns[0]?.assistantMessage).toBe("keep me");
    expect(state.threadDetails["t-2"]).toBeUndefined();
    expect(state.threadDetails["t-13"]).toBeDefined();
  });

  test("threadDetails LRU never evicts activeThreadId", () => {
    let state = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "setActiveThread",
      threadId: "t-1",
    });
    for (let i = 1; i <= 15; i++) {
      state = reduceWorkspaceState(state, {
        kind: "threadDetailLoaded",
        detail: makeDetail(`t-${i}`),
      });
    }

    expect(Object.keys(state.threadDetails)).toHaveLength(12);
    expect(state.threadDetails["t-1"]).toBeDefined();
    expect(state.threadDetails["t-2"]).toBeUndefined();
    expect(state.threadDetails["t-3"]).toBeUndefined();
    expect(state.threadDetails["t-4"]).toBeUndefined();
    expect(state.threadDetails["t-15"]).toBeDefined();

    state = reduceWorkspaceState(state, { kind: "setActiveThread", threadId: null });
    state = reduceWorkspaceState(state, {
      kind: "threadDetailLoaded",
      detail: makeDetail("t-16"),
    });
    expect(state.threadDetails["t-1"]).toBeUndefined();
    expect(state.threadDetails["t-16"]).toBeDefined();
  });

  test("store notifies listeners only when state reference changes", () => {
    const store = createWorkspaceStore(createInitialWorkspaceState());
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.dispatch({
      kind: "pushBatch",
      events: [
        {
          kind: "turn.delta",
          threadId: ThreadId.make("uncached"),
          turnId: TurnId.make("turn-1"),
          channel: "assistant",
          delta: "token",
        },
      ],
    });
    expect(notifications).toBe(0);

    store.dispatch({
      kind: "selectProject",
      projectId: ProjectId.make("proj-1"),
    });
    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("turn.delta with offset is idempotent against snapshot overlap and stale snapshots do not clobber running text", () => {
    const tId = ThreadId.make("thread-1");
    const turnId = TurnId.make("turn-1");

    let state = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "threadDetailLoaded",
      detail: makeDetail("thread-1", "2026-11-26T00:00:00.000Z", [
        { ...makeTurn("thread-1", "turn-1", "AB"), thinkingText: "XY" },
      ]),
    });

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: {
        kind: "turn.delta",
        threadId: tId,
        turnId,
        channel: "assistant",
        delta: "B",
        offset: 1,
      },
    });
    expect(state.threadDetails["thread-1"]?.turns[0]?.assistantMessage).toBe("AB");

    state = reduceWorkspaceState(state, {
      kind: "pushBatch",
      events: [
        {
          kind: "turn.delta",
          threadId: tId,
          turnId,
          channel: "assistant",
          delta: "BC",
          offset: 1,
        },
        {
          kind: "turn.delta",
          threadId: tId,
          turnId,
          channel: "assistant",
          delta: "D",
          offset: 3,
        },
        {
          kind: "turn.delta",
          threadId: tId,
          turnId,
          channel: "thinking",
          delta: "Y",
          offset: 1,
        },
        {
          kind: "turn.delta",
          threadId: tId,
          turnId,
          channel: "thinking",
          delta: "Z",
          offset: 2,
        },
      ],
    });
    expect(state.threadDetails["thread-1"]?.turns[0]?.assistantMessage).toBe("ABCD");
    expect(state.threadDetails["thread-1"]?.turns[0]?.thinkingText).toBe("XYZ");

    state = reduceWorkspaceState(state, {
      kind: "threadDetailLoaded",
      detail: makeDetail("thread-1", "2026-11-26T00:00:01.000Z", [
        { ...makeTurn("thread-1", "turn-1", "AB"), thinkingText: "X" },
      ]),
    });
    expect(state.threadDetails["thread-1"]?.turns[0]?.assistantMessage).toBe("ABCD");
    expect(state.threadDetails["thread-1"]?.turns[0]?.thinkingText).toBe("XYZ");

    state = reduceWorkspaceState(state, {
      kind: "threadDetailLoaded",
      detail: makeDetail("thread-1", "2026-11-26T00:00:02.000Z", [
        { ...makeTurn("thread-1", "turn-1", "Final"), status: "completed", thinkingText: "Done" },
      ]),
    });
    expect(state.threadDetails["thread-1"]?.turns[0]?.assistantMessage).toBe("Final");
    expect(state.threadDetails["thread-1"]?.turns[0]?.thinkingText).toBe("Done");
  });
});

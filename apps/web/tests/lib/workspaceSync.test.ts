import { describe, expect, test } from "bun:test";
import type { ServerPushEvent } from "@scuttle/contracts";
import { ThreadId, TurnId } from "@scuttle/shared/ids";
import { createWorkspaceSync } from "../../src/lib/workspaceSync.ts";

const makeDelta = (delta: string, offset: number): ServerPushEvent => ({
  kind: "turn.delta",
  threadId: ThreadId.make("t-1"),
  turnId: TurnId.make("turn-1"),
  channel: "assistant",
  delta,
  offset,
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("createWorkspaceSync", () => {
  test("fast WS open triggers exactly one initial fetch and drains buffered events", async () => {
    let fetchCount = 0;
    let resolveFetch!: (ok: boolean) => void;
    const batches: Array<ReadonlyArray<ServerPushEvent>> = [];

    const sync = createWorkspaceSync({
      fetchWorkspace: () => {
        fetchCount += 1;
        return new Promise<boolean>((resolve) => {
          resolveFetch = resolve;
        });
      },
      onDispatchBatch: (events) => batches.push(events),
      fallbackDelayMs: 30,
    });

    sync.start();
    sync.handleWsOpen({ isReconnect: false });
    expect(fetchCount).toBe(1);

    sync.handleWsEvents([makeDelta("hi", 0)]);
    expect(batches).toHaveLength(0);

    resolveFetch(true);
    await delay(50);

    expect(fetchCount).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    sync.dispose();
  });

  test("slow WS catch-up buffers concurrent pushes until snapshot lands and retries if catch-up fails", async () => {
    let fetchCount = 0;
    let resolveCatchUp!: (ok: boolean) => void;
    const timeline: Array<string> = [];

    const sync = createWorkspaceSync({
      fetchWorkspace: () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          timeline.push("fallback-loaded");
          return Promise.resolve(true);
        }
        if (fetchCount === 2) {
          return new Promise<boolean>((resolve) => {
            resolveCatchUp = (ok) => {
              timeline.push(ok ? "catchup-loaded" : "catchup-failed");
              resolve(ok);
            };
          });
        }
        timeline.push("catchup-retry-loaded");
        return Promise.resolve(true);
      },
      onDispatchBatch: () => {
        timeline.push("push-dispatched");
      },
      fallbackDelayMs: 15,
      retryBaseMs: 20,
      retryMaxMs: 40,
    });

    sync.start();
    await delay(35);
    expect(fetchCount).toBe(1);

    sync.handleWsOpen({ isReconnect: false });
    expect(fetchCount).toBe(2);

    sync.handleWsEvents([makeDelta("rename", 0)]);
    expect(timeline).toEqual(["fallback-loaded"]);

    resolveCatchUp(false);
    await delay(45);
    expect(fetchCount).toBe(3);
    expect(timeline).toEqual([
      "fallback-loaded",
      "catchup-failed",
      "push-dispatched",
      "catchup-retry-loaded",
    ]);
    sync.dispose();
  });

  test("concurrent push during succeeding catch-up replays after snapshot so newer push is not reverted", async () => {
    let fetchCount = 0;
    let resolveCatchUp!: (ok: boolean) => void;
    const timeline: Array<string> = [];

    const sync = createWorkspaceSync({
      fetchWorkspace: () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          timeline.push("fallback-loaded");
          return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
          resolveCatchUp = (ok) => {
            timeline.push("catchup-loaded");
            resolve(ok);
          };
        });
      },
      onDispatchBatch: () => {
        timeline.push("push-dispatched");
      },
      fallbackDelayMs: 15,
    });

    sync.start();
    await delay(35);
    sync.handleWsOpen({ isReconnect: false });
    sync.handleWsEvents([makeDelta("rename", 0)]);
    expect(timeline).toEqual(["fallback-loaded"]);

    resolveCatchUp(true);
    await delay(10);
    expect(timeline).toEqual(["fallback-loaded", "catchup-loaded", "push-dispatched"]);
    sync.dispose();
  });

  test("buffer overflow during a succeeding fetch drops stale batch and triggers one follow-up refresh", async () => {
    let fetchCount = 0;
    const batches: Array<ReadonlyArray<ServerPushEvent>> = [];
    let releaseFirst!: (ok: boolean) => void;

    const sync = createWorkspaceSync({
      fetchWorkspace: () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Promise<boolean>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(true);
      },
      onDispatchBatch: (events) => batches.push(events),
      fallbackDelayMs: 100,
      maxBufferedEvents: 2,
    });

    sync.handleWsOpen({ isReconnect: false });
    expect(fetchCount).toBe(1);

    sync.handleWsEvents([makeDelta("a", 0), makeDelta("b", 1), makeDelta("c", 2)]);
    releaseFirst(true);

    await delay(20);
    expect(fetchCount).toBe(2);
    expect(batches).toHaveLength(0);
    sync.dispose();
  });

  test("failed initial fetch retries with backoff", async () => {
    let fetchCount = 0;
    const sync = createWorkspaceSync({
      fetchWorkspace: async () => {
        fetchCount += 1;
        return fetchCount >= 2;
      },
      onDispatchBatch: () => {},
      fallbackDelayMs: 100,
      retryBaseMs: 20,
      retryMaxMs: 40,
    });

    sync.handleWsOpen({ isReconnect: false });
    await delay(50);
    expect(fetchCount).toBe(2);
    sync.dispose();
  });

  test("manual refresh uses the same sync coordinator and drains buffered events", async () => {
    let fetchCount = 0;
    let shouldSucceed = false;
    const batches: Array<ReadonlyArray<ServerPushEvent>> = [];

    const sync = createWorkspaceSync({
      fetchWorkspace: async () => {
        fetchCount += 1;
        return shouldSucceed;
      },
      onDispatchBatch: (events) => batches.push(events),
      fallbackDelayMs: 200,
      retryBaseMs: 500,
    });

    sync.handleWsOpen({ isReconnect: false });
    await delay(10);
    expect(fetchCount).toBe(1);

    shouldSucceed = true;
    await sync.refresh();
    expect(fetchCount).toBe(2);

    sync.handleWsEvents([makeDelta("live", 0)]);
    expect(batches).toHaveLength(1);
    sync.dispose();
  });
});

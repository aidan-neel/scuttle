import { describe, expect, test } from "bun:test";
import type { ServerPushEvent } from "@scuttle/contracts";
import { ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import { parseServerRpcMessage, resolveWebSocketUrl } from "../src/connection.ts";
import { createWsSupervisor, decodeServerPushEvent } from "../src/wsClient.ts";

describe("client-runtime connection helpers", () => {
  test("derives ws URL from explicit http base URL", () => {
    expect(resolveWebSocketUrl("http://127.0.0.1:4310")).toBe("ws://127.0.0.1:4310/ws");
    expect(resolveWebSocketUrl("https://scuttle.example/app")).toBe("wss://scuttle.example/ws");
  });

  test("decodes valid pong RPC responses", async () => {
    const result = await Effect.runPromise(
      parseServerRpcMessage(
        JSON.stringify({
          kind: "pong",
          id: "req-1",
          serverTime: "2026-11-25T10:00:00.000Z",
        }),
      ),
    );
    expect(result.kind).toBe("pong");
    if (result.kind === "pong") {
      expect(result.id).toBe("req-1");
    }
  });

  test("fast-decodes valid turn.delta events and rejects malformed or non-push messages", () => {
    const valid = decodeServerPushEvent({
      kind: "turn.delta",
      threadId: "thread-1",
      turnId: "turn-1",
      channel: "assistant",
      delta: "hello",
    });
    expect(valid).toEqual({
      kind: "turn.delta",
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      channel: "assistant",
      delta: "hello",
    });

    expect(
      decodeServerPushEvent({
        kind: "turn.delta",
        threadId: "",
        turnId: "turn-1",
        channel: "assistant",
        delta: "hello",
      }),
    ).toBeNull();

    expect(
      decodeServerPushEvent({
        kind: "pong",
        id: "req-1",
        serverTime: "2026-11-25T10:00:00.000Z",
      }),
    ).toBeNull();
  });

  test("wsSupervisor flush() synchronously delivers queued push events", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, bunServer) {
        if (bunServer.upgrade(request)) return undefined;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.send(
            JSON.stringify({
              kind: "turn.delta",
              threadId: "thread-1",
              turnId: "turn-1",
              channel: "assistant",
              delta: "hello",
            }),
          );
        },
        message() {},
      },
    });

    const batches: Array<ReadonlyArray<ServerPushEvent>> = [];
    let resolveReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });

    const supervisor = createWsSupervisor({
      baseUrl: `http://127.0.0.1:${server.port}`,
      onEvent: () => {
        resolveReceived();
      },
      onEvents: (events) => {
        batches.push(events);
      },
    });

    try {
      await received;
      expect(batches).toHaveLength(0);
      supervisor.flush();
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual([
        {
          kind: "turn.delta",
          threadId: ThreadId.make("thread-1"),
          turnId: TurnId.make("turn-1"),
          channel: "assistant",
          delta: "hello",
        },
      ]);
    } finally {
      supervisor.close();
      await server.stop(true);
    }
  });
});

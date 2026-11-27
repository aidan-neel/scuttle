import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { parseServerRpcMessage, resolveWebSocketUrl } from "../src/connection.ts";

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
});

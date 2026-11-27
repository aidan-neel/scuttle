import { afterEach, describe, expect, it } from "bun:test";
import { ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import { createScuttleApiClient } from "../src/api.ts";

const originalFetch = globalThis.fetch;

const MODEL = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude" as const,
  model: "claude-opus-5-5",
  effort: "high" as const,
};

const TURN = {
  id: TurnId.make("turn-1"),
  threadId: ThreadId.make("thread-1"),
  userMessage: "Fix it",
  assistantMessage: "",
  thinkingText: "",
  status: "running" as const,
  startedAt: "2026-11-25T00:00:00Z",
  modelSelection: MODEL,
  activities: [],
  approvals: [],
};

const QUEUED = {
  id: "q-1",
  threadId: ThreadId.make("thread-1"),
  prompt: "Then add tests",
  position: 1,
  status: "queued" as const,
  createdAt: "2026-11-25T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z",
};

type Responder = (method: string, path: string, body: unknown) => Response;

const stubFetch = (respond: Responder) => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    return respond(method, path, body);
  }) as typeof fetch;
  return calls;
};

describe("sendTurn dispatch decoding", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("decodes the server's flattened steered response into a steered result", async () => {
    const calls = stubFetch(() =>
      Response.json(
        { ...TURN, kind: "steered", disposition: "steered", turn: TURN },
        { status: 201 },
      ),
    );
    const api = createScuttleApiClient("http://scuttle.test");

    const result = await api.sendTurn("thread-1", { prompt: "Use the other file", mode: "steer" });

    expect(result.kind).toBe("steered");
    expect(result.kind !== "queued" && result.turn.id).toBe(TURN.id);
    expect(calls[0]?.body).toEqual({ prompt: "Use the other file", mode: "steer" });
  });

  it("decodes a queued response with its queued turn", async () => {
    stubFetch(() =>
      Response.json({ kind: "queued", disposition: "queued", queuedTurn: QUEUED }, { status: 201 }),
    );
    const api = createScuttleApiClient("http://scuttle.test");

    const result = await api.sendTurn("thread-1", { prompt: "Then add tests", mode: "queue" });

    expect(result).toEqual({ kind: "queued", queuedTurn: QUEUED });
  });

  it("treats a legacy plain turn response as a started turn", async () => {
    stubFetch(() => Response.json(TURN, { status: 201 }));
    const api = createScuttleApiClient("http://scuttle.test");

    const result = await api.sendTurn("thread-1", { prompt: "Fix it" });

    expect(result.kind).toBe("started");
    expect(result.kind === "started" && result.turn.userMessage).toBe("Fix it");
  });
});

describe("queue, rewind, and performance endpoints", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes queue operations to their thread-scoped endpoints", async () => {
    const calls = stubFetch((method, path) => {
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/promote")) {
        return Response.json({ ...TURN, kind: "steered", disposition: "steered", turn: TURN });
      }
      if (method === "PATCH") return Response.json({ ...QUEUED, prompt: "Edited" });
      return Response.json([QUEUED]);
    });
    const api = createScuttleApiClient("http://scuttle.test");

    expect(await api.listQueuedTurns("thread-1")).toEqual([QUEUED]);
    expect((await api.editQueuedTurn("thread-1", "q-1", { prompt: "Edited" })).prompt).toBe(
      "Edited",
    );
    expect((await api.promoteQueuedTurn("thread-1", "q-1")).kind).toBe("steered");
    await api.cancelQueuedTurn("thread-1", "q-1");

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/threads/thread-1/queue",
      "PATCH /api/threads/thread-1/queue/q-1",
      "POST /api/threads/thread-1/queue/q-1/promote",
      "DELETE /api/threads/thread-1/queue/q-1",
    ]);
  });

  it("sends performance filters as query parameters", async () => {
    const calls = stubFetch(() =>
      Response.json({
        generatedAt: "2026-11-25T00:00:00Z",
        days: 3650,
        categories: [],
        overall: [],
        byCategory: [],
        recentRuns: [],
      }),
    );
    const api = createScuttleApiClient("http://scuttle.test");

    const summary = await api.getPerformanceSummary({ days: 3650, category: "ui" });

    expect(summary.days).toBe(3650);
    expect(calls[0]?.path).toBe("/api/performance?category=ui&days=3650");
  });
});

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import type { ScuttleVizSpec } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  DEFAULT_MCP_SESSION_TTL_MS,
  makeMcpSessionRegistry,
} from "../../src/mcp/McpSessionRegistry.ts";
import { SCUTTLE_MCP_TOOL_NAMES } from "../../src/mcp/mcpToolDefs.ts";
import { createScuttleMcpHandler, type ScuttleMcpDeps } from "../../src/mcp/ScuttleMcpServer.ts";
import { runStdioBridge } from "../../src/mcp/stdioBridge.ts";
import { makeModelPerformanceService } from "../../src/services/ModelPerformanceService.ts";

const decodeRpc = Schema.decodeUnknownSync(
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
    result: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Struct({ code: Schema.Number, message: Schema.String })),
  }),
);
const decodeToolResult = Schema.decodeUnknownSync(
  Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
    structuredContent: Schema.Record(Schema.String, Schema.Unknown),
    isError: Schema.Boolean,
  }),
);

interface DelEntry {
  delegationId: string;
  childThreadId: string;
  status: string;
  providerId: string;
  model: string;
}

const makeHarness = () => {
  const db = new Database(":memory:");
  let nowMs = Date.parse("2026-11-27T12:00:00.000Z");
  const perfService = makeModelPerformanceService(db, { now: () => nowMs });
  const registry = makeMcpSessionRegistry({ now: () => nowMs });
  const vizStore = new Map<string, { title: string; spec: ScuttleVizSpec }>();
  const delegations = new Map<string, DelEntry>();
  let vizSeq = 0;
  let delSeq = 0;

  const deps: ScuttleMcpDeps = {
    renderViz: (ctx, spec) => {
      const vizId = `viz-${++vizSeq}`;
      vizStore.set(vizId, { title: spec.title, spec });
      return {
        vizId,
        title: spec.title,
        mode: spec.mode,
        threadId: ctx.threadId,
        createdAt: new Date(nowMs).toISOString(),
      };
    },
    updateViz: (_ctx, input) => {
      const existing = vizStore.get(input.vizId);
      if (!existing) throw new Error(`Visualization ${input.vizId} not found.`);
      const nextSpec = input.spec ?? existing.spec;
      const nextTitle = input.title ?? input.spec?.title ?? existing.title;
      vizStore.set(input.vizId, { title: nextTitle, spec: nextSpec });
      return { vizId: input.vizId, title: nextTitle, updatedAt: new Date(nowMs).toISOString() };
    },
    recordPerf: (_ctx, input) => Effect.runPromise(perfService.rateRun(input)),
    queryPerf: (_ctx, input) => Effect.runPromise(perfService.querySummary(input)),
    getCapabilities: (_ctx, input) => ({
      providers: [
        { id: "claude-work", kind: "claude", models: ["claude-sonnet-4-5"] },
        { id: "acp-codex", kind: "codex", models: ["gpt-5.3-codex"] },
      ],
      performanceHighlights: input.category ? [`Highlights for ${input.category}`] : ["9.2/10"],
    }),
    delegateTask: async (_ctx, input) => {
      const n = ++delSeq;
      const delegationId = `del-${n}`;
      const childThreadId = `thread-child-${n}`;
      const providerId = input.providerId ?? "claude-work";
      const model = input.model ?? "claude-sonnet-4-5";
      delegations.set(delegationId, {
        delegationId,
        childThreadId,
        status: "running",
        providerId,
        model,
      });
      await Effect.runPromise(
        perfService.recordMeasuredRun({
          providerId,
          model,
          delegationId,
          threadId: childThreadId,
          durationMs: 4200,
          firstTokenMs: 200,
          inputTokens: 1500,
          outputTokens: 800,
          cacheReadTokens: 300,
          costUsd: 0.042,
        }),
      );
      return { delegationId, childThreadId, status: "running" };
    },
    getTaskStatus: async (_ctx, input) => {
      const entry = input.delegationId
        ? delegations.get(input.delegationId)
        : [...delegations.values()].find((d) => d.childThreadId === input.childThreadId);
      if (!entry) throw new Error("Delegation not found.");
      const run = await Effect.runPromise(
        perfService.getRunByTurnOrDelegation({ delegationId: entry.delegationId }),
      );
      return {
        delegationId: entry.delegationId,
        childThreadId: entry.childThreadId,
        status: entry.status,
        providerId: entry.providerId,
        model: entry.model,
        summary: "Completed",
        ...(run
          ? {
              telemetry: {
                tokensPerSecond: run.tokensPerSecond,
                durationMs: run.durationMs,
                costUsd: run.costUsd,
                inputTokens: run.inputTokens,
                outputTokens: run.outputTokens,
                cacheReadTokens: run.cacheReadTokens,
                ...(run.firstTokenMs !== undefined ? { firstTokenMs: run.firstTokenMs } : {}),
              },
            }
          : {}),
      };
    },
    cancelTask: (_ctx, input) => {
      const entry = delegations.get(input.delegationId);
      if (!entry) throw new Error(`Delegation ${input.delegationId} not found.`);
      entry.status = "canceled";
      return { delegationId: entry.delegationId, status: "canceled" };
    },
    listThreads: (ctx, input) => ({
      projectId: input.allProjects ? null : (input.projectId ?? ctx.projectId),
      threads: [{ id: ctx.threadId, title: "Parent thread" }],
    }),
    readThread: (_ctx, input) => ({
      threadId: input.threadId,
      turnLimit: input.turnLimit ?? 10,
      turns: [{ id: "turn-1", summary: "Analyzed MCP server requirements" }],
    }),
    askUser: (_ctx, input) => ({
      answered: true,
      dismissed: false,
      answers: Object.fromEntries(
        input.questions.map((q, i) => [
          q.id || q.header || `q${i + 1}`,
          q.multiSelect ? [q.options[0]!.label] : q.options[0]!.label,
        ]),
      ),
    }),
  };

  const handler = createScuttleMcpHandler({ registry, deps });
  const issued = registry.issueToken({
    threadId: "thread-parent-1",
    projectId: "proj-1",
    agentId: "agent-1",
    providerId: "claude-work",
  });

  const rpc = async (
    body: unknown,
    auth: string | null = issued.authorizationHeader,
    extraHeaders?: Record<string, string>,
  ) => {
    const res = await handler(
      new Request("http://scuttle.local/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(auth !== null ? { authorization: auth } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      }),
    );
    const envelope = res.status === 202 || res.status === 204 ? null : decodeRpc(await res.json());
    return { res, envelope };
  };

  const callTool = async (id: number, name: string, args: Record<string, unknown>) => {
    const { envelope } = await rpc({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    return decodeToolResult(envelope?.result);
  };

  return { db, registry, vizStore, handler, issued, rpc, callTool };
};

const withHarness = async (fn: (h: ReturnType<typeof makeHarness>) => Promise<void>) => {
  const h = makeHarness();
  try {
    await fn(h);
  } finally {
    h.db.close();
  }
};

describe("McpSessionRegistry", () => {
  it("issues base64url tokens, tracks idle TTL, and revokes by threadId", () => {
    let nowMs = 1_000_000;
    const registry = makeMcpSessionRegistry({ now: () => nowMs });
    const t1 = registry.issueToken({ threadId: "th-1", projectId: "proj-1" });
    const t2 = registry.issueToken({ threadId: "th-1", projectId: "proj-1" });
    const t3 = registry.issueToken({ threadId: "th-2", projectId: "proj-1" });
    expect(t1.token.length).toBeGreaterThanOrEqual(40);
    expect(t1.authorizationHeader).toBe(`Bearer ${t1.token}`);
    expect(registry.verifyAuthorization(null)).toBeNull();
    expect(registry.verifyAuthorization("Basic abc")).toBeNull();
    expect(registry.verifyAuthorization("Bearer wrong")).toBeNull();
    expect(registry.verifyAuthorization(t1.authorizationHeader)?.threadId).toBe("th-1");

    nowMs += DEFAULT_MCP_SESSION_TTL_MS - 1_000;
    expect(registry.verifyAuthorization(t1.authorizationHeader)).not.toBeNull();
    nowMs += 2_000;
    expect(registry.verifyAuthorization(t1.authorizationHeader)).not.toBeNull();
    expect(registry.cleanupExpired()).toBe(2);
    expect(registry.verifyAuthorization(t2.authorizationHeader)).toBeNull();
    expect(registry.verifyAuthorization(t3.authorizationHeader)).toBeNull();

    const t4 = registry.issueToken({ threadId: "th-1", projectId: "proj-1" });
    const t5 = registry.issueToken({ threadId: "th-2", projectId: "proj-1" });
    expect(registry.revokeThread("th-1")).toBe(2);
    expect(registry.verifyAuthorization(t1.authorizationHeader)).toBeNull();
    expect(registry.verifyAuthorization(t4.authorizationHeader)).toBeNull();
    expect(registry.verifyAuthorization(t5.authorizationHeader)?.threadId).toBe("th-2");
  });
});

describe("ScuttleMcpServer", () => {
  it("rejects missing or invalid Bearer tokens with 401 JSON-RPC error", () =>
    withHarness(async ({ handler, rpc }) => {
      const missing = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, null);
      expect(missing.res.status).toBe(401);
      expect(missing.envelope?.error?.code).toBe(-32001);
      const invalid = await rpc({ jsonrpc: "2.0", id: 2, method: "ping" }, "Bearer bogus");
      expect(invalid.res.status).toBe(401);
      expect(invalid.envelope?.error?.code).toBe(-32001);
      const delUnauth = await handler(
        new Request("http://scuttle.local/mcp", { method: "DELETE" }),
      );
      expect(delUnauth.status).toBe(401);
    }));

  it("handles initialize, notifications/initialized, ping, DELETE, and lists all 11 tools", () =>
    withHarness(async ({ handler, issued, rpc, registry }) => {
      const init = await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {} },
      });
      expect(init.res.status).toBe(200);
      const sessionId = init.res.headers.get("mcp-session-id") ?? "";
      expect(sessionId.length).toBeGreaterThan(0);
      expect(init.envelope?.result).toEqual({
        protocolVersion: "2025-03-26",
        serverInfo: { name: "scuttle", version: "1.0.0" },
        capabilities: { tools: {} },
      });

      const initialized = await rpc(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        issued.authorizationHeader,
        { "mcp-session-id": sessionId },
      );
      expect(initialized.res.status).toBe(202);
      expect((await rpc({ jsonrpc: "2.0", id: 2, method: "ping" })).envelope?.result).toEqual({});

      const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
      const tools = Schema.decodeUnknownSync(
        Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
      )(list.envelope?.result).tools;
      expect(tools.map((t) => t.name)).toEqual([...SCUTTLE_MCP_TOOL_NAMES]);
      expect(tools).toHaveLength(11);

      const del = await handler(
        new Request("http://scuttle.local/mcp", {
          method: "DELETE",
          headers: { authorization: issued.authorizationHeader, "mcp-session-id": sessionId },
        }),
      );
      expect(del.status).toBe(204);
      registry.revokeThread("thread-parent-1");
      expect((await rpc({ jsonrpc: "2.0", id: 4, method: "ping" })).res.status).toBe(401);
    }));

  it("validates scuttle_viz_render and scuttle_viz_update via ScuttleVizSpec", () =>
    withHarness(async ({ callTool, vizStore }) => {
      const validSpec: ScuttleVizSpec = {
        mode: "structured",
        title: "Latency Breakdown",
        subtitle: "Last 24h",
        takeaway: "Median tok/s rose 18% after streaming optimizations.",
        blocks: [
          {
            kind: "kpis",
            items: [
              {
                id: "kpi-pass",
                label: "Pass Rate",
                value: "94%",
                delta: "+4%",
                tone: "success",
                sparkline: [88, 90, 91, 94],
                filterKey: "status",
                filterValue: "pass",
              },
            ],
          },
          {
            kind: "chart",
            title: "Throughput by Model",
            chartType: "bar",
            unit: "tok/s",
            categories: ["Sonnet", "Codex"],
            series: [{ id: "tps", label: "Tokens/sec", tone: "primary", values: [142, 168] }],
            filterKey: "model",
          },
          {
            kind: "table",
            searchable: true,
            filterColumn: "status",
            columns: [
              { key: "model", label: "Model", kind: "text" },
              { key: "tps", label: "Tok/s", align: "right", kind: "bar" },
            ],
            rows: [
              {
                id: "r1",
                cells: { model: "claude-sonnet-4-5", tps: 142 },
                tone: "success",
                filterTags: { status: "pass", model: "Sonnet" },
                detail: "3 runs, 0 major reworks",
              },
            ],
          },
        ],
      };

      const renderRes = await callTool(10, "scuttle_viz_render", validSpec);
      expect(renderRes.isError).toBe(false);
      expect(renderRes.structuredContent.vizId).toBe("viz-1");
      expect(renderRes.structuredContent.mode).toBe("structured");

      const invalidRes = await callTool(11, "scuttle_viz_render", {
        mode: "structured",
        title: "Broken Chart",
        blocks: [{ kind: "chart", chartType: "pie", series: [] }],
      });
      expect(invalidRes.isError).toBe(true);
      expect(invalidRes.content[0]?.text).toContain("Invalid ScuttleVizSpec");
      expect(invalidRes.content[0]?.text).toContain("chartType");

      const updateRes = await callTool(12, "scuttle_viz_update", {
        vizId: "viz-1",
        title: "Updated Latency Breakdown",
      });
      expect(updateRes.isError).toBe(false);
      expect(updateRes.structuredContent.title).toBe("Updated Latency Breakdown");
      expect(vizStore.get("viz-1")?.title).toBe("Updated Latency Breakdown");

      const badUpdate = await callTool(13, "scuttle_viz_update", {
        vizId: "viz-1",
        spec: { mode: "sandbox", title: "Empty" },
      });
      expect(badUpdate.isError).toBe(true);
      expect(badUpdate.content[0]?.text).toContain("Invalid ScuttleVizSpec");
    }));

  it("joins measured telemetry across delegate -> task_status -> perf_record -> perf_query", () =>
    withHarness(async ({ callTool }) => {
      const caps = await callTool(20, "scuttle_capabilities", {});
      expect(caps.isError).toBe(false);
      expect(caps.structuredContent.providers).toHaveLength(2);

      const delegated = await callTool(21, "scuttle_delegate_task", {
        title: "Build MCP server",
        brief: "Implement HTTP MCP endpoints and stdio bridge",
        runtime: "worktree",
        providerId: "claude-work",
        model: "claude-sonnet-4-5",
        role: "medium",
      });
      expect(delegated.isError).toBe(false);
      const delegationId = String(delegated.structuredContent.delegationId);
      const childThreadId = String(delegated.structuredContent.childThreadId);
      expect(delegationId).toBe("del-1");
      expect(childThreadId).toBe("thread-child-1");

      const status = await callTool(22, "scuttle_task_status", { delegationId });
      expect(status.isError).toBe(false);
      expect(status.structuredContent.telemetry).toEqual({
        tokensPerSecond: 200,
        durationMs: 4200,
        costUsd: 0.042,
        inputTokens: 1500,
        outputTokens: 800,
        cacheReadTokens: 300,
        firstTokenMs: 200,
      });

      const recorded = await callTool(23, "scuttle_perf_record", {
        delegationId,
        category: "backend",
        score: 9.5,
        outcome: "pass",
        rework: "none",
        notes: "Clean first-pass implementation",
      });
      expect(recorded.isError).toBe(false);
      expect(recorded.structuredContent.tokensPerSecond).toBe(200);
      expect(recorded.structuredContent.durationMs).toBe(4200);
      expect(recorded.structuredContent.costUsd).toBe(0.042);

      const queried = await callTool(24, "scuttle_perf_query", { category: "backend" });
      expect(queried.isError).toBe(false);
      const QueryOutSchema = Schema.Struct({
        byCategory: Schema.Array(
          Schema.Struct({ avgScore: Schema.Number, avgTokensPerSecond: Schema.Number }),
        ),
        summaryLines: Schema.Array(Schema.String),
      });
      const qData = Schema.decodeUnknownSync(QueryOutSchema)(queried.structuredContent);
      expect(qData.byCategory[0]?.avgScore).toBe(9.5);
      expect(qData.byCategory[0]?.avgTokensPerSecond).toBe(200);
      expect(qData.summaryLines[0]).toContain("claude-sonnet-4-5");

      const canceled = await callTool(25, "scuttle_task_cancel", {
        delegationId,
        reason: "No longer needed",
      });
      expect(canceled.structuredContent.status).toBe("canceled");

      const threads = await callTool(26, "scuttle_thread_list", {});
      expect(threads.structuredContent.projectId).toBe("proj-1");

      const threadRead = await callTool(27, "scuttle_thread_read", { threadId: childThreadId });
      expect(threadRead.structuredContent.threadId).toBe(childThreadId);
    }));

  it("bridges stdio JSON-RPC over HTTP with session tracking and EOF DELETE", () =>
    withHarness(async ({ handler, issued }) => {
      const seenMethods: Array<string> = [];
      const seenSessionIds: Array<string | null> = [];
      const outputLines: Array<string> = [];
      const lines = [
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`,
      ];

      async function* inputStream() {
        for (const chunk of lines) yield chunk;
      }

      await runStdioBridge({
        endpoint: "http://scuttle.local/mcp",
        authorization: issued.authorizationHeader,
        input: inputStream(),
        output: { write: (chunk: string) => outputLines.push(chunk) },
        fetchImpl: async (url, init) => {
          const req = new Request(url, init);
          seenMethods.push(req.method);
          seenSessionIds.push(req.headers.get("mcp-session-id"));
          return handler(req);
        },
      });

      expect(seenMethods).toEqual(["POST", "POST", "POST", "DELETE"]);
      expect(seenSessionIds[0]).toBeNull();
      expect(seenSessionIds[1]).toBeTruthy();
      expect(seenSessionIds[2]).toBe(seenSessionIds[1]);
      expect(seenSessionIds[3]).toBe(seenSessionIds[1]);
      expect(outputLines).toHaveLength(2);
      expect(decodeRpc(JSON.parse(outputLines[0] ?? "{}")).result).toEqual({
        protocolVersion: "2025-03-26",
        serverInfo: { name: "scuttle", version: "1.0.0" },
        capabilities: { tools: {} },
      });
      expect(decodeRpc(JSON.parse(outputLines[1] ?? "{}")).result).toEqual({});
    }));
});

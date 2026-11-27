import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../src/config.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import * as UsageService from "../../src/services/UsageService.ts";

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-usage-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("UsageService", () => {
  test("aggregates Claude, Codex, OpenCode, and Scuttle turns without double counting", async () => {
    const root = makeTempDir();
    const dbPath = NodePath.join(root, "state.sqlite");
    const claudeDir = NodePath.join(root, "claude");
    const codexDir = NodePath.join(root, "codex");
    const openCodeDbPath = NodePath.join(root, "opencode.db");
    NodeFS.mkdirSync(NodePath.join(claudeDir, "proj-a"), { recursive: true });
    NodeFS.mkdirSync(codexDir, { recursive: true });

    const fixedNowMs = Date.parse("2026-11-27T12:00:00.000Z");

    // Claude JSONL with streaming duplicate for msg-1 (must keep last snapshot only)
    const claudeFile = NodePath.join(claudeDir, "proj-a", "sess-claude-1.jsonl");
    NodeFS.writeFileSync(
      claudeFile,
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-11-27T09:10:00.000Z",
          sessionId: "sess-claude-1",
          message: {
            id: "msg-1",
            model: "claude-opus-5-5",
            usage: {
              input_tokens: 100,
              output_tokens: 10,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 500,
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-11-27T09:10:03.000Z",
          sessionId: "sess-claude-1",
          message: {
            id: "msg-1",
            model: "claude-opus-5-5",
            usage: {
              input_tokens: 100,
              output_tokens: 250,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 500,
            },
          },
        }),
      ].join("\n") + "\n",
    );

    // Codex JSONL with cumulative total_token_usage and duplicate snapshot
    const codexFile = NodePath.join(codexDir, "rollout-1.jsonl");
    NodeFS.writeFileSync(
      codexFile,
      [
        JSON.stringify({
          timestamp: "2026-11-26T15:00:00.000Z",
          type: "session_meta",
          payload: { id: "sess-codex-1" },
        }),
        JSON.stringify({
          timestamp: "2026-11-26T15:00:01.000Z",
          type: "turn_context",
          payload: { model: "gpt-6.2-sol" },
        }),
        JSON.stringify({
          timestamp: "2026-11-26T15:01:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 2000,
                cached_input_tokens: 1500,
                cache_write_input_tokens: 0,
                output_tokens: 200,
              },
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-11-26T15:01:01.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 2000,
                cached_input_tokens: 1500,
                cache_write_input_tokens: 0,
                output_tokens: 200,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );

    // OpenCode SQLite fixture
    const ocDb = new Database(openCodeDbPath);
    ocDb.run("CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER NOT NULL)");
    ocDb.run(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL)",
    );
    const ocTime = Date.parse("2026-11-25T18:00:00.000Z");
    ocDb.query("INSERT INTO session VALUES (?, ?)").run("ses-oc-1", ocTime);
    ocDb.query("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      "msg-oc-1",
      "ses-oc-1",
      ocTime,
      JSON.stringify({
        role: "assistant",
        modelID: "glm-5.3",
        cost: 0.05,
        tokens: { input: 300, output: 100, reasoning: 50, cache: { read: 400, write: 0 } },
      }),
    );
    ocDb.close();

    const configLayer = ServerConfig.layer({ dbPath });
    const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
    const usageLayer = UsageService.layer({
      now: () => fixedNowMs,
      sources: {
        claudeDirs: [claudeDir],
        codexDirs: [codexDir],
        openCodeDbPath,
        antigravityDirs: [],
      },
    }).pipe(Layer.provide(sqliteLayer));
    const testLayer = Layer.mergeAll(configLayer, sqliteLayer, usageLayer);

    // Seed Scuttle turns: one matching sess-claude-1 (must NOT double count) and one unique antigravity turn
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const sqlite = yield* Sqlite.SqliteDatabase;
        const nowIso = new Date(fixedNowMs).toISOString();
        sqlite.db
          .query(
            `INSERT INTO projects (id, name, path, is_git_repo, default_branch, created_at, updated_at)
             VALUES ('p1', 'demo', '/tmp/demo', 0, 'main', ?, ?)`,
          )
          .run(nowIso, nowIso);
        sqlite.db
          .query(
            `INSERT INTO threads (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, provider_session_id, created_at, updated_at)
             VALUES ('t1', 'p1', 'demo', 'Dup', 'local', 'main', '/tmp/demo', 'claude', 'claude', 'claude-opus-5-5', '{"kind":"idle"}', 'sess-claude-1', ?, ?)`,
          )
          .run(nowIso, nowIso);
        sqlite.db
          .query(
            `INSERT INTO turns (id, thread_id, seq, origin, user_message, status, started_at, cost_usd, usage_json, model_selection_json)
             VALUES ('turn1', 't1', 1, 'user', 'hi', 'completed', '2026-11-27T09:10:00.000Z', 0.1, ?, ?)`,
          )
          .run(
            JSON.stringify({ inputTokens: 9999, outputTokens: 9999 }),
            JSON.stringify({
              providerId: "claude",
              providerKind: "claude",
              model: "claude-opus-5-5",
            }),
          );
        sqlite.db
          .query(
            `INSERT INTO threads (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, provider_session_id, created_at, updated_at)
             VALUES ('t2', 'p1', 'demo', 'AG', 'local', 'main', '/tmp/demo', 'antigravity', 'antigravity', 'gemini-4-neon', '{"kind":"idle"}', 'ag-sess-1', ?, ?)`,
          )
          .run(nowIso, nowIso);
        sqlite.db
          .query(
            `INSERT INTO turns (id, thread_id, seq, origin, user_message, status, started_at, cost_usd, usage_json, model_selection_json)
             VALUES ('turn2', 't2', 1, 'user', 'hi', 'completed', '2026-11-27T11:00:00.000Z', 0.25, ?, ?)`,
          )
          .run(
            JSON.stringify({ inputTokens: 400, outputTokens: 100, cacheReadTokens: 600 }),
            JSON.stringify({
              providerId: "antigravity",
              providerKind: "antigravity",
              model: "gemini-4-neon",
            }),
          );

        const usage = yield* UsageService.UsageService;
        return yield* usage.getReport({ range: "7d", provider: "all" });
      }).pipe(Effect.provide(testLayer)),
    );

    expect(report.sessions).toBe(4);
    expect(report.totals.inputTokens).toBe(100 + 500 + 300 + 400);
    expect(report.totals.outputTokens).toBe(250 + 200 + 150 + 100);
    expect(report.totals.cacheReadTokens).toBe(1000 + 1500 + 400 + 600);
    expect(report.totals.cacheWriteTokens).toBe(500);
    expect(report.totals.processedTokens).toBe(1300 + 700 + 3500 + 500);
    expect(report.providers.map((p) => p.providerKind)).toEqual([
      "codex",
      "claude",
      "antigravity",
      "opencode",
    ]);
    expect(report.series.length).toBe(7);

    // Filter to Claude only (should hit warm cache)
    const claudeOnly = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* UsageService.UsageService;
        return yield* usage.getReport({ range: "24h", provider: "claude" });
      }).pipe(Effect.provide(testLayer)),
    );
    expect(claudeOnly.granularity).toBe("hour");
    expect(claudeOnly.series.length).toBe(24);
    expect(claudeOnly.totals.processedTokens).toBe(1850);
    expect(claudeOnly.models[0]?.model).toBe("claude-opus-5-5");
  });

  test("re-scans modified files incrementally when refreshed", async () => {
    const root = makeTempDir();
    const dbPath = NodePath.join(root, "state.sqlite");
    const claudeDir = NodePath.join(root, "claude");
    NodeFS.mkdirSync(claudeDir, { recursive: true });
    const fixedNowMs = Date.parse("2026-11-27T12:00:00.000Z");

    const file = NodePath.join(claudeDir, "live.jsonl");
    const line1 = JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-27T10:00:00.000Z",
      sessionId: "live-1",
      message: {
        id: "m1",
        model: "claude-sonnet-5-5",
        usage: { input_tokens: 500, output_tokens: 100 },
      },
    });
    NodeFS.writeFileSync(file, `${line1}\n`);

    const configLayer = ServerConfig.layer({ dbPath });
    const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
    const usageLayer = UsageService.layer({
      now: () => fixedNowMs,
      sources: {
        claudeDirs: [claudeDir],
        codexDirs: [],
        openCodeDbPath: null,
        antigravityDirs: [],
        disableNative: true,
      },
    }).pipe(Layer.provide(sqliteLayer));
    const testLayer = Layer.mergeAll(configLayer, sqliteLayer, usageLayer);

    const first = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* UsageService.UsageService;
        return yield* usage.getReport({ range: "7d", provider: "all" });
      }).pipe(Effect.provide(testLayer)),
    );
    expect(first.totals.processedTokens).toBe(600);

    // Append a new message and force refresh
    const line2 = JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-27T11:00:00.000Z",
      sessionId: "live-1",
      message: {
        id: "m2",
        model: "claude-sonnet-5-5",
        usage: { input_tokens: 400, output_tokens: 200 },
      },
    });
    NodeFS.appendFileSync(file, `${line2}\n`);

    const second = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* UsageService.UsageService;
        return yield* usage.getReport({ range: "7d", provider: "all", refresh: true });
      }).pipe(Effect.provide(testLayer)),
    );
    expect(second.totals.processedTokens).toBe(1200);
    expect(second.sessions).toBe(1);
  });
});

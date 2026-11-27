import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../src/config.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import {
  computeTokensPerSecond,
  ensurePerformanceSchema,
  formatModelCategoryLine,
  layer as modelPerformanceLayer,
  makeModelPerformanceService,
  ModelPerformanceService,
} from "../../src/services/ModelPerformanceService.ts";
import { estimateCostUsd } from "../../src/services/usage/pricing.ts";

const makeHarness = (startMs = Date.parse("2026-11-27T12:00:00.000Z")) => {
  const db = new Database(":memory:");
  let nowMs = startMs;
  const service = makeModelPerformanceService(db, { now: () => nowMs });
  return {
    db,
    service,
    setNow: (ms: number) => {
      nowMs = ms;
    },
    advanceMs: (delta: number) => {
      nowMs += delta;
    },
  };
};

describe("ModelPerformanceService", () => {
  it("ensurePerformanceSchema is idempotent and creates expected indexes", () => {
    const db = new Database(":memory:");
    ensurePerformanceSchema(db);
    ensurePerformanceSchema(db);

    const indexes = db
      .query<{ readonly name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'model_performance_runs'",
      )
      .all()
      .map((row) => row.name);

    expect(indexes).toContain("idx_model_perf_model_category_created");
    expect(indexes).toContain("idx_model_perf_turn_id");
    expect(indexes).toContain("idx_model_perf_delegation_id");
    expect(indexes).toContain("idx_model_perf_thread_id");
    db.close();
  });

  it("computes tokensPerSecond with and without firstTokenMs, applies cost fallback, and upserts by turnId", async () => {
    const { db, service } = makeHarness();

    expect(computeTokensPerSecond(0, 2000)).toBe(0);
    expect(computeTokensPerSecond(500, 0)).toBe(0);
    expect(computeTokensPerSecond(500, 1000, 1500)).toBe(500);

    const withoutTtft = await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "gemini-4-neon",
        turnId: "turn-1",
        threadId: "thread-1",
        durationMs: 2500,
        inputTokens: 1_000_000,
        outputTokens: 350,
        cacheReadTokens: 500_000,
      }),
    );
    expect(withoutTtft.tokensPerSecond).toBe(140);
    expect(withoutTtft.costUsd).toBeCloseTo(
      estimateCostUsd("gemini-4-neon", {
        inputTokens: 1_000_000,
        outputTokens: 350,
        cacheReadTokens: 500_000,
        cacheWriteTokens: 0,
      }),
      8,
    );

    const withTtft = await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "gemini-4-neon",
        turnId: "turn-2",
        threadId: "thread-1",
        durationMs: 3000,
        firstTokenMs: 500,
        inputTokens: 200,
        outputTokens: 253,
        costUsd: 0.42,
      }),
    );
    expect(withTtft.tokensPerSecond).toBe(101.2);
    expect(withTtft.costUsd).toBe(0.42);

    await Effect.runPromise(
      service.rateRun({
        turnId: "turn-1",
        category: "Backend",
        score: 9,
        outcome: "pass",
      }),
    );

    const upserted = await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "gemini-4-neon",
        turnId: "turn-1",
        threadId: "thread-1",
        durationMs: 2000,
        firstTokenMs: 500,
        outputTokens: 300,
        costUsd: 0.55,
      }),
    );

    expect(upserted.id).toBe(withoutTtft.id);
    expect(upserted.tokensPerSecond).toBe(200);
    expect(upserted.costUsd).toBe(0.55);
    expect(upserted.category).toBe("backend");
    expect(upserted.score).toBe(9);

    const rowCount = db
      .query<{ readonly cnt: number }, []>(
        "SELECT COUNT(*) AS cnt FROM model_performance_runs WHERE turn_id = 'turn-1'",
      )
      .get();
    expect(rowCount?.cnt).toBe(1);
    db.close();
  });

  it("attaches ratings by delegationId, turnId, runId, and latest unrated threadId without clobbering telemetry", async () => {
    const { db, service, advanceMs } = makeHarness();

    const byDelegationMeasured = await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "claude",
        model: "claude-sonnet-4-5",
        delegationId: "del-1",
        durationMs: 4000,
        outputTokens: 400,
        costUsd: 0.3,
      }),
    );

    const ratedDelegation = await Effect.runPromise(
      service.rateRun({
        delegationId: "del-1",
        category: "  TypeScript-Refactor_With_Extra_Long_Category_Name_Beyond_48  ",
        score: 8.5,
        outcome: "partial",
        rework: "minor",
        notes: "Fixed minor lint warning",
      }),
    );
    expect(ratedDelegation.id).toBe(byDelegationMeasured.id);
    expect(ratedDelegation.tokensPerSecond).toBe(100);
    expect(ratedDelegation.durationMs).toBe(4000);
    expect(ratedDelegation.costUsd).toBe(0.3);
    expect(ratedDelegation.category).toBe("typescript-refactor_with_extra_long_category_nam");
    expect(ratedDelegation.category?.length).toBe(48);
    expect(ratedDelegation.rework).toBe("minor");
    expect(ratedDelegation.notes).toBe("Fixed minor lint warning");
    expect(ratedDelegation.ratedAt).toBeDefined();

    advanceMs(1000);
    const threadRun1 = await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "codex",
        model: "gpt-5.4",
        threadId: "thread-x",
        durationMs: 2000,
        outputTokens: 100,
        costUsd: 0.1,
      }),
    );
    advanceMs(1000);
    const threadRun2 = await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "codex",
        model: "gpt-5.4",
        threadId: "thread-x",
        durationMs: 3000,
        outputTokens: 150,
        costUsd: 0.2,
      }),
    );

    const latestRated = await Effect.runPromise(
      service.rateRun({
        threadId: "thread-x",
        category: "frontend",
        score: 10,
        outcome: "pass",
      }),
    );
    expect(latestRated.id).toBe(threadRun2.id);
    expect(latestRated.rework).toBe("none");

    const earlierRated = await Effect.runPromise(
      service.rateRun({
        threadId: "thread-x",
        category: "frontend",
        score: 7,
        outcome: "fail",
        rework: "major",
      }),
    );
    expect(earlierRated.id).toBe(threadRun1.id);

    const fetched = await Effect.runPromise(
      service.getRunByTurnOrDelegation({ delegationId: "del-1" }),
    );
    expect(fetched?.id).toBe(byDelegationMeasured.id);
    expect(fetched?.tokensPerSecond).toBe(100);

    const missing = await Effect.runPromise(
      service.getRunByTurnOrDelegation({ turnId: "does-not-exist" }),
    );
    expect(missing).toBeNull();

    const fallbackRated = await Effect.runPromise(
      service.rateRun({
        delegationId: "del-unmeasured",
        providerId: "antigravity",
        model: "gemini-4-neon",
        category: "planning",
        score: 9,
        outcome: "pass",
      }),
    );
    expect(fallbackRated.durationMs).toBe(0);
    expect(fallbackRated.tokensPerSecond).toBe(0);
    expect(fallbackRated.costUsd).toBe(0);
    expect(fallbackRated.category).toBe("planning");

    const notFoundExit = await Effect.runPromiseExit(
      service.rateRun({
        delegationId: "del-missing",
        category: "planning",
        score: 8,
        outcome: "pass",
      }),
    );
    expect(Exit.isFailure(notFoundExit)).toBe(true);
    db.close();
  });

  it("rejects out-of-bounds scores and empty categories", async () => {
    const { db, service } = makeHarness();

    const lowExit = await Effect.runPromiseExit(
      service.rateRun({
        providerId: "claude",
        model: "claude-opus-4-6",
        category: "backend",
        score: -0.1,
        outcome: "fail",
      }),
    );
    expect(Exit.isFailure(lowExit)).toBe(true);

    const highExit = await Effect.runPromiseExit(
      service.rateRun({
        providerId: "claude",
        model: "claude-opus-4-6",
        category: "backend",
        score: 10.1,
        outcome: "pass",
      }),
    );
    expect(Exit.isFailure(highExit)).toBe(true);

    const blankCategoryExit = await Effect.runPromiseExit(
      service.rateRun({
        providerId: "claude",
        model: "claude-opus-4-6",
        category: "   ",
        score: 8,
        outcome: "pass",
      }),
    );
    expect(Exit.isFailure(blankCategoryExit)).toBe(true);
    db.close();
  });

  it("aggregates exact overall and per-category stats, odd/even medians, filtering, and formatted summary lines", async () => {
    const dayMs = 86_400_000;
    const baseMs = Date.parse("2026-11-27T12:00:00.000Z");
    const { db, service, setNow } = makeHarness(baseMs - 40 * dayMs);

    // Outside 30d window
    await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "Gemini 4 Neon",
        turnId: "old-turn",
        durationMs: 1000,
        outputTokens: 500,
        costUsd: 1.0,
      }),
    );

    // 3 runs in backend for Gemini 4 Neon (odd count for median: [90, 105, 120] -> median 105, avg 105)
    setNow(baseMs - 2 * dayMs);
    await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "Gemini 4 Neon",
        turnId: "g-1",
        durationMs: 55_000,
        outputTokens: 5_775,
        costUsd: 0.45,
      }),
    );
    await Effect.runPromise(
      service.rateRun({ turnId: "g-1", category: "backend", score: 9, outcome: "pass" }),
    );

    setNow(baseMs - dayMs);
    await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "Gemini 4 Neon",
        turnId: "g-2",
        durationMs: 55_000,
        outputTokens: 4_950,
        costUsd: 0.45,
      }),
    );
    await Effect.runPromise(
      service.rateRun({ turnId: "g-2", category: "backend", score: 8, outcome: "pass" }),
    );

    setNow(baseMs - 3_600_000);
    await Effect.runPromise(
      service.recordMeasuredRun({
        providerId: "antigravity",
        model: "Gemini 4 Neon",
        turnId: "g-3",
        durationMs: 55_000,
        outputTokens: 6_600,
        costUsd: 0.45,
      }),
    );
    await Effect.runPromise(
      service.rateRun({ turnId: "g-3", category: "backend", score: 10, outcome: "pass" }),
    );

    // 4 runs for another model (even count for median: [40, 60, 80, 100] -> median 70, avg 70)
    const speeds = [40, 60, 80, 100];
    for (let i = 0; i < speeds.length; i++) {
      const turnId = `c-${i}`;
      await Effect.runPromise(
        service.recordMeasuredRun({
          providerId: "claude",
          model: "claude-sonnet",
          turnId,
          durationMs: 10_000,
          outputTokens: (speeds[i] ?? 0) * 10,
          costUsd: 0.25,
        }),
      );
      await Effect.runPromise(
        service.rateRun({
          turnId,
          category: "frontend",
          score: i === 0 ? 4 : 8,
          outcome: i === 0 ? "fail" : i === 1 ? "partial" : "pass",
          rework: i === 0 ? "major" : "none",
        }),
      );
    }

    setNow(baseMs);
    const summary = await Effect.runPromise(service.querySummary({ days: 30, limit: 5 }));

    expect(summary.categories).toEqual(["backend", "frontend"]);
    expect(summary.recentRuns.length).toBe(5);
    expect(summary.overall.length).toBe(2);

    const geminiBackend = summary.byCategory.find(
      (s) => s.model === "Gemini 4 Neon" && s.category === "backend",
    );
    expect(geminiBackend).toBeDefined();
    expect(geminiBackend?.attempts).toBe(3);
    expect(geminiBackend?.ratedCount).toBe(3);
    expect(geminiBackend?.passCount).toBe(3);
    expect(geminiBackend?.failCount).toBe(0);
    expect(geminiBackend?.passRate).toBe(1);
    expect(geminiBackend?.avgScore).toBe(9);
    expect(geminiBackend?.avgTokensPerSecond).toBe(105);
    expect(geminiBackend?.medianTokensPerSecond).toBe(105);
    expect(geminiBackend?.avgDurationMs).toBe(55_000);
    expect(geminiBackend?.avgCostUsd).toBeCloseTo(0.45, 6);
    expect(geminiBackend?.totalCostUsd).toBeCloseTo(1.35, 6);
    expect(geminiBackend?.reworkCounts).toEqual({ none: 3, minor: 0, major: 0 });
    expect(formatModelCategoryLine(geminiBackend!)).toBe(
      "Gemini 4 Neon — 9.0/10 on backend | 105.0 tok/s · 55.0s · $0.45 avg | 3 attempts (3 pass, 0 fail)",
    );

    const claudeFrontend = summary.byCategory.find(
      (s) => s.model === "claude-sonnet" && s.category === "frontend",
    );
    expect(claudeFrontend?.medianTokensPerSecond).toBe(70);
    expect(claudeFrontend?.avgTokensPerSecond).toBe(70);
    expect(claudeFrontend?.avgScore).toBe(7);
    expect(claudeFrontend?.passRate).toBe(0.5);
    expect(claudeFrontend?.partialCount).toBe(1);
    expect(claudeFrontend?.reworkCounts).toEqual({ none: 3, minor: 0, major: 1 });

    const backendOnly = await Effect.runPromise(
      service.querySummary({ category: "  BACKEND ", days: 30 }),
    );
    expect(backendOnly.overall.length).toBe(1);
    expect(backendOnly.overall[0]?.model).toBe("Gemini 4 Neon");
    expect(backendOnly.summaryLines?.[0]).toBe(
      "Gemini 4 Neon — 9.0/10 on backend | 105.0 tok/s · 55.0s · $0.45 avg | 3 attempts (3 pass, 0 fail)",
    );

    const withOld = await Effect.runPromise(
      service.querySummary({ model: "Gemini 4 Neon", days: 60 }),
    );
    expect(withOld.overall[0]?.attempts).toBe(4);
    expect(withOld.overall[0]?.ratedCount).toBe(3);

    expect(await Effect.runPromise(service.listCategories())).toEqual(["backend", "frontend"]);

    const firstId = backendOnly.recentRuns[0]?.id ?? "";
    expect(await Effect.runPromise(service.deleteRun(firstId))).toBe(true);
    expect(await Effect.runPromise(service.deleteRun(firstId))).toBe(false);
    db.close();
  });

  it("works through Effect Layer wired with SqliteDatabase", async () => {
    const configLayer = ServerConfig.layer({ dbPath: ":memory:" });
    const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
    const perfLayer = modelPerformanceLayer().pipe(Layer.provide(sqliteLayer));
    const testLayer = Layer.mergeAll(configLayer, sqliteLayer, perfLayer);

    const summary = await Effect.runPromise(
      Effect.gen(function* () {
        const perf = yield* ModelPerformanceService;
        yield* perf.recordMeasuredRun({
          providerId: "antigravity",
          model: "gemini-4-hydrogen",
          turnId: "layer-turn-1",
          durationMs: 1000,
          outputTokens: 120,
          costUsd: 0.02,
        });
        yield* perf.rateRun({
          turnId: "layer-turn-1",
          category: "testing",
          score: 9.5,
          outcome: "pass",
        });
        return yield* perf.querySummary();
      }).pipe(Effect.provide(testLayer)),
    );

    expect(summary.overall.length).toBe(1);
    expect(summary.overall[0]?.avgScore).toBe(9.5);
    expect(summary.overall[0]?.avgTokensPerSecond).toBe(120);
  });
});

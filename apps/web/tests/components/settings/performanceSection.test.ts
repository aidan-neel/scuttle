import { describe, expect, test } from "bun:test";
import type { ModelCategoryStats } from "@scuttle/contracts";
import {
  leaderboardFor,
  performanceKpis,
} from "../../../src/components/settings/PerformanceSection.tsx";

const stat = (model: string, overrides: Partial<ModelCategoryStats> = {}): ModelCategoryStats => ({
  providerId: "claude",
  model,
  category: "all",
  attempts: 4,
  ratedCount: 2,
  passCount: 2,
  partialCount: 0,
  failCount: 0,
  passRate: 1,
  avgScore: 7,
  avgTokensPerSecond: 40,
  medianTokensPerSecond: 38,
  avgDurationMs: 12_000,
  avgCostUsd: 0.1,
  totalCostUsd: 0.4,
  reworkCounts: { none: 2, minor: 0, major: 0 },
  lastRunAt: "2026-11-26T00:00:00.000Z",
  ...overrides,
});

describe("performanceKpis", () => {
  test("totals runs and picks the top rated and fastest models", () => {
    const kpis = performanceKpis([
      stat("opus", { avgScore: 9, medianTokensPerSecond: 30 }),
      stat("sonnet", { avgScore: 8, medianTokensPerSecond: 80, attempts: 6, ratedCount: 1 }),
    ]);
    expect(kpis.measuredRuns).toBe(10);
    expect(kpis.ratedRuns).toBe(3);
    expect(kpis.topRated?.model).toBe("opus");
    expect(kpis.fastest?.model).toBe("sonnet");
  });

  test("ignores unrated models when choosing the top rated one", () => {
    const kpis = performanceKpis([stat("fast-unrated", { ratedCount: 0, avgScore: 0 })]);
    expect(kpis.topRated).toBeNull();
    expect(kpis.fastest?.model).toBe("fast-unrated");
  });
});

describe("leaderboardFor", () => {
  const summary = {
    overall: [stat("b", { avgScore: 6 }), stat("a", { avgScore: 9 })],
    byCategory: [
      stat("a", { category: "ui", avgScore: 5 }),
      stat("b", { category: "ui", avgScore: 8 }),
      stat("c", { category: "infra" }),
    ],
  };

  test("uses overall stats for the all category, best score first", () => {
    expect(leaderboardFor(summary, "all").map((s) => s.model)).toEqual(["a", "b"]);
  });

  test("filters to one category when selected", () => {
    expect(leaderboardFor(summary, "ui").map((s) => s.model)).toEqual(["b", "a"]);
  });
});

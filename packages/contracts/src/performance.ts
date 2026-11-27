import * as Schema from "effect/Schema";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));
const NonNegFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const PosInt = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1));

export const PerfOutcome = Schema.Literals(["pass", "partial", "fail"]);
export type PerfOutcome = typeof PerfOutcome.Type;

export const PerfRework = Schema.Literals(["none", "minor", "major"]);
export type PerfRework = typeof PerfRework.Type;

export const PerfScore = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 10 }));
export type PerfScore = typeof PerfScore.Type;

export const PerfReworkCounts = Schema.Struct({
  none: Schema.Number,
  minor: Schema.Number,
  major: Schema.Number,
});
export type PerfReworkCounts = typeof PerfReworkCounts.Type;

export const ModelPerfRun = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(Schema.String),
  threadId: Schema.optionalKey(Schema.String),
  turnId: Schema.optionalKey(Schema.String),
  delegationId: Schema.optionalKey(Schema.String),
  durationMs: Schema.Number,
  firstTokenMs: Schema.optionalKey(Schema.Number),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  tokensPerSecond: Schema.Number,
  costUsd: Schema.Number,
  category: Schema.optionalKey(Schema.String),
  score: Schema.optionalKey(PerfScore),
  outcome: Schema.optionalKey(PerfOutcome),
  rework: Schema.optionalKey(PerfRework),
  notes: Schema.optionalKey(Schema.String),
  ratedAt: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
});
export type ModelPerfRun = typeof ModelPerfRun.Type;

export const RecordMeasuredRunInput = Schema.Struct({
  providerId: NonEmpty,
  model: NonEmpty,
  effort: Schema.optionalKey(Schema.String),
  threadId: Schema.optionalKey(Schema.String),
  turnId: Schema.optionalKey(Schema.String),
  delegationId: Schema.optionalKey(Schema.String),
  durationMs: NonNegFinite,
  firstTokenMs: Schema.optionalKey(NonNegFinite),
  inputTokens: Schema.optionalKey(NonNegFinite),
  outputTokens: Schema.optionalKey(NonNegFinite),
  cacheReadTokens: Schema.optionalKey(NonNegFinite),
  costUsd: Schema.optionalKey(NonNegFinite),
});
export type RecordMeasuredRunInput = typeof RecordMeasuredRunInput.Type;

export const RateModelRunInput = Schema.Struct({
  runId: Schema.optionalKey(Schema.String),
  turnId: Schema.optionalKey(Schema.String),
  delegationId: Schema.optionalKey(Schema.String),
  threadId: Schema.optionalKey(Schema.String),
  providerId: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  category: NonEmpty,
  score: PerfScore,
  outcome: PerfOutcome,
  rework: Schema.optionalKey(PerfRework),
  notes: Schema.optionalKey(Schema.String),
});
export type RateModelRunInput = typeof RateModelRunInput.Type;

export const ModelCategoryStats = Schema.Struct({
  providerId: Schema.String,
  model: Schema.String,
  category: Schema.String,
  attempts: Schema.Number,
  ratedCount: Schema.Number,
  passCount: Schema.Number,
  partialCount: Schema.Number,
  failCount: Schema.Number,
  passRate: Schema.Number,
  avgScore: Schema.Number,
  avgTokensPerSecond: Schema.Number,
  medianTokensPerSecond: Schema.Number,
  avgDurationMs: Schema.Number,
  avgCostUsd: Schema.Number,
  totalCostUsd: Schema.Number,
  reworkCounts: PerfReworkCounts,
  lastRunAt: Schema.String,
});
export type ModelCategoryStats = typeof ModelCategoryStats.Type;

export const ModelPerformanceSummary = Schema.Struct({
  generatedAt: Schema.String,
  days: Schema.Number,
  categories: Schema.Array(Schema.String),
  overall: Schema.Array(ModelCategoryStats),
  byCategory: Schema.Array(ModelCategoryStats),
  recentRuns: Schema.Array(ModelPerfRun),
  summaryLines: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type ModelPerformanceSummary = typeof ModelPerformanceSummary.Type;

export const ModelPerfQueryInput = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  providerId: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
  days: Schema.optionalKey(PosInt),
  limit: Schema.optionalKey(PosInt),
});
export type ModelPerfQueryInput = typeof ModelPerfQueryInput.Type;

export interface PerfRunLookup {
  readonly turnId?: string;
  readonly delegationId?: string;
  readonly threadId?: string;
}

export const computeTokensPerSecond = (
  outputTokens: number,
  durationMs: number,
  firstTokenMs?: number,
): number => {
  if (outputTokens <= 0 || durationMs <= 0) return 0;
  const ms = firstTokenMs && durationMs > firstTokenMs ? durationMs - firstTokenMs : durationMs;
  return ms > 0 ? Math.round((outputTokens / (ms / 1000)) * 10) / 10 : 0;
};

export const formatModelCategoryLine = (stat: ModelCategoryStats): string => {
  const score = stat.ratedCount > 0 ? `${stat.avgScore.toFixed(1)}/10` : "unrated";
  const scope = stat.category === "all" ? "overall" : `on ${stat.category}`;
  const metrics = `${stat.avgTokensPerSecond.toFixed(1)} tok/s · ${(stat.avgDurationMs / 1000).toFixed(1)}s · $${stat.avgCostUsd.toFixed(2)} avg`;
  const outcomes =
    stat.partialCount > 0
      ? `${stat.passCount} pass, ${stat.partialCount} partial, ${stat.failCount} fail`
      : `${stat.passCount} pass, ${stat.failCount} fail`;
  return `${stat.model} — ${score} ${scope} | ${metrics} | ${stat.attempts} ${stat.attempts === 1 ? "attempt" : "attempts"} (${outcomes})`;
};

export const normalizePerfCategory = (raw: string): string => raw.trim().toLowerCase().slice(0, 48);

export const medianNumber = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

export const compareModelCategoryStats = (a: ModelCategoryStats, b: ModelCategoryStats): number =>
  b.avgScore - a.avgScore ||
  b.passRate - a.passRate ||
  b.attempts - a.attempts ||
  b.avgTokensPerSecond - a.avgTokensPerSecond ||
  a.model.localeCompare(b.model) ||
  a.category.localeCompare(b.category);

export const formatPerformanceSummaryLines = (
  summary: Pick<ModelPerformanceSummary, "overall" | "byCategory">,
): ReadonlyArray<string> =>
  (summary.byCategory.length > 0 ? summary.byCategory : summary.overall).map(
    formatModelCategoryLine,
  );

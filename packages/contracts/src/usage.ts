import * as Schema from "effect/Schema";
import { ProviderKind } from "./provider.ts";

export const UsageRange = Schema.Literals(["24h", "7d", "30d", "90d"]);
export type UsageRange = typeof UsageRange.Type;

export const UsageProviderFilter = Schema.Union([ProviderKind, Schema.Literals(["all"])]);
export type UsageProviderFilter = typeof UsageProviderFilter.Type;

export const UsageGranularity = Schema.Literals(["hour", "day"]);
export type UsageGranularity = typeof UsageGranularity.Type;

export const UsageTotals = Schema.Struct({
  processedTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  costUsd: Schema.Number,
  cacheSavingsUsd: Schema.Number,
});
export type UsageTotals = typeof UsageTotals.Type;

export const UsageProviderSummary = Schema.Struct({
  providerKind: ProviderKind,
  sessions: Schema.Number,
  processedTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  costUsd: Schema.Number,
  share: Schema.Number,
});
export type UsageProviderSummary = typeof UsageProviderSummary.Type;

export const UsageModelSummary = Schema.Struct({
  providerKind: ProviderKind,
  model: Schema.String,
  sessions: Schema.Number,
  processedTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  costUsd: Schema.Number,
  share: Schema.Number,
});
export type UsageModelSummary = typeof UsageModelSummary.Type;

export const UsageProviderBucket = Schema.Struct({
  providerKind: ProviderKind,
  processedTokens: Schema.Number,
});
export type UsageProviderBucket = typeof UsageProviderBucket.Type;

export const UsageTimePoint = Schema.Struct({
  bucket: Schema.String,
  label: Schema.String,
  sessions: Schema.Number,
  processedTokens: Schema.Number,
  costUsd: Schema.Number,
  byProvider: Schema.Array(UsageProviderBucket),
});
export type UsageTimePoint = typeof UsageTimePoint.Type;

export const UsageReport = Schema.Struct({
  range: UsageRange,
  provider: UsageProviderFilter,
  granularity: UsageGranularity,
  sessions: Schema.Number,
  totals: UsageTotals,
  providers: Schema.Array(UsageProviderSummary),
  models: Schema.Array(UsageModelSummary),
  series: Schema.Array(UsageTimePoint),
  generatedAt: Schema.String,
  scanMs: Schema.Number,
  indexedFiles: Schema.Number,
  indexing: Schema.Boolean,
});
export type UsageReport = typeof UsageReport.Type;

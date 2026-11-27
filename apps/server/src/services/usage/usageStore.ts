import type { Database } from "bun:sqlite";
import type {
  ProviderKind,
  UsageModelSummary,
  UsageProviderFilter,
  UsageProviderSummary,
  UsageRange,
  UsageReport,
  UsageTimePoint,
} from "@scuttle/contracts";
import type { ScannedFileUsage } from "./jsonlFallback.ts";
import { estimateCacheSavingsUsd, estimateCostUsd } from "./pricing.ts";
import type { CachedSourceMeta } from "./sqliteSources.ts";

const VALID_PROVIDERS = new Set<ProviderKind>([
  "claude",
  "codex",
  "antigravity",
  "opencode",
  "copilot",
]);

const isProviderKind = (v: string): v is ProviderKind => VALID_PROVIDERS.has(v as ProviderKind);

export const RANGE_DAYS: Record<UsageRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const readCachedSourceMeta = (db: Database): Map<string, CachedSourceMeta> => {
  const rows = db
    .query<
      { readonly source_key: string; readonly mtime_ms: number; readonly size_bytes: number },
      []
    >("SELECT source_key, mtime_ms, size_bytes FROM usage_source_files")
    .all();
  const map = new Map<string, CachedSourceMeta>();
  for (const row of rows) {
    map.set(row.source_key, { mtimeMs: row.mtime_ms, sizeBytes: row.size_bytes });
  }
  return map;
};

export const writeScannedUsageBatch = (
  db: Database,
  items: ReadonlyArray<ScannedFileUsage>,
  pruneKeys?: ReadonlyArray<string>,
): void => {
  if (items.length === 0 && (!pruneKeys || pruneKeys.length === 0)) return;
  const now = new Date().toISOString();
  const upsertSource = db.query(
    `INSERT INTO usage_source_files (source_key, provider_kind, session_id, mtime_ms, size_bytes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       provider_kind = excluded.provider_kind,
       session_id = excluded.session_id,
       mtime_ms = excluded.mtime_ms,
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at`,
  );
  const deleteBuckets = db.query("DELETE FROM usage_buckets WHERE source_key = ?");
  const insertBucket = db.query(
    `INSERT INTO usage_buckets
       (source_key, provider_kind, model, bucket_hour, session_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteSource = db.query("DELETE FROM usage_source_files WHERE source_key = ?");

  const tx = db.transaction(() => {
    for (const item of items) {
      upsertSource.run(
        item.sourceKey,
        item.providerKind,
        item.sessionId,
        item.mtimeMs,
        item.sizeBytes,
        now,
      );
      deleteBuckets.run(item.sourceKey);
      for (const b of item.buckets) {
        insertBucket.run(
          item.sourceKey,
          item.providerKind,
          b.model,
          b.bucketHour,
          item.sessionId,
          b.inputTokens,
          b.outputTokens,
          b.cacheReadTokens,
          b.cacheWriteTokens,
          b.costUsd,
        );
      }
    }
    if (pruneKeys) {
      for (const key of pruneKeys) {
        deleteSource.run(key);
      }
    }
  });
  tx();
};

interface RawUsageRow {
  readonly providerKind: ProviderKind;
  readonly model: string;
  readonly bucketHour: string;
  readonly sessionId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
}

const readIndexedRows = (
  db: Database,
  startHour: string,
  provider: UsageProviderFilter,
): ReadonlyArray<RawUsageRow> => {
  type DbRow = {
    readonly provider_kind: string;
    readonly model: string;
    readonly bucket_hour: string;
    readonly session_id: string;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_tokens: number;
    readonly cache_write_tokens: number;
    readonly cost_usd: number;
  };
  const rows =
    provider === "all"
      ? db
          .query<DbRow, [string]>(
            `SELECT provider_kind, model, bucket_hour, session_id,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
             FROM usage_buckets
             WHERE bucket_hour >= ?`,
          )
          .all(startHour)
      : db
          .query<DbRow, [string, string]>(
            `SELECT provider_kind, model, bucket_hour, session_id,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
             FROM usage_buckets
             WHERE bucket_hour >= ? AND provider_kind = ?`,
          )
          .all(startHour, provider);

  const out: RawUsageRow[] = [];
  for (const r of rows) {
    if (!isProviderKind(r.provider_kind)) continue;
    out.push({
      providerKind: r.provider_kind,
      model: r.model,
      bucketHour: r.bucket_hour,
      sessionId: r.session_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
      costUsd: r.cost_usd,
    });
  }
  return out;
};

const readScuttleTurnRows = (
  db: Database,
  startIso: string,
  provider: UsageProviderFilter,
  indexedSessions: ReadonlySet<string>,
): ReadonlyArray<RawUsageRow> => {
  type TurnDbRow = {
    readonly thread_id: string;
    readonly provider_session_id: string | null;
    readonly started_at: string;
    readonly cost_usd: number;
    readonly usage_json: string | null;
    readonly model_selection_json: string;
  };
  const rows = db
    .query<TurnDbRow, [string]>(
      `SELECT t.thread_id, th.provider_session_id, t.started_at, t.cost_usd, t.usage_json, t.model_selection_json
       FROM turns t
       JOIN threads th ON th.id = t.thread_id
       WHERE t.started_at >= ? AND t.usage_json IS NOT NULL`,
    )
    .all(startIso);

  const out: RawUsageRow[] = [];
  for (const r of rows) {
    if (!r.usage_json) continue;
    let ms: unknown;
    let usage: unknown;
    try {
      ms = JSON.parse(r.model_selection_json);
      usage = JSON.parse(r.usage_json);
    } catch {
      continue;
    }
    if (typeof ms !== "object" || ms === null || typeof usage !== "object" || usage === null) {
      continue;
    }
    const msRec = ms as Record<string, unknown>;
    const usageRec = usage as Record<string, unknown>;
    const pk = typeof msRec.providerKind === "string" ? msRec.providerKind : "";
    if (!isProviderKind(pk)) continue;
    if (provider !== "all" && pk !== provider) continue;
    if (r.provider_session_id && indexedSessions.has(`${pk}:${r.provider_session_id}`)) {
      continue;
    }
    const model = typeof msRec.model === "string" && msRec.model.length > 0 ? msRec.model : pk;
    const inputTokens =
      typeof usageRec.inputTokens === "number" && usageRec.inputTokens > 0
        ? Math.floor(usageRec.inputTokens)
        : 0;
    const outputTokens =
      typeof usageRec.outputTokens === "number" && usageRec.outputTokens > 0
        ? Math.floor(usageRec.outputTokens)
        : 0;
    const cacheReadTokens =
      typeof usageRec.cacheReadTokens === "number" && usageRec.cacheReadTokens > 0
        ? Math.floor(usageRec.cacheReadTokens)
        : 0;
    const cacheWriteTokens =
      typeof usageRec.cacheCreationTokens === "number" && usageRec.cacheCreationTokens > 0
        ? Math.floor(usageRec.cacheCreationTokens)
        : 0;
    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheWriteTokens === 0
    ) {
      continue;
    }
    out.push({
      providerKind: pk,
      model,
      bucketHour: r.started_at.slice(0, 13),
      sessionId: r.provider_session_id || `scuttle:${r.thread_id}`,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd: r.cost_usd > 0 ? r.cost_usd : 0,
    });
  }
  return out;
};

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const formatDayLabel = (dayKey: string): string => {
  const monthIdx = Number.parseInt(dayKey.slice(5, 7), 10) - 1;
  const day = Number.parseInt(dayKey.slice(8, 10), 10);
  return `${MONTH_SHORT[monthIdx] ?? ""} ${day}`.trim();
};

const formatHourLabel = (hourKey: string): string => {
  const hour = Number.parseInt(hourKey.slice(11, 13), 10);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${suffix}`;
};

const buildTimelineKeys = (
  range: UsageRange,
  nowMs: number,
): ReadonlyArray<{ readonly key: string; readonly label: string }> => {
  const list: Array<{ key: string; label: string }> = [];
  if (range === "24h") {
    const endHour = Math.floor(nowMs / 3_600_000) * 3_600_000;
    for (let i = 23; i >= 0; i -= 1) {
      const key = new Date(endHour - i * 3_600_000).toISOString().slice(0, 13);
      list.push({ key, label: formatHourLabel(key) });
    }
    return list;
  }
  const days = RANGE_DAYS[range];
  const endDay = Math.floor(nowMs / 86_400_000) * 86_400_000;
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = new Date(endDay - i * 86_400_000).toISOString().slice(0, 10);
    list.push({ key, label: formatDayLabel(key) });
  }
  return list;
};

export const queryUsageReport = (
  db: Database,
  params: {
    readonly range: UsageRange;
    readonly provider: UsageProviderFilter;
    readonly nowMs: number;
    readonly scanMs: number;
    readonly indexing: boolean;
  },
): UsageReport => {
  const timeline = buildTimelineKeys(params.range, params.nowMs);
  const firstKey = timeline[0]!.key;
  const startHour = params.range === "24h" ? firstKey : `${firstKey}T00`;
  const startIso = `${startHour}:00:00.000Z`;

  const indexedRows = readIndexedRows(db, startHour, params.provider);
  const indexedSessions = new Set<string>();
  for (const r of indexedRows) {
    indexedSessions.add(`${r.providerKind}:${r.sessionId}`);
  }
  const scuttleRows = readScuttleTurnRows(db, startIso, params.provider, indexedSessions);
  const allRows = [...indexedRows, ...scuttleRows];

  const allSessions = new Set<string>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCostUsd = 0;
  let totalCacheSavingsUsd = 0;

  const providerMap = new Map<
    ProviderKind,
    {
      sessions: Set<string>;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      costUsd: number;
    }
  >();

  const modelMap = new Map<
    string,
    {
      providerKind: ProviderKind;
      model: string;
      sessions: Set<string>;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      costUsd: number;
    }
  >();

  const seriesMap = new Map<
    string,
    {
      sessions: Set<string>;
      processedTokens: number;
      costUsd: number;
      byProvider: Map<ProviderKind, number>;
    }
  >();
  for (const slot of timeline) {
    seriesMap.set(slot.key, {
      sessions: new Set(),
      processedTokens: 0,
      costUsd: 0,
      byProvider: new Map(),
    });
  }

  for (const row of allRows) {
    const processed =
      row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens;
    if (processed <= 0) continue;
    const costUsd =
      row.costUsd > 0
        ? row.costUsd
        : estimateCostUsd(row.model, {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheWriteTokens: row.cacheWriteTokens,
          });
    const savingsUsd = estimateCacheSavingsUsd(row.model, row.cacheReadTokens);
    const sessionKey = `${row.providerKind}:${row.sessionId}`;

    allSessions.add(sessionKey);
    totalInput += row.inputTokens;
    totalOutput += row.outputTokens;
    totalCacheRead += row.cacheReadTokens;
    totalCacheWrite += row.cacheWriteTokens;
    totalCostUsd += costUsd;
    totalCacheSavingsUsd += savingsUsd;

    const pEntry = providerMap.get(row.providerKind) ?? {
      sessions: new Set<string>(),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };
    pEntry.sessions.add(row.sessionId);
    pEntry.inputTokens += row.inputTokens;
    pEntry.outputTokens += row.outputTokens;
    pEntry.cacheReadTokens += row.cacheReadTokens;
    pEntry.cacheWriteTokens += row.cacheWriteTokens;
    pEntry.costUsd += costUsd;
    providerMap.set(row.providerKind, pEntry);

    const mKey = `${row.providerKind}\0${row.model}`;
    const mEntry = modelMap.get(mKey) ?? {
      providerKind: row.providerKind,
      model: row.model,
      sessions: new Set<string>(),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };
    mEntry.sessions.add(row.sessionId);
    mEntry.inputTokens += row.inputTokens;
    mEntry.outputTokens += row.outputTokens;
    mEntry.cacheReadTokens += row.cacheReadTokens;
    mEntry.cacheWriteTokens += row.cacheWriteTokens;
    mEntry.costUsd += costUsd;
    modelMap.set(mKey, mEntry);

    const slotKey = params.range === "24h" ? row.bucketHour : row.bucketHour.slice(0, 10);
    const slot = seriesMap.get(slotKey);
    if (slot) {
      slot.sessions.add(sessionKey);
      slot.processedTokens += processed;
      slot.costUsd += costUsd;
      slot.byProvider.set(
        row.providerKind,
        (slot.byProvider.get(row.providerKind) ?? 0) + processed,
      );
    }
  }

  const totalProcessed = totalInput + totalOutput + totalCacheRead + totalCacheWrite;

  const providers: UsageProviderSummary[] = Array.from(providerMap.entries())
    .map(([providerKind, p]) => {
      const processedTokens =
        p.inputTokens + p.outputTokens + p.cacheReadTokens + p.cacheWriteTokens;
      return {
        providerKind,
        sessions: p.sessions.size,
        processedTokens,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        cacheReadTokens: p.cacheReadTokens,
        cacheWriteTokens: p.cacheWriteTokens,
        costUsd: p.costUsd,
        share: totalProcessed > 0 ? processedTokens / totalProcessed : 0,
      };
    })
    .toSorted((a, b) => b.processedTokens - a.processedTokens);

  const models: UsageModelSummary[] = Array.from(modelMap.values())
    .map((m) => {
      const processedTokens =
        m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens;
      return {
        providerKind: m.providerKind,
        model: m.model,
        sessions: m.sessions.size,
        processedTokens,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
        costUsd: m.costUsd,
        share: totalProcessed > 0 ? processedTokens / totalProcessed : 0,
      };
    })
    .toSorted((a, b) => b.processedTokens - a.processedTokens);

  const series: UsageTimePoint[] = timeline.map((slot) => {
    const agg = seriesMap.get(slot.key)!;
    return {
      bucket: slot.key,
      label: slot.label,
      sessions: agg.sessions.size,
      processedTokens: agg.processedTokens,
      costUsd: agg.costUsd,
      byProvider: Array.from(agg.byProvider.entries())
        .map(([providerKind, processedTokens]) => ({ providerKind, processedTokens }))
        .toSorted((a, b) => b.processedTokens - a.processedTokens),
    };
  });

  const indexedCountRow = db
    .query<{ readonly n: number }, []>("SELECT COUNT(*) AS n FROM usage_source_files")
    .get();

  return {
    range: params.range,
    provider: params.provider,
    granularity: params.range === "24h" ? "hour" : "day",
    sessions: allSessions.size,
    totals: {
      processedTokens: totalProcessed,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      costUsd: totalCostUsd,
      cacheSavingsUsd: totalCacheSavingsUsd,
    },
    providers,
    models,
    series,
    generatedAt: new Date(params.nowMs).toISOString(),
    scanMs: Math.max(0, Math.round(params.scanMs)),
    indexedFiles: indexedCountRow?.n ?? 0,
    indexing: params.indexing,
  };
};

import { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ScannedBucket, ScannedFileUsage } from "./jsonlFallback.ts";

export interface CachedSourceMeta {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asNonNegInt = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

const asNonNegFloat = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const toUtcBucketHour = (ms: number): string | null => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 13);
};

export const scanOpenCodeDatabase = (
  dbPath: string,
  cutoffMs: number,
  cached: ReadonlyMap<string, CachedSourceMeta>,
  canSkipUnchanged = true,
): {
  readonly updated: ReadonlyArray<ScannedFileUsage>;
  readonly activeKeys: ReadonlySet<string>;
  readonly skippedUnchanged: boolean;
} => {
  const activeKeys = new Set<string>();
  const updated: ScannedFileUsage[] = [];
  if (!NodeFS.existsSync(dbPath)) return { updated, activeKeys, skippedUnchanged: false };

  let sigMtime = 0;
  let sigSize = 0;
  try {
    const mainStat = NodeFS.statSync(dbPath);
    sigMtime = Math.floor(mainStat.mtimeMs);
    sigSize = mainStat.size;
    const walPath = `${dbPath}-wal`;
    if (NodeFS.existsSync(walPath)) {
      const walStat = NodeFS.statSync(walPath);
      sigMtime = Math.max(sigMtime, Math.floor(walStat.mtimeMs));
      sigSize += walStat.size;
    }
  } catch {
    return { updated, activeKeys, skippedUnchanged: false };
  }

  const metaKey = `opencode:__db__:${dbPath}`;
  activeKeys.add(metaKey);
  const prevMeta = cached.get(metaKey);
  if (
    canSkipUnchanged &&
    prevMeta &&
    prevMeta.mtimeMs === sigMtime &&
    prevMeta.sizeBytes === sigSize
  ) {
    return { updated, activeKeys, skippedUnchanged: true };
  }

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const sessions = db
      .query<{ readonly id: string; readonly time_updated: number }, [number]>(
        "SELECT id, time_updated FROM session WHERE time_updated >= ?",
      )
      .all(cutoffMs);

    const changedSessionIds: Array<{ id: string; timeUpdated: number; sourceKey: string }> = [];
    for (const s of sessions) {
      const sourceKey = `opencode:${s.id}`;
      activeKeys.add(sourceKey);
      const prev = cached.get(sourceKey);
      if (prev && prev.mtimeMs === s.time_updated) continue;
      changedSessionIds.push({ id: s.id, timeUpdated: s.time_updated, sourceKey });
    }

    updated.push({
      sourceKey: metaKey,
      providerKind: "opencode",
      sessionId: "__db__",
      mtimeMs: sigMtime,
      sizeBytes: sigSize,
      buckets: [],
    });

    if (changedSessionIds.length === 0) return { updated, activeKeys, skippedUnchanged: false };

    const msgStmt = db.query<{ readonly time_created: number; readonly data: string }, [string]>(
      "SELECT time_created, data FROM message WHERE session_id = ?",
    );

    for (const session of changedSessionIds) {
      const rows = msgStmt.all(session.id);
      const agg = new Map<
        string,
        {
          model: string;
          bucketHour: string;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          costUsd: number;
        }
      >();

      for (const row of rows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.data);
        } catch {
          continue;
        }
        if (!isRecord(parsed) || parsed.role !== "assistant" || !isRecord(parsed.tokens)) continue;
        const tokens = parsed.tokens;
        const cache = isRecord(tokens.cache) ? tokens.cache : null;
        const input = asNonNegInt(tokens.input);
        const output = asNonNegInt(tokens.output) + asNonNegInt(tokens.reasoning);
        const cacheRead = cache ? asNonNegInt(cache.read) : 0;
        const cacheWrite = cache ? asNonNegInt(cache.write) : 0;
        if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;

        const model =
          typeof parsed.modelID === "string" && parsed.modelID.length > 0
            ? parsed.modelID
            : "opencode";
        const hour = toUtcBucketHour(row.time_created);
        if (!hour) continue;

        const key = `${model}\0${hour}`;
        const existing = agg.get(key);
        const cost = asNonNegFloat(parsed.cost);
        if (existing) {
          existing.inputTokens += input;
          existing.outputTokens += output;
          existing.cacheReadTokens += cacheRead;
          existing.cacheWriteTokens += cacheWrite;
          existing.costUsd += cost;
        } else {
          agg.set(key, {
            model,
            bucketHour: hour,
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            costUsd: cost,
          });
        }
      }

      updated.push({
        sourceKey: session.sourceKey,
        providerKind: "opencode",
        sessionId: session.id,
        mtimeMs: session.timeUpdated,
        sizeBytes: rows.length,
        buckets: Array.from(agg.values()),
      });
    }
  } catch {
    // Ignore locked or incompatible OpenCode DB.
  } finally {
    db?.close();
  }

  return { updated, activeKeys, skippedUnchanged: false };
};

interface ProtoField {
  readonly field: number;
  readonly wire: number;
  readonly varint: number;
  readonly bytes?: Uint8Array;
}

const readProtoFields = (buf: Uint8Array): ReadonlyArray<ProtoField> => {
  const fields: ProtoField[] = [];
  let i = 0;
  while (i < buf.length) {
    let tag = 0;
    let shift = 0;
    while (i < buf.length && shift < 35) {
      const b = buf[i++]!;
      tag |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 0) break;

    if (wire === 0) {
      let val = 0;
      let mul = 1;
      while (i < buf.length) {
        const b = buf[i++]!;
        val += (b & 0x7f) * mul;
        if ((b & 0x80) === 0) break;
        mul *= 128;
      }
      fields.push({ field, wire, varint: val });
    } else if (wire === 2) {
      let len = 0;
      let s = 0;
      while (i < buf.length && s < 35) {
        const b = buf[i++]!;
        len |= (b & 0x7f) << s;
        if ((b & 0x80) === 0) break;
        s += 7;
      }
      if (len < 0 || i + len > buf.length) break;
      fields.push({ field, wire, varint: 0, bytes: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      break;
    }
  }
  return fields;
};

const ANTIGRAVITY_MODEL_ENUMS: Readonly<Record<number, string>> = {
  1532: "gemini-4-neon",
  1533: "gemini-4-hydrogen",
  1534: "gemini-4-carbon",
  1535: "gemini-4-argon",
};

const extractAntigravityModelMap = (db: Database): ReadonlyMap<number, string> => {
  const map = new Map<number, string>();
  try {
    const rows = db
      .query<{ readonly data: Uint8Array | null }, []>(
        "SELECT data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx DESC LIMIT 4",
      )
      .all();
    for (const row of rows) {
      if (!row.data) continue;
      const text = Buffer.from(row.data).toString("latin1");
      const enumMatch = /MODEL_PLACEHOLDER_M(\d+)/.exec(text);
      const nameMatch = /(Gemini\s+[0-9.]+\s+[A-Za-z]+|Claude\s+[A-Za-z]+\s+[0-9.]+)/.exec(text);
      if (enumMatch && nameMatch) {
        const code = Number.parseInt(enumMatch[1]!, 10) + 1000;
        const slug = nameMatch[1]!.toLowerCase().replace(/\s+/g, "-");
        map.set(code, slug);
      }
    }
  } catch {
    // Ignore missing gen_metadata.
  }
  return map;
};

const readAntigravityStepCounts = (convDir: string): ReadonlyMap<string, number> | null => {
  const summaryPath = NodePath.join(NodePath.dirname(convDir), "conversation_summaries.db");
  if (!NodeFS.existsSync(summaryPath)) return null;
  let db: Database | null = null;
  try {
    db = new Database(summaryPath, { readonly: true });
    const rows = db
      .query<{ readonly conversation_id: string; readonly step_count: number }, []>(
        "SELECT conversation_id, step_count FROM conversation_summaries",
      )
      .all();
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.conversation_id, row.step_count);
    }
    return map;
  } catch {
    return null;
  } finally {
    db?.close();
  }
};

export const scanAntigravityDir = (
  convDir: string,
  cutoffMs: number,
  cached: ReadonlyMap<string, CachedSourceMeta>,
): {
  readonly updated: ReadonlyArray<ScannedFileUsage>;
  readonly activeKeys: ReadonlySet<string>;
} => {
  const activeKeys = new Set<string>();
  const updated: ScannedFileUsage[] = [];
  if (!NodeFS.existsSync(convDir)) return { updated, activeKeys };

  let entries: NodeFS.Dirent[];
  try {
    entries = NodeFS.readdirSync(convDir, { withFileTypes: true });
  } catch {
    return { updated, activeKeys };
  }

  const stepCounts = readAntigravityStepCounts(convDir);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".db")) continue;
    const sessionId = entry.name.slice(0, -3);
    if (stepCounts !== null && stepCounts.get(sessionId) === 0) continue;
    const fullPath = NodePath.join(convDir, entry.name);
    let stat: NodeFS.Stats;
    try {
      stat = NodeFS.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < cutoffMs) continue;
    const mtimeMs = Math.floor(stat.mtimeMs);
    activeKeys.add(fullPath);
    const prev = cached.get(fullPath);
    if (prev && prev.mtimeMs === mtimeMs && prev.sizeBytes === stat.size) continue;
    const agg = new Map<
      string,
      {
        model: string;
        bucketHour: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        costUsd: number;
      }
    >();

    let db: Database | null = null;
    try {
      db = new Database(fullPath, { readonly: true });
      const rows = db
        .query<{ readonly metadata: Uint8Array | null }, []>(
          "SELECT metadata FROM steps WHERE metadata IS NOT NULL AND length(metadata) > 24",
        )
        .all();
      if (rows.length > 0) {
        const modelMap = extractAntigravityModelMap(db);
        for (const row of rows) {
          if (!row.metadata) continue;
          const top = readProtoFields(row.metadata);
          const usageBlob = top.find((f) => f.field === 9 && f.bytes)?.bytes;
          if (!usageBlob) continue;
          const usageFields = readProtoFields(usageBlob);
          const input = usageFields.find((f) => f.field === 2 && f.wire === 0)?.varint ?? 0;
          const output = usageFields.find((f) => f.field === 3 && f.wire === 0)?.varint ?? 0;
          const cacheRead = usageFields.find((f) => f.field === 5 && f.wire === 0)?.varint ?? 0;
          if (input === 0 && output === 0 && cacheRead === 0) continue;

          const tsBlob = top.find((f) => f.field === 1 && f.bytes)?.bytes;
          const tsSec = tsBlob
            ? (readProtoFields(tsBlob).find((f) => f.field === 1 && f.wire === 0)?.varint ?? 0)
            : 0;
          const hour = toUtcBucketHour(tsSec > 0 ? tsSec * 1000 : mtimeMs);
          if (!hour) continue;

          const modelEnum = usageFields.find((f) => f.field === 1 && f.wire === 0)?.varint ?? 0;
          const model =
            modelMap.get(modelEnum) ??
            ANTIGRAVITY_MODEL_ENUMS[modelEnum] ??
            (modelEnum > 0 ? `antigravity-${modelEnum}` : "antigravity");

          const key = `${model}\0${hour}`;
          const existing = agg.get(key);
          if (existing) {
            existing.inputTokens += input;
            existing.outputTokens += output;
            existing.cacheReadTokens += cacheRead;
          } else {
            agg.set(key, {
              model,
              bucketHour: hour,
              inputTokens: input,
              outputTokens: output,
              cacheReadTokens: cacheRead,
              cacheWriteTokens: 0,
              costUsd: 0,
            });
          }
        }
      }
    } catch {
      // Ignore unreadable or non-trajectory DBs.
    } finally {
      db?.close();
    }

    const buckets: ScannedBucket[] = Array.from(agg.values());
    updated.push({
      sourceKey: fullPath,
      providerKind: "antigravity",
      sessionId,
      mtimeMs,
      sizeBytes: stat.size,
      buckets,
    });
  }

  return { updated, activeKeys };
};

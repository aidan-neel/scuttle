import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import type { ProviderKind } from "@scuttle/contracts";

export interface ScannedBucket {
  readonly model: string;
  readonly bucketHour: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
}

export interface ScannedFileUsage {
  readonly sourceKey: string;
  readonly providerKind: ProviderKind;
  readonly sessionId: string;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly buckets: ReadonlyArray<ScannedBucket>;
}

export interface JsonlScanJob {
  readonly providerKind: "claude" | "codex";
  readonly path: string;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asNonNegInt = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

const asNonNegFloat = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const bucketHourFromIso = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw.length < 13) return null;
  if (raw[4] !== "-" || raw[7] !== "-" || raw[10] !== "T") return null;
  return raw.slice(0, 13);
};

const fallbackSessionId = (filePath: string): string => {
  const base = NodePath.basename(filePath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

export const scanClaudeJsonlFallback = async (job: JsonlScanJob): Promise<ScannedFileUsage> => {
  let sessionId = fallbackSessionId(job.path);
  let fallbackSeq = 0;
  const deduped = new Map<
    string,
    {
      model: string;
      hour: string;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      costUsd: number;
    }
  >();

  try {
    const stream = NodeFS.createReadStream(job.path, {
      encoding: "utf8",
      highWaterMark: 256 * 1024,
    });
    const rl = NodeReadline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      const msg = isRecord(parsed.message) ? parsed.message : null;
      const usage = msg && isRecord(msg.usage) ? msg.usage : null;
      if (!msg || !usage) continue;
      const model = typeof msg.model === "string" ? msg.model : "";
      if (model.length === 0 || model === "<synthetic>") continue;
      const hour = bucketHourFromIso(parsed.timestamp);
      if (!hour) continue;
      if (typeof parsed.sessionId === "string" && parsed.sessionId.length > 0) {
        sessionId = parsed.sessionId;
      }

      const input = asNonNegInt(usage.input_tokens);
      const output = asNonNegInt(usage.output_tokens);
      const cacheRead = asNonNegInt(usage.cache_read_input_tokens);
      const cacheWrite = asNonNegInt(usage.cache_creation_input_tokens);
      if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;

      const msgId = typeof msg.id === "string" && msg.id.length > 0 ? msg.id : null;
      const reqId =
        typeof parsed.requestId === "string" && parsed.requestId.length > 0
          ? parsed.requestId
          : null;
      const key = msgId ?? reqId ?? `seq:${++fallbackSeq}`;
      deduped.set(key, {
        model,
        hour,
        input,
        output,
        cacheRead,
        cacheWrite,
        costUsd: asNonNegFloat(parsed.costUSD),
      });
    }
  } catch {
    // Ignore unreadable files.
  }

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
  for (const entry of deduped.values()) {
    const k = `${entry.model}\0${entry.hour}`;
    const existing = agg.get(k);
    if (existing) {
      existing.inputTokens += entry.input;
      existing.outputTokens += entry.output;
      existing.cacheReadTokens += entry.cacheRead;
      existing.cacheWriteTokens += entry.cacheWrite;
      existing.costUsd += entry.costUsd;
    } else {
      agg.set(k, {
        model: entry.model,
        bucketHour: entry.hour,
        inputTokens: entry.input,
        outputTokens: entry.output,
        cacheReadTokens: entry.cacheRead,
        cacheWriteTokens: entry.cacheWrite,
        costUsd: entry.costUsd,
      });
    }
  }

  return {
    sourceKey: job.path,
    providerKind: "claude",
    sessionId,
    mtimeMs: job.mtimeMs,
    sizeBytes: job.sizeBytes,
    buckets: Array.from(agg.values()),
  };
};

export const scanCodexJsonlFallback = async (job: JsonlScanJob): Promise<ScannedFileUsage> => {
  let sessionId = fallbackSessionId(job.path);
  let currentModel = "codex";
  let prevIn = 0;
  let prevCached = 0;
  let prevCw = 0;
  let prevOut = 0;
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

  try {
    const stream = NodeFS.createReadStream(job.path, {
      encoding: "utf8",
      highWaterMark: 256 * 1024,
    });
    const rl = NodeReadline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const isMeta = line.includes('"session_meta"');
      const isTurn = line.includes('"turn_context"');
      const isCount = line.includes('"token_count"');
      if (!isMeta && !isTurn && !isCount) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed) || !isRecord(parsed.payload)) continue;
      const payload = parsed.payload;

      if (isMeta && typeof payload.id === "string" && payload.id.length > 0) {
        sessionId = payload.id;
        continue;
      }
      if (isTurn && typeof payload.model === "string" && payload.model.length > 0) {
        currentModel = payload.model;
        continue;
      }
      if (!isCount || !isRecord(payload.info) || !isRecord(payload.info.total_token_usage)) {
        continue;
      }
      const hour = bucketHourFromIso(parsed.timestamp);
      if (!hour) continue;
      const total = payload.info.total_token_usage;
      const totIn = asNonNegInt(total.input_tokens);
      const totCached = asNonNegInt(total.cached_input_tokens);
      const totCw = asNonNegInt(total.cache_write_input_tokens);
      const totOut = asNonNegInt(total.output_tokens);
      if (totIn <= prevIn && totCached <= prevCached && totCw <= prevCw && totOut <= prevOut) {
        continue;
      }
      const deltaRawIn = Math.max(0, totIn - prevIn);
      const deltaCached = Math.max(0, totCached - prevCached);
      const deltaCw = Math.max(0, totCw - prevCw);
      const deltaOut = Math.max(0, totOut - prevOut);
      prevIn = totIn;
      prevCached = totCached;
      prevCw = totCw;
      prevOut = totOut;

      const deltaUncachedIn = Math.max(0, deltaRawIn - deltaCached);
      const k = `${currentModel}\0${hour}`;
      const existing = agg.get(k);
      if (existing) {
        existing.inputTokens += deltaUncachedIn;
        existing.outputTokens += deltaOut;
        existing.cacheReadTokens += deltaCached;
        existing.cacheWriteTokens += deltaCw;
      } else {
        agg.set(k, {
          model: currentModel,
          bucketHour: hour,
          inputTokens: deltaUncachedIn,
          outputTokens: deltaOut,
          cacheReadTokens: deltaCached,
          cacheWriteTokens: deltaCw,
          costUsd: 0,
        });
      }
    }
  } catch {
    // Ignore unreadable files.
  }

  return {
    sourceKey: job.path,
    providerKind: "codex",
    sessionId,
    mtimeMs: job.mtimeMs,
    sizeBytes: job.sizeBytes,
    buckets: Array.from(agg.values()),
  };
};

const resolveNativeScannerBinary = (): string | null => {
  const envBin = process.env.SCUTTLE_NATIVE_BIN?.trim();
  if (envBin && NodeFS.existsSync(envBin)) return envBin;
  const exe = process.platform === "win32" ? "scuttle-native.exe" : "scuttle-native";
  const repoRoot = NodePath.resolve(import.meta.dir, "../../../../..");
  const candidates = [
    NodePath.join(repoRoot, "target/release", exe),
    NodePath.join(repoRoot, "target/debug", exe),
    NodePath.join(process.cwd(), "target/release", exe),
    NodePath.join(process.cwd(), "target/debug", exe),
  ];
  for (const candidate of candidates) {
    if (NodeFS.existsSync(candidate)) return candidate;
  }
  return null;
};

interface NativeLine {
  readonly path?: unknown;
  readonly provider?: unknown;
  readonly sessionId?: unknown;
  readonly buckets?: unknown;
}

const parseNativeOutput = (
  stdout: string,
  jobsByPath: ReadonlyMap<string, JsonlScanJob>,
): ReadonlyArray<ScannedFileUsage> => {
  const results: ScannedFileUsage[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    let raw: NativeLine;
    try {
      raw = JSON.parse(line) as NativeLine;
    } catch {
      continue;
    }
    if (typeof raw.path !== "string") continue;
    const job = jobsByPath.get(raw.path);
    if (!job) continue;
    const sessionId =
      typeof raw.sessionId === "string" && raw.sessionId.length > 0
        ? raw.sessionId
        : fallbackSessionId(job.path);
    const buckets: ScannedBucket[] = [];
    if (Array.isArray(raw.buckets)) {
      for (const b of raw.buckets) {
        if (!isRecord(b)) continue;
        if (typeof b.model !== "string" || typeof b.hour !== "string") continue;
        buckets.push({
          model: b.model,
          bucketHour: b.hour,
          inputTokens: asNonNegInt(b.in),
          outputTokens: asNonNegInt(b.out),
          cacheReadTokens: asNonNegInt(b.cr),
          cacheWriteTokens: asNonNegInt(b.cw),
          costUsd: asNonNegFloat(b.cost),
        });
      }
    }
    results.push({
      sourceKey: job.path,
      providerKind: job.providerKind,
      sessionId,
      mtimeMs: job.mtimeMs,
      sizeBytes: job.sizeBytes,
      buckets,
    });
  }
  return results;
};

export const scanJsonlBatch = async (
  jobs: ReadonlyArray<JsonlScanJob>,
  options?: { readonly disableNative?: boolean },
): Promise<ReadonlyArray<ScannedFileUsage>> => {
  if (jobs.length === 0) return [];
  const nativeBin = options?.disableNative ? null : resolveNativeScannerBinary();
  if (nativeBin !== null) {
    try {
      const stdinPayload = `${jobs.map((j) => `${j.providerKind}\t${j.path}`).join("\n")}\n`;
      const proc = Bun.spawn([nativeBin, "scan-usage"], {
        stdin: new Blob([stdinPayload]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      if (exitCode === 0) {
        const jobsByPath = new Map(jobs.map((j) => [j.path, j]));
        const parsed = parseNativeOutput(stdout, jobsByPath);
        if (parsed.length === jobs.length) {
          return parsed;
        }
      }
    } catch {
      // Fall back to TypeScript scanner below.
    }
  }

  const concurrency = Math.min(6, jobs.length);
  const results: ScannedFileUsage[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++]!;
        results.push(
          job.providerKind === "claude"
            ? await scanClaudeJsonlFallback(job)
            : await scanCodexJsonlFallback(job),
        );
      }
    }),
  );
  return results;
};

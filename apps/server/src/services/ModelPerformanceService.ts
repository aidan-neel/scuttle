import type { Database } from "bun:sqlite";
import * as Crypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  compareModelCategoryStats as compareStats,
  computeTokensPerSecond,
  formatModelCategoryLine,
  formatPerformanceSummaryLines,
  medianNumber as median,
  type ModelCategoryStats,
  ModelPerfQueryInput,
  type ModelPerfRun,
  type ModelPerformanceSummary,
  normalizePerfCategory as normalizeCategory,
  type PerfOutcome,
  type PerfRework,
  type PerfRunLookup as RunLookup,
  RateModelRunInput,
  RecordMeasuredRunInput,
} from "../../../../packages/contracts/src/performance.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { estimateCostUsd } from "./usage/pricing.ts";

export { computeTokensPerSecond, formatModelCategoryLine, formatPerformanceSummaryLines };
export type { RunLookup };

export const ModelPerformanceErrorReason = Schema.Literals(["invalid", "not-found", "database"]);
export type ModelPerformanceErrorReason = typeof ModelPerformanceErrorReason.Type;

export class ModelPerformanceServiceError extends Schema.TaggedError<ModelPerformanceServiceError>()(
  "ModelPerformanceServiceError",
  { reason: ModelPerformanceErrorReason, detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

type ReqPerfKeys =
  | "id"
  | "providerId"
  | "model"
  | "durationMs"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "tokensPerSecond"
  | "costUsd"
  | "createdAt";
type DbPerfRow = Pick<ModelPerfRun, ReqPerfKeys> & {
  readonly [K in Exclude<keyof ModelPerfRun, ReqPerfKeys | "outcome" | "rework">]-?: NonNullable<
    ModelPerfRun[K]
  > | null;
} & { readonly outcome: string | null; readonly rework: string | null };

const SELECT_COLS =
  "id, provider_id AS providerId, model, effort, thread_id AS threadId, turn_id AS turnId, delegation_id AS delegationId, duration_ms AS durationMs, first_token_ms AS firstTokenMs, input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens, tokens_per_second AS tokensPerSecond, cost_usd AS costUsd, category, score, outcome, rework, notes, rated_at AS ratedAt, created_at AS createdAt";
const VALID_OUTCOMES = new Set<PerfOutcome>(["pass", "partial", "fail"]);
const VALID_REWORKS = new Set<PerfRework>(["none", "minor", "major"]);
const decodeInput = <A, I>(schema: Schema.Decoder<A, I>, raw: unknown) =>
  Schema.decodeUnknownEffect(schema)(raw).pipe(
    Effect.mapError(
      (cause) => new ModelPerformanceServiceError({ reason: "invalid", detail: String(cause) }),
    ),
  );

export const ensurePerformanceSchema = (db: Database): void => {
  db.run(`CREATE TABLE IF NOT EXISTS model_performance_runs (
    id TEXT PRIMARY KEY NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL,
    effort TEXT, thread_id TEXT, turn_id TEXT, delegation_id TEXT,
    duration_ms REAL NOT NULL DEFAULT 0, first_token_ms REAL,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0, tokens_per_second REAL NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, category TEXT, score REAL, outcome TEXT,
    rework TEXT, notes TEXT, rated_at TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_model_perf_model_category_created ON model_performance_runs(model, category, created_at);
  CREATE INDEX IF NOT EXISTS idx_model_perf_turn_id ON model_performance_runs(turn_id);
  CREATE INDEX IF NOT EXISTS idx_model_perf_delegation_id ON model_performance_runs(delegation_id);
  CREATE INDEX IF NOT EXISTS idx_model_perf_thread_id ON model_performance_runs(thread_id);`);
};

const rowToRun = (r: DbPerfRow): ModelPerfRun => {
  const outcome = VALID_OUTCOMES.has(r.outcome as PerfOutcome)
    ? (r.outcome as PerfOutcome)
    : undefined;
  const rework = VALID_REWORKS.has(r.rework as PerfRework) ? (r.rework as PerfRework) : undefined;
  return {
    id: r.id,
    providerId: r.providerId,
    model: r.model,
    durationMs: r.durationMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    tokensPerSecond: r.tokensPerSecond,
    costUsd: r.costUsd,
    createdAt: r.createdAt,
    ...(r.effort !== null ? { effort: r.effort } : {}),
    ...(r.threadId !== null ? { threadId: r.threadId } : {}),
    ...(r.turnId !== null ? { turnId: r.turnId } : {}),
    ...(r.delegationId !== null ? { delegationId: r.delegationId } : {}),
    ...(r.firstTokenMs !== null ? { firstTokenMs: r.firstTokenMs } : {}),
    ...(r.category !== null ? { category: r.category } : {}),
    ...(r.score !== null ? { score: r.score } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
    ...(rework !== undefined ? { rework } : {}),
    ...(r.notes !== null ? { notes: r.notes } : {}),
    ...(r.ratedAt !== null ? { ratedAt: r.ratedAt } : {}),
  };
};

const aggregateStats = (key: string, runs: ReadonlyArray<ModelPerfRun>): ModelCategoryStats => {
  const [providerId = "", model = "", category = "all"] = key.split("\0");
  const c = { rated: 0, pass: 0, partial: 0, fail: 0, score: 0, cost: 0, dur: 0 };
  const reworkCounts = { none: 0, minor: 0, major: 0 };
  const tps: number[] = [];
  let lastRunAt = runs[0]?.createdAt ?? "";
  for (const r of runs) {
    c.cost += r.costUsd;
    if (r.createdAt > lastRunAt) lastRunAt = r.createdAt;
    if (r.durationMs > 0) {
      tps.push(r.tokensPerSecond);
      c.dur += r.durationMs;
    }
    if (r.outcome !== undefined && r.score !== undefined) {
      c.rated += 1;
      c.score += r.score;
      c[r.outcome] += 1;
      reworkCounts[r.rework ?? "none"] += 1;
    }
  }
  const m = tps.length;
  return {
    providerId,
    model,
    category,
    attempts: runs.length,
    ratedCount: c.rated,
    passCount: c.pass,
    partialCount: c.partial,
    failCount: c.fail,
    passRate: c.rated > 0 ? c.pass / c.rated : 0,
    avgScore: c.rated > 0 ? c.score / c.rated : 0,
    avgTokensPerSecond: m > 0 ? Math.round((tps.reduce((s, v) => s + v, 0) / m) * 10) / 10 : 0,
    medianTokensPerSecond: Math.round(median(tps) * 10) / 10,
    avgDurationMs: m > 0 ? c.dur / m : 0,
    avgCostUsd: runs.length > 0 ? c.cost / runs.length : 0,
    totalCostUsd: c.cost,
    reworkCounts,
    lastRunAt,
  };
};

const tryDb = <A>(op: string, fn: () => A): Effect.Effect<A, ModelPerformanceServiceError> =>
  Effect.try({
    try: fn,
    catch: (e) =>
      new ModelPerformanceServiceError({ reason: "database", detail: `${op}: ${String(e)}` }),
  });

const selectRows = (
  db: Database,
  where: string,
  params: ReadonlyArray<string | number>,
): DbPerfRow[] =>
  db
    .query<DbPerfRow, Array<string | number>>(
      `SELECT ${SELECT_COLS} FROM model_performance_runs WHERE ${where}`,
    )
    .all(...params);

const requireRow = (db: Database, id: string): ModelPerfRun => {
  const row = selectRows(db, "id = ?", [id])[0];
  if (!row) throw new Error(`Missing model_performance_runs row ${id}`);
  return rowToRun(row);
};

const findTargetRow = (
  db: Database,
  lookup: RunLookup & { readonly runId?: string },
  unratedThreadOnly: boolean,
): DbPerfRow | null => {
  const q = (where: string, val?: string) =>
    val ? (selectRows(db, where, [val])[0] ?? null) : null;
  return (
    q("id = ? LIMIT 1", lookup.runId) ??
    q("turn_id = ? LIMIT 1", lookup.turnId) ??
    q("delegation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", lookup.delegationId) ??
    q(
      `thread_id = ? ${unratedThreadOnly ? "AND rated_at IS NULL " : ""}ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      lookup.threadId,
    )
  );
};

const upsertMeasuredRunSync = (
  db: Database,
  input: RecordMeasuredRunInput,
  nowIso: string,
): ModelPerfRun => {
  const inTok = Math.round(input.inputTokens ?? 0),
    outTok = Math.round(input.outputTokens ?? 0),
    cacheTok = Math.round(input.cacheReadTokens ?? 0);
  const tps = computeTokensPerSecond(outTok, input.durationMs, input.firstTokenMs);
  const costUsd =
    input.costUsd ??
    estimateCostUsd(input.model, {
      inputTokens: inTok,
      outputTokens: outTok,
      cacheReadTokens: cacheTok,
      cacheWriteTokens: 0,
    });
  return db.transaction(() => {
    const existing = input.turnId ? findTargetRow(db, { turnId: input.turnId }, false) : null;
    const shared = {
      $p: input.providerId,
      $m: input.model,
      $e: input.effort ?? existing?.effort ?? null,
      $th: input.threadId ?? existing?.threadId ?? null,
      $del: input.delegationId ?? existing?.delegationId ?? null,
      $dur: input.durationMs,
      $ft: input.firstTokenMs ?? null,
      $it: inTok,
      $ot: outTok,
      $cr: cacheTok,
      $tps: tps,
      $cost: costUsd,
    };
    if (existing) {
      db.query(
        "UPDATE model_performance_runs SET provider_id=$p, model=$m, effort=$e, thread_id=$th, delegation_id=$del, duration_ms=$dur, first_token_ms=$ft, input_tokens=$it, output_tokens=$ot, cache_read_tokens=$cr, tokens_per_second=$tps, cost_usd=$cost WHERE id=$id",
      ).run({ ...shared, $id: existing.id });
      return requireRow(db, existing.id);
    }
    const id = Crypto.randomUUID();
    db.query(
      "INSERT INTO model_performance_runs (id, provider_id, model, effort, thread_id, turn_id, delegation_id, duration_ms, first_token_ms, input_tokens, output_tokens, cache_read_tokens, tokens_per_second, cost_usd, created_at) VALUES ($id, $p, $m, $e, $th, $tu, $del, $dur, $ft, $it, $ot, $cr, $tps, $cost, $at)",
    ).run({ ...shared, $id: id, $tu: input.turnId ?? null, $at: nowIso });
    return requireRow(db, id);
  })();
};

const rateRunSync = (
  db: Database,
  input: RateModelRunInput,
  category: string,
  nowIso: string,
): ModelPerfRun | null =>
  db.transaction(() => {
    const target = findTargetRow(db, input, true);
    const shared = {
      $cat: category,
      $s: input.score,
      $o: input.outcome,
      $rw: input.rework ?? "none",
      $n: input.notes !== undefined ? input.notes : (target?.notes ?? null),
      $ra: nowIso,
    };
    if (target) {
      db.query(
        "UPDATE model_performance_runs SET category=$cat, score=$s, outcome=$o, rework=$rw, notes=$n, rated_at=$ra WHERE id=$id",
      ).run({ ...shared, $id: target.id });
      return requireRow(db, target.id);
    }
    const providerId = input.providerId?.trim() ?? "";
    const model = input.model?.trim() ?? "";
    if (!providerId || !model) return null;
    const id = Crypto.randomUUID();
    db.query(
      "INSERT INTO model_performance_runs (id, provider_id, model, thread_id, turn_id, delegation_id, category, score, outcome, rework, notes, rated_at, created_at) VALUES ($id, $p, $m, $th, $tu, $del, $cat, $s, $o, $rw, $n, $ra, $ca)",
    ).run({
      ...shared,
      $id: id,
      $p: providerId,
      $m: model,
      $th: input.threadId ?? null,
      $tu: input.turnId ?? null,
      $del: input.delegationId ?? null,
      $ca: nowIso,
    });
    return requireRow(db, id);
  })();

const buildSummarySync = (
  db: Database,
  query: ModelPerfQueryInput,
  nowMs: number,
): ModelPerformanceSummary => {
  const days = Math.floor(query.days ?? 30);
  const limit = Math.floor(query.limit ?? 50);
  const normCat = query.category ? normalizeCategory(query.category) : undefined;
  const clauses = ["created_at >= ?"];
  const params: Array<string | number> = [new Date(nowMs - days * 86_400_000).toISOString()];
  if (query.model) {
    clauses.push("model = ?");
    params.push(query.model);
  }
  if (query.providerId) {
    clauses.push("provider_id = ?");
    params.push(query.providerId);
  }
  if (normCat) {
    clauses.push("category = ?");
    params.push(normCat);
  }
  const runs = selectRows(
    db,
    `${clauses.join(" AND ")} ORDER BY created_at DESC, rowid DESC`,
    params,
  ).map(rowToRun);
  const categories = new Set<string>();
  const overallMap = new Map<string, ModelPerfRun[]>();
  const catMap = new Map<string, ModelPerfRun[]>();
  const add = (m: Map<string, ModelPerfRun[]>, k: string, r: ModelPerfRun) => {
    const a = m.get(k);
    if (a) a.push(r);
    else m.set(k, [r]);
  };
  for (const run of runs) {
    const mk = `${run.providerId}\0${run.model}`;
    add(overallMap, mk, run);
    if (run.category) {
      categories.add(run.category);
      add(catMap, `${mk}\0${run.category}`, run);
    }
  }
  const base: ModelPerformanceSummary = {
    generatedAt: new Date(nowMs).toISOString(),
    days,
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    overall: [...overallMap].map(([k, g]) => aggregateStats(`${k}\0all`, g)).sort(compareStats),
    byCategory: [...catMap].map(([k, g]) => aggregateStats(k, g)).sort(compareStats),
    recentRuns: runs.slice(0, limit),
  };
  return { ...base, summaryLines: formatPerformanceSummaryLines(base) };
};

export const makeModelPerformanceService = (
  db: Database,
  options?: { readonly now?: () => number },
) => {
  ensurePerformanceSchema(db);
  const nowFn = options?.now ?? (() => Date.now());
  const fnDb = <A extends ReadonlyArray<unknown>, R>(op: string, f: (...args: A) => R) =>
    Effect.fn(`ModelPerformanceService.${op}`)((...args: A) => tryDb(op, () => f(...args)));
  const runWith = <A, I, R>(
    op: string,
    schema: Schema.Decoder<A, I>,
    raw: unknown,
    f: (a: A) => R,
  ) => Effect.flatMap(decodeInput(schema, raw), (a) => tryDb(op, () => f(a)));
  return {
    recordMeasuredRun: Effect.fn("ModelPerformanceService.recordMeasuredRun")(
      (raw: RecordMeasuredRunInput) =>
        runWith("recordMeasuredRun", RecordMeasuredRunInput, raw, (i) =>
          upsertMeasuredRunSync(db, i, new Date(nowFn()).toISOString()),
        ),
    ),
    rateRun: Effect.fn("ModelPerformanceService.rateRun")(function* (rawInput: RateModelRunInput) {
      const input = yield* decodeInput(RateModelRunInput, rawInput);
      const category = normalizeCategory(input.category);
      if (!category)
        return yield* new ModelPerformanceServiceError({
          reason: "invalid",
          detail: "Category must not be empty.",
        });
      const rated = yield* tryDb("rateRun", () =>
        rateRunSync(db, input, category, new Date(nowFn()).toISOString()),
      );
      return (
        rated ??
        (yield* new ModelPerformanceServiceError({
          reason: "not-found",
          detail: "No matching measured run found and providerId/model were not supplied.",
        }))
      );
    }),
    querySummary: Effect.fn("ModelPerformanceService.querySummary")((raw?: ModelPerfQueryInput) =>
      runWith("querySummary", ModelPerfQueryInput, raw ?? {}, (q) =>
        buildSummarySync(db, q, nowFn()),
      ),
    ),
    getRunByTurnOrDelegation: fnDb("getRunByTurnOrDelegation", (lookup: RunLookup) => {
      const r = findTargetRow(db, lookup, false);
      return r ? rowToRun(r) : null;
    }),
    deleteRun: fnDb(
      "deleteRun",
      (id: string) =>
        db.query("DELETE FROM model_performance_runs WHERE id = ?").run(id).changes > 0,
    ),
    listCategories: fnDb("listCategories", () =>
      db
        .query<{ readonly category: string }, []>(
          "SELECT DISTINCT category FROM model_performance_runs WHERE category IS NOT NULL ORDER BY category ASC",
        )
        .all()
        .map((r) => r.category),
    ),
  };
};

export type ModelPerformanceServiceShape = ReturnType<typeof makeModelPerformanceService>;
export class ModelPerformanceService extends Context.Service<
  ModelPerformanceService,
  ModelPerformanceServiceShape
>()("scuttle/server/ModelPerformanceService") {}
export const layer = (options?: { readonly now?: () => number }) =>
  Layer.effect(
    ModelPerformanceService,
    Effect.map(Sqlite.SqliteDatabase, ({ db }) => makeModelPerformanceService(db, options)),
  );
export const liveLayer = layer();

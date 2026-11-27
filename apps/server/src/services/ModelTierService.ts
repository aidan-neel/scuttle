import type { Database } from "bun:sqlite";
import {
  ModelTierConfig,
  type ModelTierScope,
  modelTierScopeKey,
  type ResolvedModelTiers,
  resolveEffectiveModelTiers,
  type ScopedModelTierConfigs,
} from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EventBus from "./EventBus.ts";

interface ModelTierRow {
  readonly scope_key: string;
  readonly scope_kind: string;
  readonly target_id: string | null;
  readonly config_json: string;
}

const decodeConfig = Schema.decodeUnknownOption(ModelTierConfig);

const parseConfigJson = (raw: string): ModelTierConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const decoded = decodeConfig(parsed);
    return decoded._tag === "Some" ? decoded.value : {};
  } catch {
    return {};
  }
};

const isConfigEmpty = (config: ModelTierConfig): boolean =>
  config.budget === undefined &&
  config.nano === undefined &&
  config.small === undefined &&
  config.medium === undefined &&
  config.large === undefined &&
  config.xlarge === undefined &&
  config.max === undefined &&
  config.design === undefined &&
  (config.panel === undefined || config.panel.length === 0) &&
  (config.council === undefined || config.council.length === 0);

const sanitizeConfig = (config: ModelTierConfig): ModelTierConfig => ({
  ...(config.budget !== undefined ? { budget: config.budget } : {}),
  ...(config.nano !== undefined ? { nano: config.nano } : {}),
  ...(config.small !== undefined ? { small: config.small } : {}),
  ...(config.medium !== undefined ? { medium: config.medium } : {}),
  ...(config.large !== undefined ? { large: config.large } : {}),
  ...(config.xlarge !== undefined ? { xlarge: config.xlarge } : {}),
  ...(config.max !== undefined ? { max: config.max } : {}),
  ...(config.design !== undefined ? { design: config.design } : {}),
  ...(config.panel !== undefined && config.panel.length > 0 ? { panel: [...config.panel] } : {}),
  ...(config.council !== undefined && config.council.length > 0
    ? { council: [...config.council] }
    : {}),
});

export const readScopedModelTierConfigs = (db: Database): ScopedModelTierConfigs => {
  const rows = db
    .query<ModelTierRow, []>(
      "SELECT scope_key, scope_kind, target_id, config_json FROM model_tier_configs",
    )
    .all();

  let global: ModelTierConfig = {};
  const projects: Record<string, ModelTierConfig> = {};
  const agents: Record<string, ModelTierConfig> = {};

  for (const row of rows) {
    const cfg = sanitizeConfig(parseConfigJson(row.config_json));
    if (isConfigEmpty(cfg)) continue;
    if (row.scope_kind === "global") {
      global = cfg;
    } else if (row.scope_kind === "project" && row.target_id) {
      projects[row.target_id] = cfg;
    } else if (row.scope_kind === "agent" && row.target_id) {
      agents[row.target_id] = cfg;
    }
  }

  return { global, projects, agents };
};

export const writeModelTierScope = (
  db: Database,
  scope: ModelTierScope,
  config: ModelTierConfig,
): ScopedModelTierConfigs => {
  const scopeKey = modelTierScopeKey(scope);
  const cleaned = sanitizeConfig(config);
  if (isConfigEmpty(cleaned)) {
    db.prepare("DELETE FROM model_tier_configs WHERE scope_key = ?").run(scopeKey);
  } else {
    const targetId =
      scope.kind === "project" ? scope.projectId : scope.kind === "agent" ? scope.agentId : null;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO model_tier_configs (scope_key, scope_kind, target_id, config_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
    ).run(scopeKey, scope.kind, targetId, JSON.stringify(cleaned), now);
  }
  return readScopedModelTierConfigs(db);
};

export class ModelTierService extends Context.Service<
  ModelTierService,
  {
    readonly getAll: () => Effect.Effect<ScopedModelTierConfigs>;
    readonly setScope: (
      scope: ModelTierScope,
      config: ModelTierConfig,
    ) => Effect.Effect<ScopedModelTierConfigs>;
    readonly resolveFor: (target?: {
      readonly projectId?: string | undefined;
      readonly agentId?: string | undefined;
    }) => Effect.Effect<ResolvedModelTiers>;
  }
>()("scuttle/server/ModelTierService") {}

const make = Effect.gen(function* () {
  const { db } = yield* Sqlite.SqliteDatabase;
  const eventBus = yield* EventBus.EventBus;

  const getAll = () => Effect.sync(() => readScopedModelTierConfigs(db));

  const setScope = Effect.fn("ModelTierService.setScope")(function* (
    scope: ModelTierScope,
    config: ModelTierConfig,
  ) {
    const next = writeModelTierScope(db, scope, config);
    yield* eventBus.publish({ kind: "modelTiers.updated", modelTiers: next });
    return next;
  });

  const resolveFor = (target?: {
    readonly projectId?: string | undefined;
    readonly agentId?: string | undefined;
  }) => Effect.sync(() => resolveEffectiveModelTiers(readScopedModelTierConfigs(db), target));

  return { getAll, setScope, resolveFor };
});

export const layer = Layer.effect(ModelTierService, make);

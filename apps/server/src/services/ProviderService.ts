import {
  EffortLevel,
  type ProviderConfig,
  type ProviderConfigPatch,
  ProviderKind,
  type ProviderSnapshot,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sqlite from "../persistence/Sqlite.ts";
import { defaultProviderConfigs, getBuiltInProviderSpec } from "../providers/catalog.ts";
import { getHarnessAdapter } from "../providers/registry.ts";
import * as EventBus from "./EventBus.ts";

export class ProviderServiceError extends Schema.TaggedError<ProviderServiceError>()(
  "ProviderServiceError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

interface ProviderConfigRow {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly enabled: number;
  readonly binary_path: string;
  readonly launch_args: string;
  readonly default_model: string | null;
  readonly default_effort: string | null;
}

const decodeKind = Schema.decodeUnknownOption(ProviderKind);
const decodeEffort = Schema.decodeUnknownOption(EffortLevel);

const rowToConfig = (row: ProviderConfigRow): ProviderConfig | null => {
  const kind = decodeKind(row.kind);
  if (kind._tag === "None") return null;
  const effort = row.default_effort ? decodeEffort(row.default_effort) : null;
  return {
    id: ProviderId.make(row.id),
    kind: kind.value,
    name: row.name,
    enabled: row.enabled === 1,
    binaryPath: row.binary_path,
    launchArgs: row.launch_args,
    ...(row.default_model ? { defaultModel: row.default_model } : {}),
    ...(effort && effort._tag === "Some" ? { defaultEffort: effort.value } : {}),
  };
};

const initialProbingSnapshot = (config: ProviderConfig): ProviderSnapshot => {
  const spec = getBuiltInProviderSpec(config.kind);
  return {
    ...config,
    status: config.enabled ? "probing" : "disabled",
    setupHint: spec.setupHint,
    models: [...spec.fallbackModels],
    checkedAt: new Date().toISOString(),
  };
};

export class ProviderService extends Context.Service<
  ProviderService,
  {
    readonly listSnapshots: () => Effect.Effect<ReadonlyArray<ProviderSnapshot>>;
    readonly getConfig: (id: ProviderId) => Effect.Effect<ProviderConfig, ProviderServiceError>;
    readonly refreshAll: () => Effect.Effect<ReadonlyArray<ProviderSnapshot>>;
    readonly refreshOne: (id: ProviderId) => Effect.Effect<ProviderSnapshot, ProviderServiceError>;
    readonly updateConfig: (
      id: ProviderId,
      patch: ProviderConfigPatch,
    ) => Effect.Effect<ProviderSnapshot, ProviderServiceError>;
  }
>()("scuttle/server/ProviderService") {}

const make = Effect.gen(function* () {
  const { db } = yield* Sqlite.SqliteDatabase;
  const eventBus = yield* EventBus.EventBus;

  const ensureDefaults = () => {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO provider_configs
        (id, kind, name, enabled, binary_path, launch_args, default_model, default_effort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const config of defaultProviderConfigs()) {
      insert.run(
        config.id,
        config.kind,
        config.name,
        config.enabled ? 1 : 0,
        config.binaryPath,
        config.launchArgs,
        config.defaultModel ?? null,
        config.defaultEffort ?? null,
        now,
        now,
      );
    }
  };

  ensureDefaults();

  const readConfigs = (): ReadonlyArray<ProviderConfig> => {
    const rows = db
      .query<ProviderConfigRow, []>(
        "SELECT id, kind, name, enabled, binary_path, launch_args, default_model, default_effort FROM provider_configs ORDER BY rowid ASC",
      )
      .all();
    const configs: ProviderConfig[] = [];
    for (const row of rows) {
      const parsed = rowToConfig(row);
      if (parsed) configs.push(parsed);
    }
    return configs;
  };

  const snapshots = new Map<string, ProviderSnapshot>();
  for (const config of readConfigs()) {
    snapshots.set(config.id, initialProbingSnapshot(config));
  }

  const probeConfig = Effect.fn("ProviderService.probeConfig")(function* (config: ProviderConfig) {
    const adapter = getHarnessAdapter(config.kind);
    const snapshot = yield* adapter.probe(config);
    snapshots.set(config.id, snapshot);
    yield* eventBus.publish({ kind: "provider.updated", provider: snapshot });
    return snapshot;
  });

  const refreshAll = Effect.fn("ProviderService.refreshAll")(function* () {
    const configs = readConfigs();
    return yield* Effect.all(
      configs.map((config) => probeConfig(config)),
      { concurrency: "unbounded" },
    );
  });

  const listSnapshots = () =>
    Effect.sync(() => {
      const configs = readConfigs();
      return configs.map((config) => snapshots.get(config.id) ?? initialProbingSnapshot(config));
    });

  const getConfig = Effect.fn("ProviderService.getConfig")(function* (id: ProviderId) {
    const row = db
      .query<ProviderConfigRow, [string]>(
        "SELECT id, kind, name, enabled, binary_path, launch_args, default_model, default_effort FROM provider_configs WHERE id = ?",
      )
      .get(id);
    const parsed = row ? rowToConfig(row) : null;
    if (!parsed) {
      return yield* new ProviderServiceError({ detail: `Provider "${id}" was not found.` });
    }
    return parsed;
  });

  const refreshOne = Effect.fn("ProviderService.refreshOne")(function* (id: ProviderId) {
    const config = yield* getConfig(id);
    return yield* probeConfig(config);
  });

  const updateConfig = Effect.fn("ProviderService.updateConfig")(function* (
    id: ProviderId,
    patch: ProviderConfigPatch,
  ) {
    const current = yield* getConfig(id);
    const nextModel =
      patch.defaultModel === undefined
        ? current.defaultModel
        : patch.defaultModel === null
          ? undefined
          : patch.defaultModel;
    const nextEffort =
      patch.defaultEffort === undefined
        ? current.defaultEffort
        : patch.defaultEffort === null
          ? undefined
          : patch.defaultEffort;

    const updated: ProviderConfig = {
      ...current,
      name:
        patch.name !== undefined && patch.name.trim().length > 0 ? patch.name.trim() : current.name,
      enabled: patch.enabled ?? current.enabled,
      binaryPath: patch.binaryPath ?? current.binaryPath,
      launchArgs: patch.launchArgs ?? current.launchArgs,
      ...(nextModel ? { defaultModel: nextModel } : {}),
      ...(nextEffort ? { defaultEffort: nextEffort } : {}),
    };

    db.prepare(
      `UPDATE provider_configs
       SET name = ?, enabled = ?, binary_path = ?, launch_args = ?, default_model = ?, default_effort = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      updated.name,
      updated.enabled ? 1 : 0,
      updated.binaryPath,
      updated.launchArgs,
      updated.defaultModel ?? null,
      updated.defaultEffort ?? null,
      new Date().toISOString(),
      id,
    );

    return yield* probeConfig(updated);
  });

  // Kick off background probes on startup without blocking server boot.
  yield* Effect.forkDetach(refreshAll());

  return ProviderService.of({
    listSnapshots,
    getConfig,
    refreshAll,
    refreshOne,
    updateConfig,
  });
});

export const layer = Layer.effect(ProviderService, make);

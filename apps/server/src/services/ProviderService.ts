import * as NodePath from "node:path";
import {
  AcpDistributionKind,
  type AcpRegistryAgentSummary,
  type CreateProviderInstanceInput,
  EffortLevel,
  type InstallAcpAgentInput,
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
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import {
  fetchRegistry,
  installRegistryAgent,
  resolveDistribution,
} from "../providers/acpRegistry.ts";
import { defaultProviderConfigs, getBuiltInProviderSpec } from "../providers/catalog.ts";
import { probeHarnessAdapter } from "../providers/registry.ts";
import * as EventBus from "./EventBus.ts";

export class ProviderServiceError extends Schema.TaggedError<ProviderServiceError>()(
  "ProviderServiceError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface ProviderServiceOptions {
  readonly registryUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly registryPlatform?: NodeJS.Platform;
  readonly registryArch?: NodeJS.Architecture;
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
  readonly home_path: string | null;
  readonly shadow_home_path: string | null;
  readonly env_json: string | null;
  readonly acp_registry_json: string | null;
}

const decodeKind = Schema.decodeUnknownOption(ProviderKind);
const decodeEffort = Schema.decodeUnknownOption(EffortLevel);
const decodeEnvJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const decodeAcpMetaJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      acpAgentId: Schema.optionalKey(Schema.String),
      acpVersion: Schema.optionalKey(Schema.String),
      acpDistribution: Schema.optionalKey(AcpDistributionKind),
    }),
  ),
);

const SELECT_COLUMNS =
  "id, kind, name, enabled, binary_path, launch_args, default_model, default_effort, home_path, shadow_home_path, env_json, acp_registry_json";

const toProviderError = (cause: unknown) =>
  new ProviderServiceError({ detail: cause instanceof Error ? cause.message : String(cause) });
const runRegistryOp = <A>(fn: () => Promise<A>) =>
  Effect.tryPromise({ try: fn, catch: toProviderError });

const configFields = (c: ProviderConfig) => [
  c.name,
  c.enabled ? 1 : 0,
  c.binaryPath,
  c.launchArgs,
  c.defaultModel ?? null,
  c.defaultEffort ?? null,
  c.homePath ?? null,
  c.shadowHomePath ?? null,
  c.env ? JSON.stringify(c.env) : null,
];

const cleanEnvRecord = (env: Readonly<Record<string, string>> | undefined | null) => {
  if (!env) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(env).flatMap(([k, v]) => (k.trim() ? [[k.trim(), v]] : [])),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const resolveOptionalText = (patch: string | null | undefined, current: string | undefined) =>
  patch === undefined ? current : patch === null ? undefined : patch.trim() || undefined;

const rowToConfig = (row: ProviderConfigRow): ProviderConfig | null => {
  const kind = decodeKind(row.kind);
  if (kind._tag === "None") return null;
  const effort = row.default_effort ? decodeEffort(row.default_effort) : null;
  const envOpt = row.env_json ? decodeEnvJson(row.env_json) : null;
  const env = envOpt?._tag === "Some" ? cleanEnvRecord(envOpt.value) : undefined;
  const acp = row.acp_registry_json ? decodeAcpMetaJson(row.acp_registry_json) : null;
  const acpVal = acp?._tag === "Some" ? acp.value : undefined;
  return {
    id: ProviderId.make(row.id),
    kind: kind.value,
    name: row.name,
    enabled: row.enabled === 1,
    binaryPath: row.binary_path,
    launchArgs: row.launch_args,
    isBuiltIn: kind.value !== "acp-registry" && row.id === kind.value,
    ...(row.default_model ? { defaultModel: row.default_model } : {}),
    ...(effort?._tag === "Some" ? { defaultEffort: effort.value } : {}),
    ...(row.home_path ? { homePath: row.home_path } : {}),
    ...(row.shadow_home_path ? { shadowHomePath: row.shadow_home_path } : {}),
    ...(env ? { env } : {}),
    ...acpVal,
  };
};

const initialProbingSnapshot = (config: ProviderConfig): ProviderSnapshot => {
  const spec = config.kind === "acp-registry" ? null : getBuiltInProviderSpec(config.kind);
  return {
    ...config,
    status: config.enabled ? "probing" : "disabled",
    setupHint: spec ? spec.setupHint : `Install ${config.name} from the ACP Registry.`,
    models: spec
      ? [...spec.fallbackModels]
      : [{ slug: "default", name: `${config.name} Default`, isDefault: true, efforts: [] }],
    checkedAt: new Date().toISOString(),
  };
};

const slugify = (value: string): string => {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[-_.]+|[-_.]+$/gu, "");
  return cleaned.length > 0 ? cleaned : "account";
};

const formatLaunchArgs = (args: ReadonlyArray<string>): string =>
  args
    .map((a) => (/[\s'"]/u.test(a) ? JSON.stringify(a) : a))
    .filter(Boolean)
    .join(" ");

const encodeAcpMeta = (c: ProviderConfig): string | null =>
  c.acpAgentId || c.acpVersion || c.acpDistribution
    ? JSON.stringify({
        acpAgentId: c.acpAgentId,
        acpVersion: c.acpVersion,
        acpDistribution: c.acpDistribution,
      })
    : null;

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
    readonly createInstance: (
      input: CreateProviderInstanceInput,
    ) => Effect.Effect<ProviderSnapshot, ProviderServiceError>;
    readonly deleteInstance: (id: ProviderId) => Effect.Effect<void, ProviderServiceError>;
    readonly listAcpRegistry: (options?: {
      readonly refresh?: boolean;
    }) => Effect.Effect<ReadonlyArray<AcpRegistryAgentSummary>, ProviderServiceError>;
    readonly installAcpAgent: (
      input: InstallAcpAgentInput,
    ) => Effect.Effect<ProviderSnapshot, ProviderServiceError>;
  }
>()("scuttle/server/ProviderService") {}

const make = (options: ProviderServiceOptions = {}) =>
  Effect.gen(function* () {
    const { db } = yield* Sqlite.SqliteDatabase;
    const eventBus = yield* EventBus.EventBus;
    const serverConfigOpt = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const dataDir =
      serverConfigOpt._tag === "Some"
        ? serverConfigOpt.value.dataDir
        : ServerConfig.defaultServerConfig().dataDir;

    const existingCols = new Set(
      db
        .query<{ readonly name: string }, []>("PRAGMA table_info(provider_configs)")
        .all()
        .map((c) => c.name),
    );
    for (const col of ["home_path", "shadow_home_path", "env_json", "acp_registry_json"]) {
      if (!existingCols.has(col)) db.run(`ALTER TABLE provider_configs ADD COLUMN ${col} TEXT;`);
    }

    const now = new Date().toISOString();
    const insertDefault = db.prepare(
      `INSERT OR IGNORE INTO provider_configs (id, kind, name, enabled, binary_path, launch_args, default_model, default_effort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of defaultProviderConfigs()) {
      insertDefault.run(
        c.id,
        c.kind,
        c.name,
        1,
        c.binaryPath,
        c.launchArgs,
        c.defaultModel ?? null,
        c.defaultEffort ?? null,
        now,
        now,
      );
    }

    const readConfigs = (): ReadonlyArray<ProviderConfig> =>
      db
        .query<ProviderConfigRow, []>(
          `SELECT ${SELECT_COLUMNS} FROM provider_configs ORDER BY rowid ASC`,
        )
        .all()
        .flatMap((row) => {
          const p = rowToConfig(row);
          return p ? [p] : [];
        });

    const snapshots = new Map<string, ProviderSnapshot>();
    for (const config of readConfigs()) snapshots.set(config.id, initialProbingSnapshot(config));

    const allocateUniqueId = (prefix: string, nameOrSlug: string): string => {
      const suffix = slugify(nameOrSlug);
      const base =
        suffix === prefix || suffix.startsWith(`${prefix}-`) ? suffix : `${prefix}-${suffix}`;
      const existing = new Set<string>(readConfigs().map((c) => c.id));
      if (!existing.has(base)) return base;
      for (let i = 2; ; i += 1) if (!existing.has(`${base}-${i}`)) return `${base}-${i}`;
    };

    const probeConfig = Effect.fn("ProviderService.probeConfig")(function* (
      config: ProviderConfig,
    ) {
      const snapshot = yield* probeHarnessAdapter(config, { dataDir });
      snapshots.set(config.id, snapshot);
      yield* eventBus.publish({ kind: "provider.updated", provider: snapshot });
      return snapshot;
    });

    const insertAndProbe = (c: ProviderConfig) => {
      const ts = new Date().toISOString();
      db.prepare(
        `INSERT INTO provider_configs (id, kind, name, enabled, binary_path, launch_args, default_model, default_effort, home_path, shadow_home_path, env_json, acp_registry_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(c.id, c.kind, ...configFields(c), encodeAcpMeta(c), ts, ts);
      return probeConfig(c);
    };

    const refreshAll = Effect.fn("ProviderService.refreshAll")(function* () {
      return yield* Effect.all(readConfigs().map(probeConfig), { concurrency: "unbounded" });
    });

    const listSnapshots = () =>
      Effect.sync(() => readConfigs().map((c) => snapshots.get(c.id) ?? initialProbingSnapshot(c)));

    const getConfig = Effect.fn("ProviderService.getConfig")(function* (id: ProviderId) {
      const row = db
        .query<ProviderConfigRow, [string]>(
          `SELECT ${SELECT_COLUMNS} FROM provider_configs WHERE id = ?`,
        )
        .get(id);
      const parsed = row ? rowToConfig(row) : null;
      if (!parsed)
        return yield* new ProviderServiceError({ detail: `Provider "${id}" was not found.` });
      return parsed;
    });

    const refreshOne = Effect.fn("ProviderService.refreshOne")(function* (id: ProviderId) {
      return yield* probeConfig(yield* getConfig(id));
    });

    const updateConfig = Effect.fn("ProviderService.updateConfig")(function* (
      id: ProviderId,
      patch: ProviderConfigPatch,
    ) {
      const cur = yield* getConfig(id);
      const {
        defaultModel: _m,
        defaultEffort: _e,
        homePath: _h,
        shadowHomePath: _s,
        env: _v,
        ...base
      } = cur;
      const nextModel = patch.defaultModel === undefined ? _m : (patch.defaultModel ?? undefined);
      const nextEffort =
        patch.defaultEffort === undefined ? _e : (patch.defaultEffort ?? undefined);
      const nextHome = resolveOptionalText(patch.homePath, _h);
      const nextShadow = resolveOptionalText(patch.shadowHomePath, _s);
      const nextEnv =
        patch.env === undefined ? _v : patch.env === null ? undefined : cleanEnvRecord(patch.env);
      const updated: ProviderConfig = {
        ...base,
        name: patch.name?.trim() || cur.name,
        enabled: patch.enabled ?? cur.enabled,
        binaryPath: patch.binaryPath ?? cur.binaryPath,
        launchArgs: patch.launchArgs ?? cur.launchArgs,
        ...(nextModel ? { defaultModel: nextModel } : {}),
        ...(nextEffort ? { defaultEffort: nextEffort } : {}),
        ...(nextHome ? { homePath: nextHome } : {}),
        ...(nextShadow ? { shadowHomePath: nextShadow } : {}),
        ...(nextEnv ? { env: nextEnv } : {}),
      };
      db.prepare(
        `UPDATE provider_configs SET name = ?, enabled = ?, binary_path = ?, launch_args = ?, default_model = ?, default_effort = ?, home_path = ?, shadow_home_path = ?, env_json = ?, updated_at = ? WHERE id = ?`,
      ).run(...configFields(updated), new Date().toISOString(), id);
      return yield* probeConfig(updated);
    });

    const createInstance = Effect.fn("ProviderService.createInstance")(function* (
      input: CreateProviderInstanceInput,
    ) {
      const name = input.name.trim();
      if (!name)
        return yield* new ProviderServiceError({ detail: "Provider instance name is required." });
      const explicitId = input.id?.trim();
      let id: string;
      if (explicitId) {
        id = slugify(explicitId);
        if (readConfigs().some((c) => c.id === id))
          return yield* new ProviderServiceError({
            detail: `Provider instance "${id}" already exists.`,
          });
      } else {
        const prefix =
          input.kind === "acp-registry"
            ? input.acpAgentId
              ? `acp-${slugify(input.acpAgentId)}`
              : "acp"
            : input.kind;
        id = allocateUniqueId(prefix, name);
      }
      const explicitHome = input.homePath?.trim();
      const shadowHomePath =
        input.shadowHomePath?.trim() ||
        (input.kind === "claude" && explicitHome
          ? undefined
          : NodePath.join(dataDir, "providers", input.kind, id, "shadow"));
      const env = cleanEnvRecord(input.env);
      const spec = input.kind === "acp-registry" ? undefined : getBuiltInProviderSpec(input.kind);
      const defModel = spec?.fallbackModels[0];
      return yield* insertAndProbe({
        id: ProviderId.make(id),
        kind: input.kind,
        name,
        enabled: true,
        binaryPath: input.binaryPath?.trim() ?? "",
        launchArgs: input.launchArgs?.trim() ?? "",
        isBuiltIn: false,
        ...(defModel ? { defaultModel: defModel.slug } : {}),
        ...(defModel?.defaultEffort ? { defaultEffort: defModel.defaultEffort } : {}),
        ...(explicitHome ? { homePath: explicitHome } : {}),
        ...(shadowHomePath ? { shadowHomePath } : {}),
        ...(env ? { env } : {}),
        ...(input.acpAgentId?.trim() ? { acpAgentId: input.acpAgentId.trim() } : {}),
      });
    });

    const deleteInstance = Effect.fn("ProviderService.deleteInstance")(function* (id: ProviderId) {
      const cur = yield* getConfig(id);
      if (cur.isBuiltIn || (cur.kind !== "acp-registry" && cur.id === cur.kind))
        return yield* new ProviderServiceError({
          detail: `Built-in provider "${id}" cannot be deleted.`,
        });
      db.prepare("DELETE FROM provider_configs WHERE id = ?").run(id);
      snapshots.delete(id);
    });

    const fetchReg = (forceRefresh?: boolean) =>
      runRegistryOp(() =>
        fetchRegistry({ dataDir, ...options, ...(forceRefresh ? { forceRefresh: true } : {}) }),
      );

    const listAcpRegistry = Effect.fn("ProviderService.listAcpRegistry")(function* (opts?: {
      readonly refresh?: boolean;
    }) {
      const index = yield* fetchReg(opts?.refresh);
      const installed = new Map<string, ProviderConfig>();
      for (const c of readConfigs()) {
        if (c.kind === "acp-registry" && c.acpAgentId && !installed.has(c.acpAgentId))
          installed.set(c.acpAgentId, c);
      }
      return index.agents.map((agent): AcpRegistryAgentSummary => {
        const distributions = (["binary", "npx", "uvx"] as const).filter(
          (k) =>
            resolveDistribution(agent, k, options.registryPlatform, options.registryArch) !==
            undefined,
        );
        const match = installed.get(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          version: agent.version,
          description: agent.description,
          ...(agent.icon ? { icon: agent.icon } : {}),
          ...(agent.website ? { website: agent.website } : {}),
          ...(agent.repository ? { repository: agent.repository } : {}),
          distributions,
          installed: match !== undefined,
          ...(match ? { installedInstanceId: match.id } : {}),
        };
      });
    });

    const installAcpAgent = Effect.fn("ProviderService.installAcpAgent")(function* (
      input: InstallAcpAgentInput,
    ) {
      const agentId = input.agentId.trim();
      const targetAgent =
        (yield* fetchReg(false)).agents.find((e) => e.id === agentId) ??
        (yield* fetchReg(true)).agents.find((e) => e.id === agentId);
      if (!targetAgent)
        return yield* new ProviderServiceError({
          detail: `ACP Registry agent "${agentId}" was not found.`,
        });
      const installed = yield* runRegistryOp(() =>
        installRegistryAgent({
          agent: targetAgent,
          dataDir,
          preference: input.distribution ?? "auto",
          ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
          ...(options.registryPlatform ? { platform: options.registryPlatform } : {}),
          ...(options.registryArch ? { arch: options.registryArch } : {}),
        }),
      );
      const id = allocateUniqueId(
        "acp",
        input.name?.trim() ? `${targetAgent.id}-${input.name}` : targetAgent.id,
      );
      const shadowHomePath =
        input.shadowHomePath?.trim() ||
        NodePath.join(dataDir, "providers", "acp-registry", id, "shadow");
      const env = cleanEnvRecord({ ...installed.env, ...input.env });
      return yield* insertAndProbe({
        id: ProviderId.make(id),
        kind: "acp-registry",
        name: input.name?.trim() || targetAgent.name,
        enabled: true,
        binaryPath: installed.command,
        launchArgs: formatLaunchArgs(installed.args),
        isBuiltIn: false,
        shadowHomePath,
        ...(env ? { env } : {}),
        acpAgentId: targetAgent.id,
        acpVersion: installed.version,
        acpDistribution: installed.distributionKind,
      });
    });

    if (process.env.NODE_ENV !== "test" && process.env.SCUTTLE_DISABLE_STARTUP_PROBES !== "1") {
      yield* Effect.forkScoped(refreshAll());
    }
    return ProviderService.of({
      listSnapshots,
      getConfig,
      refreshAll,
      refreshOne,
      updateConfig,
      createInstance,
      deleteInstance,
      listAcpRegistry,
      installAcpAgent,
    });
  });

export const makeLayer = (options?: ProviderServiceOptions) =>
  Layer.effect(ProviderService, make(options));
export const layer = makeLayer();

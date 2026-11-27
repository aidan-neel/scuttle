import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type ProviderIsolationKind =
  | "claude"
  | "codex"
  | "antigravity"
  | "opencode"
  | "copilot"
  | "acp-registry";

export interface ProviderIsolationConfig {
  readonly instanceId: string;
  readonly kind: ProviderIsolationKind;
  readonly dataDir: string;
  readonly homePath?: string;
  readonly shadowHomePath?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ResolvedProviderRuntime {
  readonly env: Record<string, string>;
  readonly extraLaunchArgs: string[];
  readonly effectiveHomePath?: string;
  readonly authDir?: string;
}

export interface ResolveProviderRuntimeOptions {
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  readonly userHome?: string;
  readonly platform?: NodeJS.Platform;
}

export class ShadowHomeError extends Schema.TaggedError<ShadowHomeError>()("ShadowHomeError", {
  reason: Schema.Literals([
    "path_conflict",
    "private_entry_symlink",
    "entry_conflict",
    "filesystem_error",
  ]),
  detail: Schema.String,
  path: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    return this.detail;
  }
}

const failShadow = (reason: ShadowHomeError["reason"], detail: string, path?: string): never => {
  throw new ShadowHomeError({ reason, detail, ...(path !== undefined ? { path } : {}) });
};

const CLAUDE_NESTED_VARS = new Set(
  "CLAUDECODE,CLAUDE_CODE_SESSION_ID,CLAUDE_CODE_HOST_SESSION_ID,CLAUDE_CODE_CHILD_SESSION,CLAUDE_CODE_SESSION_ATTENDED,CLAUDE_CODE_MESSAGING_SOCKET,CLAUDE_CODE_MESSAGING_TOKEN,CLAUDE_CODE_EXECPATH,CLAUDE_CODE_DESKTOP_APP_VERSION,CLAUDE_EFFORT,CLAUDE_PID,CLAUDE_AGENT_SDK_VERSION,ELECTRON_RUN_AS_NODE".split(
    ",",
  ),
);
const CODEX_MANAGED_VARS = new Set(
  "OPENAI_API_KEY,OPENAI_BASE_URL,CODEX_API_KEY,ACCESS_TOKEN".split(","),
);
const ANTIGRAVITY_AMBIENT_VARS = new Set(
  "GEMINI_API_KEY,GOOGLE_API_KEY,GOOGLE_APPLICATION_CREDENTIALS,GOOGLE_CLOUD_PROJECT,GOOGLE_CLOUD_LOCATION,GOOGLE_GENAI_USE_VERTEXAI,GCLOUD_PROJECT,CLOUDSDK_CORE_PROJECT,GEMINI_HOME,ELECTRON_RUN_AS_NODE".split(
    ",",
  ),
);
const CODEX_SHARED_DIRS =
  "sessions,archived_sessions,sqlite,shell_snapshots,worktrees,skills,plugins,cache,logs,mcp-oauth-locks,thread-writer-locks".split(
    ",",
  );
const CODEX_PRIVATE = new Set(["auth.json", "auth.lock", "models_cache.json"]);
const CODEX_SHADOW_LOCAL = new Set(["log", "memories", "tmp", ".DS_Store"]);
const CODEX_REPLACEABLE = new Set([
  "mcp-oauth-locks",
  "thread-writer-locks",
  ".sqlite-maintenance.lock",
]);

export const expandHomePath = (value: string, userHome: string): string => {
  if (value === "~") return userHome;
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return NodePath.join(userHome, value.slice(2));
  return value;
};

const sanitizeInstanceId = (id: string): string => {
  const cleaned = id.trim().replace(/[^A-Za-z0-9._-]+/gu, "_");
  return !cleaned || cleaned === "." || cleaned === ".."
    ? NodeCrypto.createHash("sha256").update(id).digest("hex").slice(0, 16)
    : cleaned;
};

const buildMergedEnv = (
  baseEnv: Readonly<Record<string, string | undefined>>,
  stripKeys: ReadonlySet<string>,
  instanceEnv: Readonly<Record<string, string>> | undefined,
  userHome: string,
  platform: NodeJS.Platform,
): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined && !stripKeys.has(k) && !stripKeys.has(k.toUpperCase())) env[k] = v;
  }
  if (!instanceEnv) return env;
  for (const [k, v] of Object.entries(instanceEnv)) {
    if (platform === "win32") {
      const upper = k.toUpperCase();
      for (const existing of Object.keys(env)) {
        if (existing.toUpperCase() === upper) delete env[existing];
      }
    }
    env[k] = expandHomePath(v, userHome);
  }
  return env;
};

const inspectPath = (targetPath: string): "missing" | "symlink" | "dir" | "file" => {
  try {
    const stat = NodeFS.lstatSync(targetPath);
    return stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "dir" : "file";
  } catch (cause) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String((cause as { code: unknown }).code)
        : undefined;
    if (code === "ENOENT") return "missing";
    return failShadow(
      "filesystem_error",
      `Failed to inspect '${targetPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
      targetPath,
    );
  }
};

const createSymlink = (target: string, link: string, platform: NodeJS.Platform): void => {
  let isDir = false;
  try {
    isDir = NodeFS.statSync(target).isDirectory();
  } catch {
    // Missing target defaults to file symlink.
  }
  NodeFS.symlinkSync(target, link, isDir ? (platform === "win32" ? "junction" : "dir") : "file");
};

const ensureCodexSymlink = (
  sharedHome: string,
  shadowHome: string,
  entryName: string,
  platform: NodeJS.Platform,
): void => {
  const target = NodePath.join(sharedHome, entryName);
  const link = NodePath.join(shadowHome, entryName);
  const kind = inspectPath(link);
  if (kind === "dir" || kind === "file") {
    if (!CODEX_REPLACEABLE.has(entryName)) {
      failShadow(
        "entry_conflict",
        `Shadow entry '${entryName}' at '${link}' is not a symlink.`,
        link,
      );
    }
    if (
      entryName === "thread-writer-locks" &&
      kind === "dir" &&
      NodeFS.readdirSync(link).some((n) => n.endsWith(".lock") && n !== ".coordination.lock")
    ) {
      return;
    }
  } else if (kind === "missing") {
    createSymlink(target, link, platform);
    return;
  } else if (NodePath.resolve(NodePath.dirname(link), NodeFS.readlinkSync(link)) === target) {
    return;
  }
  NodeFS.rmSync(link, { recursive: true, force: true });
  createSymlink(target, link, platform);
};

const assertShadowAuthNotSymlink = (shadowHome: string): void => {
  const authPath = NodePath.join(shadowHome, "auth.json");
  if (inspectPath(authPath) === "symlink") {
    failShadow(
      "private_entry_symlink",
      `Private entry 'auth.json' at '${authPath}' must not be a symlink.`,
      authPath,
    );
  }
};

const materializeCodexShadowHome = (
  sharedHome: string,
  shadowHome: string,
  platform: NodeJS.Platform,
): void => {
  if (sharedHome === shadowHome) {
    failShadow(
      "path_conflict",
      `Shadow home '${shadowHome}' must differ from '${sharedHome}'.`,
      shadowHome,
    );
  }
  assertShadowAuthNotSymlink(shadowHome);
  NodeFS.mkdirSync(sharedHome, { recursive: true });
  NodeFS.mkdirSync(shadowHome, { recursive: true });
  for (const dir of CODEX_SHARED_DIRS)
    NodeFS.mkdirSync(NodePath.join(sharedHome, dir), { recursive: true });

  const entries = new Set<string>(CODEX_SHARED_DIRS);
  for (const name of NodeFS.readdirSync(sharedHome)) {
    if (!CODEX_PRIVATE.has(name) && !CODEX_SHADOW_LOCAL.has(name)) entries.add(name);
  }
  for (const name of CODEX_PRIVATE) {
    if (name === "auth.json") continue;
    const p = NodePath.join(shadowHome, name);
    if (inspectPath(p) === "symlink") NodeFS.rmSync(p, { force: true });
  }
  for (const name of entries) {
    if (!CODEX_PRIVATE.has(name)) ensureCodexSymlink(sharedHome, shadowHome, name, platform);
  }
  assertShadowAuthNotSymlink(shadowHome);
};

const linkAntigravityEntry = (
  target: string,
  link: string,
  isDir: boolean,
  platform: NodeJS.Platform,
): void => {
  if (!NodeFS.existsSync(target)) {
    if (inspectPath(link) === "symlink") NodeFS.rmSync(link, { force: true });
    return;
  }
  const kind = inspectPath(link);
  if (kind === "symlink") {
    if (
      NodePath.resolve(NodePath.dirname(link), NodeFS.readlinkSync(link)) ===
      NodePath.resolve(target)
    )
      return;
    NodeFS.rmSync(link, { force: true });
  } else if (kind === "dir") {
    try {
      NodeFS.rmdirSync(link);
    } catch {
      return;
    }
  } else if (kind === "file") {
    return;
  }
  NodeFS.mkdirSync(NodePath.dirname(link), { recursive: true });
  if (isDir) NodeFS.symlinkSync(target, link, platform === "win32" ? "junction" : "dir");
  else if (platform === "win32") NodeFS.copyFileSync(target, link);
  else NodeFS.symlinkSync(target, link, "file");
};

const resolveClaudeRuntime = (
  config: ProviderIsolationConfig,
  baseEnv: Readonly<Record<string, string | undefined>>,
  userHome: string,
  platform: NodeJS.Platform,
): ResolvedProviderRuntime => {
  const env = buildMergedEnv(baseEnv, CLAUDE_NESTED_VARS, config.env, userHome, platform);
  const defaultHome = NodePath.resolve(NodePath.join(userHome, ".claude"));
  const explicit = config.homePath?.trim() || config.shadowHomePath?.trim() || "";
  const envHome = env.CLAUDE_CONFIG_DIR?.trim() ?? "";
  const effectiveHomePath = explicit
    ? NodePath.resolve(expandHomePath(explicit, userHome))
    : envHome
      ? NodePath.resolve(envHome)
      : defaultHome;
  // Never overwrite HOME so OS keychains keep working for login credentials.
  if (effectiveHomePath !== defaultHome || explicit.length > 0)
    env.CLAUDE_CONFIG_DIR = effectiveHomePath;
  return { env, extraLaunchArgs: [], effectiveHomePath, authDir: effectiveHomePath };
};

const resolveCodexRuntime = (
  config: ProviderIsolationConfig,
  baseEnv: Readonly<Record<string, string | undefined>>,
  userHome: string,
  platform: NodeJS.Platform,
): ResolvedProviderRuntime => {
  const explicitHome = config.homePath?.trim() ?? "";
  const envHome = config.env?.CODEX_HOME?.trim() || baseEnv.CODEX_HOME?.trim() || "";
  const sharedHome = explicitHome
    ? NodePath.resolve(expandHomePath(explicitHome, userHome))
    : envHome
      ? NodePath.resolve(expandHomePath(envHome, userHome))
      : NodePath.resolve(NodePath.join(userHome, ".codex"));
  const explicitShadow = config.shadowHomePath?.trim() ?? "";
  if (config.instanceId === "codex" && !explicitShadow) {
    const env = buildMergedEnv(baseEnv, new Set(), config.env, userHome, platform);
    if (explicitHome) env.CODEX_HOME = sharedHome;
    return { env, extraLaunchArgs: [], effectiveHomePath: sharedHome, authDir: sharedHome };
  }
  const shadowHome = explicitShadow
    ? NodePath.resolve(expandHomePath(explicitShadow, userHome))
    : NodePath.join(
        NodePath.resolve(config.dataDir),
        "providers",
        "codex",
        sanitizeInstanceId(config.instanceId),
        "shadow",
      );
  materializeCodexShadowHome(sharedHome, shadowHome, platform);
  const env = buildMergedEnv(baseEnv, CODEX_MANAGED_VARS, config.env, userHome, platform);
  env.CODEX_HOME = shadowHome;
  const source = NodePath.join(shadowHome, ".tmp", "bundled-marketplaces", "openai-bundled");
  return {
    env,
    extraLaunchArgs: ["-c", `marketplaces.openai-bundled.source=${JSON.stringify(source)}`],
    effectiveHomePath: shadowHome,
    authDir: shadowHome,
  };
};

const resolveAntigravityRuntime = (
  config: ProviderIsolationConfig,
  baseEnv: Readonly<Record<string, string | undefined>>,
  userHome: string,
  platform: NodeJS.Platform,
): ResolvedProviderRuntime => {
  const explicitShadow = config.shadowHomePath?.trim() ?? "";
  const explicitHome = config.homePath?.trim() ?? "";
  if (config.instanceId === "antigravity" && !explicitShadow && !explicitHome) {
    const env = buildMergedEnv(baseEnv, new Set(), config.env, userHome, platform);
    const defaultGemini = NodePath.resolve(NodePath.join(userHome, ".gemini"));
    return { env, extraLaunchArgs: [], effectiveHomePath: defaultGemini, authDir: defaultGemini };
  }
  const idHash = NodeCrypto.createHash("sha256").update(config.instanceId).digest("hex");
  const resolvedDataDir = NodePath.resolve(config.dataDir);
  const profileDir = explicitShadow
    ? NodePath.resolve(expandHomePath(explicitShadow, userHome))
    : explicitHome
      ? NodePath.resolve(expandHomePath(explicitHome, userHome))
      : NodePath.join(resolvedDataDir, "providers", "antigravity", idHash.slice(0, 24));
  const runtimeTemp = NodePath.join(resolvedDataDir, "antigravity-tmp", idHash.slice(0, 12));
  const acpDir = NodePath.join(profileDir, "antigravity-acp");
  for (const dir of [profileDir, acpDir, runtimeTemp])
    NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const userGemini = NodePath.join(userHome, ".gemini");
  for (const [segments, isDir] of [
    [["skills"], true],
    [["antigravity", "skills"], true],
    [["AGENTS.md"], false],
    [["GEMINI.md"], false],
  ] as const) {
    linkAntigravityEntry(
      NodePath.join(userGemini, ...segments),
      NodePath.join(profileDir, ...segments),
      isDir,
      platform,
    );
  }
  const env = buildMergedEnv(baseEnv, ANTIGRAVITY_AMBIENT_VARS, config.env, userHome, platform);
  env.GEMINI_HOME = profileDir;
  env.AGY_ACP_FORCE_FILE_STORAGE = "1";
  env.AGY_CLI_DISABLE_AUTO_UPDATE = "1";
  env.TMPDIR = runtimeTemp;
  if (platform === "win32") {
    env.TEMP = runtimeTemp;
    env.TMP = runtimeTemp;
  }
  return {
    env,
    extraLaunchArgs: ["--gemini-dir", profileDir, "--app-data-dir", "antigravity-acp"],
    effectiveHomePath: profileDir,
    authDir: acpDir,
  };
};

const resolveXdgRuntime = (
  config: ProviderIsolationConfig,
  baseEnv: Readonly<Record<string, string | undefined>>,
  userHome: string,
  platform: NodeJS.Platform,
): ResolvedProviderRuntime => {
  const env = buildMergedEnv(baseEnv, new Set(), config.env, userHome, platform);
  const explicitShadow = config.shadowHomePath?.trim() ?? "";
  if (explicitShadow) {
    const shadowHome = NodePath.resolve(expandHomePath(explicitShadow, userHome));
    const [configDir, dataDir, stateDir] = (["config", "data", "state"] as const).map((sub) => {
      const dir = NodePath.join(shadowHome, sub);
      NodeFS.mkdirSync(dir, { recursive: true });
      return dir;
    }) as [string, string, string];
    env.XDG_CONFIG_HOME = configDir;
    env.XDG_DATA_HOME = dataDir;
    env.XDG_STATE_HOME = stateDir;
    return { env, extraLaunchArgs: [], effectiveHomePath: shadowHome, authDir: dataDir };
  }
  const explicitHome = config.homePath?.trim() ?? "";
  if (explicitHome) {
    const resolvedHome = NodePath.resolve(expandHomePath(explicitHome, userHome));
    NodeFS.mkdirSync(resolvedHome, { recursive: true });
    return { env, extraLaunchArgs: [], effectiveHomePath: resolvedHome, authDir: resolvedHome };
  }
  return { env, extraLaunchArgs: [] };
};

export const materializeProviderRuntime = (
  config: ProviderIsolationConfig,
  options: ResolveProviderRuntimeOptions = {},
): ResolvedProviderRuntime => {
  const baseEnv = options.baseEnv ?? process.env;
  const userHome = options.userHome ?? NodeOS.homedir();
  const platform = options.platform ?? process.platform;
  if (config.kind === "claude") return resolveClaudeRuntime(config, baseEnv, userHome, platform);
  if (config.kind === "codex") return resolveCodexRuntime(config, baseEnv, userHome, platform);
  if (config.kind === "antigravity")
    return resolveAntigravityRuntime(config, baseEnv, userHome, platform);
  return resolveXdgRuntime(config, baseEnv, userHome, platform);
};

export const resolveProviderRuntime = Effect.fn("ShadowHomes.resolveProviderRuntime")(function* (
  config: ProviderIsolationConfig,
  options: ResolveProviderRuntimeOptions = {},
): Effect.fn.Return<ResolvedProviderRuntime, ShadowHomeError> {
  return yield* Effect.try({
    try: () => materializeProviderRuntime(config, options),
    catch: (cause) =>
      cause instanceof ShadowHomeError
        ? cause
        : new ShadowHomeError({
            reason: "filesystem_error",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
  });
});

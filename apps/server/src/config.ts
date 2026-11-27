import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface ServerConfigValues {
  readonly host: string;
  readonly port: number;
  readonly dbPath: string;
  readonly dataDir: string;
  readonly webDistDir: string | undefined;
  readonly skillsRoot: string;
  readonly seedCwdProject: boolean;
  readonly version: string;
  readonly apiBaseUrlRef: { url: string };
}

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigValues>()(
  "scuttle/server/ServerConfig",
) {}

const resolveDefaultSkillsRoot = (): string => {
  const candidates = [
    NodePath.resolve(import.meta.dir, "../../../vendor/astack"),
    NodePath.resolve(process.cwd(), "vendor/astack"),
  ];
  for (const candidate of candidates) {
    if (NodeFS.existsSync(NodePath.join(candidate, "skills"))) {
      return candidate;
    }
  }
  return candidates[0]!;
};

export const defaultServerConfig = (
  overrides?: Partial<ServerConfigValues>,
): ServerConfigValues => {
  const envPort = process.env.SCUTTLE_PORT ?? process.env.PORT;
  const parsedPort = envPort !== undefined ? Number.parseInt(envPort, 10) : 4310;
  const port = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 4310;
  const host = overrides?.host ?? process.env.SCUTTLE_HOST ?? "127.0.0.1";
  const resolvedPort = overrides?.port ?? port;
  const defaultDbPath = NodePath.resolve(process.cwd(), ".scuttle/state.sqlite");
  const dbPath = overrides?.dbPath ?? process.env.SCUTTLE_DB_PATH ?? defaultDbPath;
  const dataDir =
    overrides?.dataDir ??
    process.env.SCUTTLE_DATA_DIR ??
    (dbPath !== ":memory:"
      ? NodePath.dirname(dbPath)
      : NodePath.join(NodeOS.tmpdir(), `scuttle-mem-${crypto.randomUUID()}`));

  return {
    host,
    port: resolvedPort,
    dbPath,
    dataDir,
    webDistDir: overrides?.webDistDir ?? process.env.SCUTTLE_WEB_DIST_DIR,
    skillsRoot:
      overrides?.skillsRoot ?? process.env.SCUTTLE_ASTACK_DIR ?? resolveDefaultSkillsRoot(),
    seedCwdProject: overrides?.seedCwdProject ?? process.env.SCUTTLE_SEED_CWD_PROJECT !== "0",
    version: overrides?.version ?? "0.1.0",
    apiBaseUrlRef: overrides?.apiBaseUrlRef ?? {
      url: `http://${host}:${resolvedPort > 0 ? resolvedPort : 4310}`,
    },
  };
};

export const layer = (overrides?: Partial<ServerConfigValues>) =>
  Layer.succeed(ServerConfig, defaultServerConfig(overrides));

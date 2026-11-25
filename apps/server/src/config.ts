import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export interface ServerConfigValues {
  readonly host: string;
  readonly port: number;
  readonly dbPath: string;
  readonly webDistDir: string | undefined;
  readonly version: string;
  readonly apiBaseUrlRef: { url: string };
}

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigValues>()(
  "scuttle/server/ServerConfig",
) {}

export const defaultServerConfig = (
  overrides?: Partial<ServerConfigValues>,
): ServerConfigValues => {
  const envPort = process.env.SCUTTLE_PORT ?? process.env.PORT;
  const parsedPort = envPort !== undefined ? Number.parseInt(envPort, 10) : 4310;
  const port = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 4310;
  const host = overrides?.host ?? process.env.SCUTTLE_HOST ?? "127.0.0.1";
  const resolvedPort = overrides?.port ?? port;
  const defaultDbPath = NodePath.resolve(process.cwd(), ".scuttle/state.sqlite");

  return {
    host,
    port: resolvedPort,
    dbPath: overrides?.dbPath ?? process.env.SCUTTLE_DB_PATH ?? defaultDbPath,
    webDistDir: overrides?.webDistDir ?? process.env.SCUTTLE_WEB_DIST_DIR,
    version: overrides?.version ?? "0.1.0",
    apiBaseUrlRef: overrides?.apiBaseUrlRef ?? {
      url: `http://${host}:${resolvedPort > 0 ? resolvedPort : 4310}`,
    },
  };
};

export const layer = (overrides?: Partial<ServerConfigValues>) =>
  Layer.succeed(ServerConfig, defaultServerConfig(overrides));

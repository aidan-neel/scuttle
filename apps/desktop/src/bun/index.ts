import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { startScuttleServer } from "@scuttle/server/server";
import { BrowserWindow, BuildConfig, Utils } from "electrobun/bun";
import { buildDesktopBridgePreload, resolveDesktopPlatform } from "./bridgePreload.ts";
import { attachWindowControls, DESKTOP_WINDOW_CHROME } from "./windowControls.ts";
import { initDesktopAppIdentity } from "./windowIcon.ts";

const DEFAULT_DESKTOP_PORT = 4312;

const firstExistingDir = (candidates: readonly string[], sentinel: string): string | undefined => {
  for (const candidate of candidates) {
    if (NodeFS.existsSync(NodePath.join(candidate, sentinel))) {
      return candidate;
    }
  }
  return undefined;
};

const resolveBundledWebDistDir = (): string | undefined =>
  firstExistingDir(
    [
      NodePath.resolve(import.meta.dir, "../views/mainview"),
      NodePath.resolve(NodePath.dirname(process.execPath), "../Resources/app/views/mainview"),
    ],
    "index.html",
  );

const resolveBundledSkillsRoot = (): string | undefined =>
  firstExistingDir(
    [
      NodePath.resolve(import.meta.dir, "../astack"),
      NodePath.resolve(NodePath.dirname(process.execPath), "../Resources/app/astack"),
    ],
    "skills",
  );

const resolveDatabasePath = (): string => {
  const explicit = process.env.SCUTTLE_DB_PATH?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const userDataDir = Utils.paths.userData;
  return NodePath.join(userDataDir, "state.sqlite");
};

const resolvePreferredPort = (): number => {
  const raw = process.env.SCUTTLE_PORT ?? process.env.SCUTTLE_DESKTOP_PORT;
  if (raw === undefined) {
    return DEFAULT_DESKTOP_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DESKTOP_PORT;
};

const startEmbeddedServer = async (options: {
  readonly dbPath: string;
  readonly webDistDir: string | undefined;
  readonly skillsRoot: string | undefined;
}) => {
  const preferredPort = resolvePreferredPort();
  const baseOverrides = {
    host: "127.0.0.1",
    dbPath: options.dbPath,
    seedCwdProject: false,
    ...(options.webDistDir !== undefined ? { webDistDir: options.webDistDir } : {}),
    ...(options.skillsRoot !== undefined ? { skillsRoot: options.skillsRoot } : {}),
  };
  if (preferredPort === 0) {
    return startScuttleServer({ ...baseOverrides, port: 0 });
  }
  try {
    return await startScuttleServer({ ...baseOverrides, port: preferredPort });
  } catch {
    return startScuttleServer({ ...baseOverrides, port: 0 });
  }
};

const devUrl = process.env.SCUTTLE_WEB_DEV_URL?.trim();
const externalServerUrl = process.env.SCUTTLE_SERVER_URL?.trim();
const isDevServer = devUrl !== undefined && devUrl.length > 0;
const hasExternalServer = externalServerUrl !== undefined && externalServerUrl.length > 0;

const buildConfig = BuildConfig.getSync();
const runtimeChannel = buildConfig.runtime?.["scuttleChannel"];
const scuttleChannel =
  runtimeChannel === "dev" || runtimeChannel === "canary" || runtimeChannel === "stable"
    ? runtimeChannel
    : buildConfig.channel;

initDesktopAppIdentity(
  scuttleChannel === "dev"
    ? "dev.scuttle.app.dev"
    : scuttleChannel === "canary"
      ? "dev.scuttle.app.canary"
      : "dev.scuttle.app",
);

const webDistDir = isDevServer ? undefined : resolveBundledWebDistDir();
const skillsRoot = isDevServer ? undefined : resolveBundledSkillsRoot();

const server =
  isDevServer || hasExternalServer
    ? null
    : await startEmbeddedServer({
        dbPath: resolveDatabasePath(),
        webDistDir,
        skillsRoot,
      });

const resolvedServerUrl = hasExternalServer ? externalServerUrl : (server?.url ?? "");
const windowUrl = isDevServer
  ? devUrl
  : server !== null && webDistDir !== undefined
    ? server.url
    : "views://mainview/index.html";

const appVersion =
  isDevServer || scuttleChannel === "dev"
    ? "0.1.0-dev"
    : scuttleChannel === "canary"
      ? "0.1.0-canary"
      : "0.1.0";

const preload = buildDesktopBridgePreload({
  platform: resolveDesktopPlatform(process.platform),
  appVersion,
  serverUrl: resolvedServerUrl,
});

const mainWindow = new BrowserWindow({
  title: scuttleChannel === "dev" ? "Scuttle Dev" : "Scuttle",
  url: windowUrl,
  preload,
  ...DESKTOP_WINDOW_CHROME,
  frame: {
    x: 120,
    y: 120,
    width: 1280,
    height: 820,
  },
});

attachWindowControls(mainWindow);

const shutdown = async () => {
  if (server !== null) {
    await server.stop();
  }
  process.exit(0);
};

mainWindow.on("close", () => {
  void shutdown();
});

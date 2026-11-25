import { startScuttleServer } from "@scuttle/server/server";
import { BrowserWindow } from "electrobun/bun";
import { buildDesktopBridgePreload, resolveDesktopPlatform } from "./bridgePreload.ts";

const devUrl = process.env.SCUTTLE_WEB_DEV_URL?.trim();
const isDev = devUrl !== undefined && devUrl.length > 0;

const server = isDev
  ? null
  : await startScuttleServer({
      host: "127.0.0.1",
      port: 0,
    });

const preload = buildDesktopBridgePreload({
  platform: resolveDesktopPlatform(process.platform),
  appVersion: isDev ? "0.1.0-dev" : "0.1.0",
  serverUrl: server?.url ?? "",
});

const mainWindow = new BrowserWindow({
  title: "Scuttle",
  url: isDev ? devUrl : "views://mainview/index.html",
  preload,
  frame: {
    x: 120,
    y: 120,
    width: 1280,
    height: 820,
  },
});

const shutdown = async () => {
  if (server !== null) {
    await server.stop();
  }
  process.exit(0);
};

mainWindow.on("close", () => {
  void shutdown();
});

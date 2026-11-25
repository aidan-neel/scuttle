import { BrowserWindow } from "electrobun/bun";
import { buildDesktopBridgePreload, resolveDesktopPlatform } from "./bridgePreload.ts";

const devUrl = process.env.SCUTTLE_WEB_DEV_URL?.trim() || "http://127.0.0.1:5173";

const preload = buildDesktopBridgePreload({
  platform: resolveDesktopPlatform(process.platform),
  appVersion: "0.1.0-dev",
  serverUrl: "",
});

const mainWindow = new BrowserWindow({
  title: "Scuttle",
  url: devUrl,
  preload,
  frame: {
    x: 120,
    y: 120,
    width: 1280,
    height: 820,
  },
});

mainWindow.on("close", () => {
  process.exit(0);
});

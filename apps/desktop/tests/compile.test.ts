import { describe, expect, it } from "bun:test";
import {
  DESKTOP_CHANNEL_META,
  getExpectedBundleFolderName,
  parseDesktopCompileArgs,
} from "../../../scripts/desktop-compile-args.ts";
import { buildDesktopBridgePreload, resolveDesktopPlatform } from "../src/bun/bridgePreload.ts";

describe("desktop compile CLI arguments", () => {
  it("defaults to fast dev compile and install with shortcut", () => {
    expect(parseDesktopCompileArgs([])).toEqual({
      env: "dev",
      installer: false,
      install: true,
      launch: false,
      shortcut: true,
      desktopShortcut: false,
      console: false,
      uninstall: false,
      purgeData: false,
      installDir: undefined,
      help: false,
    });
  });

  it("defaults --installer to canary channel when --env is omitted", () => {
    const parsed = parseDesktopCompileArgs([
      "--",
      "--installer",
      "--launch",
      "--desktop-shortcut",
      "--console",
    ]);
    expect(parsed.env).toBe("canary");
    expect(parsed.installer).toBe(true);
    expect(parsed.launch).toBe(true);
    expect(parsed.desktopShortcut).toBe(true);
    expect(parsed.console).toBe(true);
  });

  it("honors explicit --env, --no-install, --no-shortcut, and --install-dir", () => {
    const parsed = parseDesktopCompileArgs([
      "--env",
      "stable",
      "--no-install",
      "--no-shortcut",
      "--install-dir",
      "C:\\Apps\\Scuttle",
    ]);
    expect(parsed.env).toBe("stable");
    expect(parsed.installer).toBe(true);
    expect(parsed.install).toBe(false);
    expect(parsed.shortcut).toBe(false);
    expect(parsed.installDir).toBe("C:\\Apps\\Scuttle");
  });

  it("rejects invalid env and unknown flags", () => {
    expect(() => parseDesktopCompileArgs(["--env=nightly"])).toThrow(/Invalid --env/);
    expect(() => parseDesktopCompileArgs(["--bogus"])).toThrow(/Unknown option/);
  });

  it("computes platform bundle folder names matching Electrobun naming", () => {
    expect(getExpectedBundleFolderName("Scuttle Dev", "dev", "win")).toBe("ScuttleDev-dev");
    expect(getExpectedBundleFolderName("Scuttle Canary", "canary", "win")).toBe(
      "ScuttleCanary-canary",
    );
    expect(getExpectedBundleFolderName("Scuttle", "stable", "win")).toBe("Scuttle");
    expect(getExpectedBundleFolderName("Scuttle", "stable", "macos")).toBe("Scuttle.app");
    expect(DESKTOP_CHANNEL_META.dev.identifier).toBe("dev.scuttle.app.dev");
  });
});

describe("desktop bridge preload", () => {
  it("normalizes platform and serializes bridge info", () => {
    expect(resolveDesktopPlatform("win32")).toBe("win32");
    expect(resolveDesktopPlatform("darwin")).toBe("darwin");
    expect(resolveDesktopPlatform("linux")).toBe("linux");
    expect(resolveDesktopPlatform("freebsd")).toBe("linux");

    const script = buildDesktopBridgePreload({
      platform: "win32",
      appVersion: "0.1.0-dev",
      serverUrl: "http://127.0.0.1:4312",
    });
    expect(script).toContain('"platform":"win32"');
    expect(script).toContain('"serverUrl":"http://127.0.0.1:4312"');
  });
});

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const WEB_DEV_URL = process.env.SCUTTLE_WEB_DEV_URL ?? "http://127.0.0.1:5173";
const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");

const isWsl = (): boolean =>
  process.platform === "linux" &&
  process.env.SCUTTLE_DESKTOP_FORCE_LINUX !== "1" &&
  (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));

const waitForHttp = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Dev server is still starting.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${url} to become ready.`);
};

const readWindowsCommandOutput = async (command: string): Promise<string> => {
  const proc = Bun.spawn(["cmd.exe", "/c", command], {
    cwd: "/mnt/c",
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Windows command failed (${exitCode}): ${stderr.trim() || command}`);
  }
  return stdout.trim();
};

const toWslPath = async (windowsPath: string): Promise<string> => {
  const proc = Bun.spawn(["wslpath", "-u", windowsPath], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to convert Windows path: ${windowsPath}`);
  }
  return stdout.trim();
};

const syncWindowsDevStage = async (): Promise<{
  readonly stageLinuxDir: string;
  readonly nodeExeWslPath: string;
}> => {
  const localAppData = await readWindowsCommandOutput("echo %LOCALAPPDATA%");
  const nodeExeWinPath = (await readWindowsCommandOutput("where node"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (nodeExeWinPath === undefined) {
    throw new Error("Could not locate Windows node.exe via `where node`.");
  }

  const stageWinDir = `${localAppData}\\Scuttle\\desktop-dev`;
  const [stageLinuxDir, nodeExeWslPath] = await Promise.all([
    toWslPath(stageWinDir),
    toWslPath(nodeExeWinPath),
  ]);

  const desktopDir = NodePath.join(REPO_ROOT, "apps/desktop");
  const bootstrapLink = NodePath.join(desktopDir, "node_modules/electrobun");
  if (!NodeFS.existsSync(bootstrapLink)) {
    throw new Error("Missing apps/desktop/node_modules/electrobun. Run `bun install` first.");
  }
  const bootstrapSrc = NodeFS.realpathSync(bootstrapLink);

  NodeFS.mkdirSync(NodePath.join(stageLinuxDir, "src/bun"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(stageLinuxDir, "bootstrap"), { recursive: true });

  NodeFS.cpSync(bootstrapSrc, NodePath.join(stageLinuxDir, "bootstrap"), {
    recursive: true,
    force: true,
    dereference: true,
  });
  NodeFS.copyFileSync(
    NodePath.join(desktopDir, "hutch.config.ts"),
    NodePath.join(stageLinuxDir, "hutch.config.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(desktopDir, "src/bun/bridgePreload.ts"),
    NodePath.join(stageLinuxDir, "src/bun/bridgePreload.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(desktopDir, "src/bun/dev-shell.ts"),
    NodePath.join(stageLinuxDir, "src/bun/dev-shell.ts"),
  );

  const devConfig = `export default {
  app: {
    name: "Scuttle Dev",
    identifier: "dev.scuttle.app.dev",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/dev-shell.ts",
    },
  },
};
`;
  NodeFS.writeFileSync(NodePath.join(stageLinuxDir, "electrobun.config.ts"), devConfig);

  return { stageLinuxDir, nodeExeWslPath };
};

const withWslEnv = (keys: readonly string[]): Record<string, string | undefined> => {
  const existing = process.env.WSLENV?.trim();
  const merged = existing ? `${existing}:${keys.join(":")}` : keys.join(":");
  return {
    ...process.env,
    WSLENV: merged,
  };
};

const buildOnly = process.argv.includes("--build-only");

if (buildOnly) {
  if (!isWsl()) {
    const proc = Bun.spawn(["bun", "--filter", "@scuttle/desktop", "build"], {
      cwd: REPO_ROOT,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await proc.exited);
  }
  const { stageLinuxDir, nodeExeWslPath } = await syncWindowsDevStage();
  const proc = Bun.spawn([nodeExeWslPath, "bootstrap\\bin\\electrobun.cjs", "build", "--env=dev"], {
    cwd: stageLinuxDir,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

const server = Bun.spawn(["bun", "--filter", "@scuttle/server", "dev"], {
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "ignore",
});

const web = Bun.spawn(["bun", "--filter", "@scuttle/web", "dev"], {
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "ignore",
});

let desktop: Bun.Subprocess | null = null;

const shutdown = () => {
  desktop?.kill();
  web.kill();
  server.kill();
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

try {
  await waitForHttp(WEB_DEV_URL, 20_000);

  if (isWsl()) {
    const { stageLinuxDir, nodeExeWslPath } = await syncWindowsDevStage();
    desktop = Bun.spawn([nodeExeWslPath, "bootstrap\\bin\\electrobun.cjs", "dev"], {
      cwd: stageLinuxDir,
      env: {
        ...withWslEnv(["SCUTTLE_WEB_DEV_URL"]),
        SCUTTLE_WEB_DEV_URL: WEB_DEV_URL,
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
  } else {
    desktop = Bun.spawn(["bun", "--filter", "@scuttle/desktop", "dev"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SCUTTLE_WEB_DEV_URL: WEB_DEV_URL,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  }

  const exitCode = await Promise.race([desktop.exited, server.exited, web.exited]);
  shutdown();
  process.exit(exitCode);
} catch (error) {
  shutdown();
  throw error;
}

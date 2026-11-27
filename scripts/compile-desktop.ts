import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  DESKTOP_CHANNEL_META,
  DESKTOP_COMPILE_USAGE,
  getExpectedBundleFolderName,
  parseDesktopCompileArgs,
  type DesktopChannelMeta,
  type DesktopCompileEnv,
  type DesktopCompileOptions,
} from "./desktop-compile-args.ts";
import {
  createWindowsShortcut,
  isWindowsDesktopTarget,
  isWslHost,
  launchWindowsExecutable,
  readWindowsHostEnv,
  removeWindowsDirectory,
  stopWindowsProcessesInDir,
  syncWindowsDirectory,
  toHostFsPath,
  toWindowsPath,
} from "./desktop-wsl.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const DESKTOP_DIR = NodePath.join(REPO_ROOT, "apps/desktop");
const DESKTOP_ASSETS_DIR = NodePath.join(DESKTOP_DIR, "assets");
const WEB_DIST_DIR = NodePath.join(REPO_ROOT, "apps/web/dist");
const VENDORED_SKILLS_DIR = NodePath.join(REPO_ROOT, "vendor/astack/skills");
const REPO_ARTIFACTS_DIR = NodePath.join(DESKTOP_DIR, "artifacts");

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const runChecked = async (
  cmd: readonly string[],
  options: { readonly cwd: string; readonly stdin?: "ignore" | "inherit" },
): Promise<void> => {
  const proc = Bun.spawn([...cmd], {
    cwd: options.cwd,
    stdin: options.stdin ?? "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd.join(" ")}`);
  }
};

const readGitShortCommit = async (): Promise<string | null> => {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) return null;
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
};

const rmWithRetry = async (targetPath: string, attempts = 6): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!NodeFS.existsSync(targetPath)) return;
    try {
      NodeFS.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await Bun.sleep(250 * attempt);
    }
  }
};

const replaceDirCleanly = async (sourceDir: string, targetDir: string): Promise<void> => {
  const parentDir = NodePath.dirname(targetDir);
  NodeFS.mkdirSync(parentDir, { recursive: true });
  const nextDir = `${targetDir}.next`;
  await rmWithRetry(nextDir);
  NodeFS.cpSync(sourceDir, nextDir, { recursive: true, force: true });
  await rmWithRetry(targetDir);
  try {
    NodeFS.renameSync(nextDir, targetDir);
  } catch {
    NodeFS.cpSync(nextDir, targetDir, { recursive: true, force: true });
    await rmWithRetry(nextDir);
  }
};

const buildWebAndServerBundle = async (serverBundleOutDir: string | null): Promise<void> => {
  log("Building @scuttle/web...");
  await runChecked(["bun", "--filter", "@scuttle/web", "build"], { cwd: REPO_ROOT });
  if (!NodeFS.existsSync(NodePath.join(WEB_DIST_DIR, "index.html"))) {
    throw new Error(`Expected built web assets at ${WEB_DIST_DIR}/index.html.`);
  }

  if (serverBundleOutDir !== null) {
    log("Bundling @scuttle/server for desktop...");
    NodeFS.mkdirSync(serverBundleOutDir, { recursive: true });
    const outfile = NodePath.join(serverBundleOutDir, "server.mjs");
    await runChecked(
      [
        "bun",
        "build",
        "apps/server/src/server.ts",
        "--target=bun",
        "--format=esm",
        `--outfile=${outfile}`,
      ],
      { cwd: REPO_ROOT },
    );
    NodeFS.writeFileSync(
      NodePath.join(serverBundleOutDir, "package.json"),
      JSON.stringify(
        {
          name: "@scuttle/server",
          version: "0.1.0",
          type: "module",
          exports: { "./server": "./server.mjs" },
        },
        null,
        2,
      ),
    );
  }
};

const resolveWindowsIconRelPath = (assetsDir: string): string | null => {
  for (const rel of ["icon.ico", "icon.iconset/icon_256x256.png"]) {
    if (NodeFS.existsSync(NodePath.join(assetsDir, rel))) {
      return `assets/${rel}`;
    }
  }
  return null;
};

const renderStagedElectrobunConfig = (
  meta: DesktopChannelMeta,
  options: { readonly hasSkills: boolean; readonly winIconRelPath: string | null },
): string => {
  const copyEntries: Record<string, string> = {
    "web-dist": "views/mainview",
    ...(options.hasSkills ? { "astack/skills": "astack/skills" } : {}),
  };
  const winBlock =
    options.winIconRelPath !== null
      ? `,\n    win: {\n      icon: ${JSON.stringify(options.winIconRelPath)},\n    }`
      : "";
  return `export default {
  app: {
    name: ${JSON.stringify(meta.displayName)},
    identifier: ${JSON.stringify(meta.identifier)},
    version: ${JSON.stringify(meta.version)},
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: ${JSON.stringify(copyEntries, null, 6)}${winBlock}
  },
  runtime: {
    scuttleChannel: ${JSON.stringify(meta.env)},
  },
  release: {
    generatePatch: false,
  },
};
`;
};

const syncWslCompileStage = async (
  stageDir: string,
  meta: DesktopChannelMeta,
): Promise<{ readonly hasSkills: boolean; readonly winIconRelPath: string | null }> => {
  const bootstrapLink = NodePath.join(DESKTOP_DIR, "node_modules/electrobun");
  if (!NodeFS.existsSync(bootstrapLink)) {
    throw new Error("Missing apps/desktop/node_modules/electrobun. Run `bun install` first.");
  }
  const bootstrapSrc = NodeFS.realpathSync(bootstrapLink);
  const hasSkills = NodeFS.existsSync(VENDORED_SKILLS_DIR);
  const winIconRelPath = resolveWindowsIconRelPath(DESKTOP_ASSETS_DIR);

  NodeFS.mkdirSync(NodePath.join(stageDir, "src/bun"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(stageDir, "bootstrap"), { recursive: true });

  NodeFS.cpSync(bootstrapSrc, NodePath.join(stageDir, "bootstrap"), {
    recursive: true,
    force: true,
    dereference: true,
  });
  NodeFS.copyFileSync(
    NodePath.join(DESKTOP_DIR, "hutch.config.ts"),
    NodePath.join(stageDir, "hutch.config.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(DESKTOP_DIR, "src/bun/bridgePreload.ts"),
    NodePath.join(stageDir, "src/bun/bridgePreload.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(DESKTOP_DIR, "src/bun/windowControls.ts"),
    NodePath.join(stageDir, "src/bun/windowControls.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(DESKTOP_DIR, "src/bun/windowIcon.ts"),
    NodePath.join(stageDir, "src/bun/windowIcon.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(DESKTOP_DIR, "src/bun/index.ts"),
    NodePath.join(stageDir, "src/bun/index.ts"),
  );

  const stageAssetsDir = NodePath.join(stageDir, "assets");
  await rmWithRetry(stageAssetsDir);
  if (winIconRelPath !== null) {
    NodeFS.cpSync(DESKTOP_ASSETS_DIR, stageAssetsDir, { recursive: true, force: true });
  }

  const stageWebDist = NodePath.join(stageDir, "web-dist");
  await rmWithRetry(stageWebDist);
  NodeFS.cpSync(WEB_DIST_DIR, stageWebDist, { recursive: true, force: true });

  const stageAstackDir = NodePath.join(stageDir, "astack");
  await rmWithRetry(stageAstackDir);
  if (hasSkills) {
    NodeFS.cpSync(VENDORED_SKILLS_DIR, NodePath.join(stageAstackDir, "skills"), {
      recursive: true,
      force: true,
    });
  }

  await rmWithRetry(NodePath.join(stageDir, "artifacts"));
  NodeFS.writeFileSync(
    NodePath.join(stageDir, "electrobun.config.ts"),
    renderStagedElectrobunConfig(meta, { hasSkills, winIconRelPath }),
  );

  return { hasSkills, winIconRelPath };
};

const findBuiltBundleDir = (
  buildRootDir: string,
  env: DesktopCompileEnv,
  platform: "win" | "linux" | "macos",
  displayName: string,
): string => {
  if (!NodeFS.existsSync(buildRootDir)) {
    throw new Error(`Electrobun build output directory not found: ${buildRootDir}`);
  }
  const envPrefix = `${env}-${platform}-`;
  const archDirName = NodeFS.readdirSync(buildRootDir).find((entry) => entry.startsWith(envPrefix));
  if (archDirName === undefined) {
    throw new Error(`No "${envPrefix}*" build folder found under ${buildRootDir}.`);
  }
  const archDir = NodePath.join(buildRootDir, archDirName);
  const expectedName = getExpectedBundleFolderName(displayName, env, platform);
  const expectedPath = NodePath.join(archDir, expectedName);
  if (NodeFS.existsSync(expectedPath)) {
    return expectedPath;
  }

  const sentinel =
    platform === "win"
      ? "bin/launcher.exe"
      : platform === "linux"
        ? "bin/launcher"
        : "Contents/Info.plist";
  for (const entry of NodeFS.readdirSync(archDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = NodePath.join(archDir, entry.name);
    if (NodeFS.existsSync(NodePath.join(candidate, sentinel))) {
      return candidate;
    }
  }
  throw new Error(`Could not locate compiled app bundle under ${archDir}.`);
};

const copyArtifactsToRepo = (sourceArtifactsDir: string): readonly string[] => {
  if (!NodeFS.existsSync(sourceArtifactsDir)) return [];
  const entries = NodeFS.readdirSync(sourceArtifactsDir);
  if (entries.length === 0) return [];
  NodeFS.mkdirSync(REPO_ARTIFACTS_DIR, { recursive: true });
  const copied: string[] = [];
  for (const entry of entries) {
    const src = NodePath.join(sourceArtifactsDir, entry);
    const dest = NodePath.join(REPO_ARTIFACTS_DIR, entry);
    NodeFS.cpSync(src, dest, { recursive: true, force: true });
    copied.push(dest);
  }
  return copied;
};

const resolveWindowsInstallPaths = async (
  meta: DesktopChannelMeta,
  customInstallDir: string | undefined,
) => {
  const winEnv = await readWindowsHostEnv();
  const installDirWin =
    customInstallDir !== undefined
      ? await toWindowsPath(customInstallDir)
      : `${winEnv.localAppDataWin}\\Scuttle\\${meta.windowsFolderName}`;
  const installDirFs = await toHostFsPath(installDirWin);
  const startMenuShortcutWin = `${winEnv.appDataWin}\\Microsoft\\Windows\\Start Menu\\Programs\\${meta.shortcutName}.lnk`;
  const desktopShortcutWin = `${winEnv.desktopWin}\\${meta.shortcutName}.lnk`;
  const userDataDirWin = `${winEnv.localAppDataWin}\\${meta.identifier}`;
  return {
    winEnv,
    installDirWin,
    installDirFs,
    startMenuShortcutWin,
    desktopShortcutWin,
    userDataDirWin,
  };
};

const uninstallWindows = async (
  meta: DesktopChannelMeta,
  options: DesktopCompileOptions,
): Promise<void> => {
  const paths = await resolveWindowsInstallPaths(meta, options.installDir);
  const stopped = await stopWindowsProcessesInDir(paths.installDirWin);
  if (stopped > 0) {
    log(`Stopped ${stopped} running ${meta.displayName} process(es).`);
  }
  await removeWindowsDirectory(paths.installDirWin);

  for (const shortcutWin of [paths.startMenuShortcutWin, paths.desktopShortcutWin]) {
    const shortcutFs = await toHostFsPath(shortcutWin);
    if (NodeFS.existsSync(shortcutFs)) {
      NodeFS.rmSync(shortcutFs, { force: true });
      log(`Removed shortcut: ${shortcutWin}`);
    }
  }

  if (options.purgeData) {
    await removeWindowsDirectory(paths.userDataDirWin);
    log(`Removed app data: ${paths.userDataDirWin}`);
  } else {
    log(`App data preserved at: ${paths.userDataDirWin} (pass --purge-data to remove)`);
  }
  log(`Uninstalled ${meta.displayName} from ${paths.installDirWin}`);
};

const compileAndInstallWindows = async (
  meta: DesktopChannelMeta,
  options: DesktopCompileOptions,
): Promise<void> => {
  const paths = await resolveWindowsInstallPaths(meta, options.installDir);
  const runningInWsl = isWslHost();

  let builtBundleDir: string;
  let sourceArtifactsDir: string;

  if (runningInWsl) {
    const stageWinDir = `${paths.winEnv.localAppDataWin}\\Scuttle\\desktop-compile`;
    const stageFsDir = await toHostFsPath(stageWinDir);
    await buildWebAndServerBundle(NodePath.join(stageFsDir, "node_modules/@scuttle/server"));
    await syncWslCompileStage(stageFsDir, meta);
    log(`Compiling ${meta.displayName} (${options.env}) on Windows via Electrobun...`);
    await runChecked(
      [
        paths.winEnv.nodeExeExecPath,
        "bootstrap\\bin\\electrobun.cjs",
        "build",
        `--env=${options.env}`,
      ],
      { cwd: stageFsDir },
    );
    builtBundleDir = findBuiltBundleDir(
      NodePath.join(stageFsDir, "build"),
      options.env,
      "win",
      meta.displayName,
    );
    sourceArtifactsDir = NodePath.join(stageFsDir, "artifacts");
  } else {
    await buildWebAndServerBundle(null);
    log(`Compiling ${meta.displayName} (${options.env}) via Electrobun...`);
    await runChecked(["bun", "--filter", "@scuttle/desktop", "build", `--env=${options.env}`], {
      cwd: REPO_ROOT,
    });
    builtBundleDir = findBuiltBundleDir(
      NodePath.join(DESKTOP_DIR, "build"),
      options.env,
      "win",
      "Scuttle",
    );
    sourceArtifactsDir = REPO_ARTIFACTS_DIR;
  }

  const copiedArtifacts = runningInWsl ? copyArtifactsToRepo(sourceArtifactsDir) : [];

  if (!options.install) {
    const builtWinPath = await toWindowsPath(builtBundleDir);
    log(`\nCompiled ${meta.displayName} (${options.env}):`);
    log(`  Bundle: ${builtWinPath}`);
    if (copiedArtifacts.length > 0) {
      log(`  Artifacts: ${REPO_ARTIFACTS_DIR}`);
    }
    return;
  }

  const wasInstalled = NodeFS.existsSync(paths.installDirFs);
  const stopped = await stopWindowsProcessesInDir(paths.installDirWin);
  if (stopped > 0) {
    log(`Stopped ${stopped} running ${meta.displayName} process(es) before updating.`);
  }

  const builtBundleWinPath = await toWindowsPath(builtBundleDir);
  log(`${wasInstalled ? "Updating" : "Installing"} ${meta.displayName} -> ${paths.installDirWin}`);
  await syncWindowsDirectory(builtBundleWinPath, paths.installDirWin);

  // Electrobun's Windows launcher allocates a visible console window whenever
  // Resources/version.json declares channel === "dev". Switch the installed
  // bundle's launcher channel to "canary" unless --console was requested;
  // runtime.scuttleChannel in build.json preserves the real channel for the app.
  if (options.env === "dev" && !options.console) {
    const versionJsonPath = NodePath.join(paths.installDirFs, "Resources/version.json");
    if (NodeFS.existsSync(versionJsonPath)) {
      const versionJson = JSON.parse(NodeFS.readFileSync(versionJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      if (versionJson["channel"] === "dev") {
        versionJson["channel"] = "canary";
        NodeFS.writeFileSync(versionJsonPath, JSON.stringify(versionJson));
      }
    }
  }

  const commit = await readGitShortCommit();
  NodeFS.writeFileSync(
    NodePath.join(paths.installDirFs, "scuttle-install.json"),
    JSON.stringify(
      {
        name: meta.displayName,
        identifier: meta.identifier,
        env: options.env,
        version: meta.version,
        commit,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const launcherWinPath = `${paths.installDirWin}\\bin\\launcher.exe`;
  if (options.shortcut) {
    await createWindowsShortcut({
      shortcutPathWin: paths.startMenuShortcutWin,
      targetPathWin: launcherWinPath,
      workingDirectoryWin: paths.installDirWin,
      description: `${meta.displayName} (${options.env})`,
    });
  }
  if (options.desktopShortcut) {
    await createWindowsShortcut({
      shortcutPathWin: paths.desktopShortcutWin,
      targetPathWin: launcherWinPath,
      workingDirectoryWin: paths.installDirWin,
      description: `${meta.displayName} (${options.env})`,
    });
  }

  log(`\n${meta.displayName} ${wasInstalled ? "updated" : "installed"}!`);
  log(`  Install dir: ${paths.installDirWin}`);
  log(`  Launcher:    ${launcherWinPath}`);
  if (options.shortcut) {
    log(`  Start Menu:  ${meta.shortcutName}`);
  }
  if (options.desktopShortcut) {
    log(`  Desktop:     ${paths.desktopShortcutWin}`);
  }
  log(`  App data:    ${paths.userDataDirWin}`);
  if (copiedArtifacts.length > 0) {
    log(`  Artifacts:   ${REPO_ARTIFACTS_DIR}`);
    for (const artifact of copiedArtifacts) {
      log(`    - ${NodePath.basename(artifact)}`);
    }
  }

  if (options.launch) {
    log(`\nLaunching ${meta.displayName}...`);
    await launchWindowsExecutable(launcherWinPath, paths.installDirWin);
  } else {
    log(
      `\nTip: Launch "${meta.shortcutName}" from Windows Start Menu, or run \`bun run desktop:install\` to compile, update, and launch.`,
    );
  }
};

const compileAndInstallUnix = async (
  meta: DesktopChannelMeta,
  options: DesktopCompileOptions,
): Promise<void> => {
  const isMac = process.platform === "darwin";
  const defaultInstallDir = isMac
    ? NodePath.join(NodeOS.homedir(), "Applications", `${meta.displayName}.app`)
    : NodePath.join(NodeOS.homedir(), ".local/share/scuttle", meta.unixFolderName);
  const installDir = options.installDir ?? defaultInstallDir;

  if (options.uninstall) {
    await rmWithRetry(installDir);
    if (!isMac) {
      const desktopEntry = NodePath.join(
        NodeOS.homedir(),
        ".local/share/applications",
        `${meta.identifier}.desktop`,
      );
      if (NodeFS.existsSync(desktopEntry)) {
        NodeFS.rmSync(desktopEntry, { force: true });
      }
    }
    log(`Uninstalled ${meta.displayName} from ${installDir}`);
    return;
  }

  await buildWebAndServerBundle(null);
  log(`Compiling ${meta.displayName} (${options.env}) via Electrobun...`);
  await runChecked(["bun", "--filter", "@scuttle/desktop", "build", `--env=${options.env}`], {
    cwd: REPO_ROOT,
  });

  const builtBundleDir = findBuiltBundleDir(
    NodePath.join(DESKTOP_DIR, "build"),
    options.env,
    isMac ? "macos" : "linux",
    "Scuttle",
  );

  if (!options.install) {
    log(`\nCompiled ${meta.displayName} (${options.env}): ${builtBundleDir}`);
    return;
  }

  const wasInstalled = NodeFS.existsSync(installDir);
  await replaceDirCleanly(builtBundleDir, installDir);

  if (!isMac && options.shortcut) {
    const applicationsDir = NodePath.join(NodeOS.homedir(), ".local/share/applications");
    NodeFS.mkdirSync(applicationsDir, { recursive: true });
    const launcherPath = NodePath.join(installDir, "bin/launcher");
    const desktopEntry = `[Desktop Entry]
Type=Application
Name=${meta.displayName}
Exec="${launcherPath}"
Terminal=false
Categories=Development;
`;
    NodeFS.writeFileSync(
      NodePath.join(applicationsDir, `${meta.identifier}.desktop`),
      desktopEntry,
    );
  }

  log(`\n${meta.displayName} ${wasInstalled ? "updated" : "installed"}: ${installDir}`);
  if (options.launch) {
    const launchCmd = isMac ? ["open", installDir] : [NodePath.join(installDir, "bin/launcher")];
    Bun.spawn(launchCmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  }
};

const main = async (): Promise<void> => {
  const options = parseDesktopCompileArgs(process.argv.slice(2));
  if (options.help) {
    log(DESKTOP_COMPILE_USAGE);
    return;
  }
  const meta = DESKTOP_CHANNEL_META[options.env];
  if (isWindowsDesktopTarget()) {
    if (options.uninstall) {
      await uninstallWindows(meta, options);
      return;
    }
    await compileAndInstallWindows(meta, options);
    return;
  }
  await compileAndInstallUnix(meta, options);
};

await main();

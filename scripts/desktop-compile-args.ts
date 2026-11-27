export type DesktopCompileEnv = "dev" | "canary" | "stable";

export interface DesktopCompileOptions {
  readonly env: DesktopCompileEnv;
  readonly installer: boolean;
  readonly install: boolean;
  readonly launch: boolean;
  readonly shortcut: boolean;
  readonly desktopShortcut: boolean;
  readonly console: boolean;
  readonly uninstall: boolean;
  readonly purgeData: boolean;
  readonly installDir: string | undefined;
  readonly help: boolean;
}

export interface DesktopChannelMeta {
  readonly env: DesktopCompileEnv;
  readonly displayName: string;
  readonly identifier: string;
  readonly version: string;
  readonly windowsFolderName: string;
  readonly unixFolderName: string;
  readonly shortcutName: string;
}

export const DESKTOP_CHANNEL_META: Record<DesktopCompileEnv, DesktopChannelMeta> = {
  dev: {
    env: "dev",
    displayName: "Scuttle Dev",
    identifier: "dev.scuttle.app.dev",
    version: "0.1.0",
    windowsFolderName: "DevApp",
    unixFolderName: "dev",
    shortcutName: "Scuttle Dev",
  },
  canary: {
    env: "canary",
    displayName: "Scuttle Canary",
    identifier: "dev.scuttle.app.canary",
    version: "0.1.0",
    windowsFolderName: "CanaryApp",
    unixFolderName: "canary",
    shortcutName: "Scuttle Canary",
  },
  stable: {
    env: "stable",
    displayName: "Scuttle",
    identifier: "dev.scuttle.app",
    version: "0.1.0",
    windowsFolderName: "App",
    unixFolderName: "stable",
    shortcutName: "Scuttle",
  },
};

export const DESKTOP_COMPILE_USAGE = `Usage: bun run desktop:compile [options]

Compiles the standalone Scuttle desktop app (web UI + embedded server + Electrobun shell)
and installs or updates it in-place for easy local testing. Inside WSL, automatically builds
and installs the native Windows WebView2 app.

Options:
  --env=dev|canary|stable   Build channel (default: dev; canary/stable also build Setup.exe)
  --installer               Build Windows Setup.exe installer (defaults --env to canary)
  --launch, --open          Launch the installed desktop app after compiling
  --no-install              Compile only; skip installing/updating and shortcuts
  --desktop-shortcut        Also create a Desktop shortcut (Windows)
  --no-shortcut             Skip creating/updating Start Menu / launcher shortcut
  --console                 Keep Electrobun's dev console window enabled on Windows
  --install-dir=<path>      Override the installation directory
  --uninstall               Remove the installed app and shortcuts for this channel
  --purge-data              With --uninstall, also remove app data (SQLite DB + WebView2 profile)
  -h, --help                Show this help

Examples:
  bun run desktop:compile                    # Compile & install/update Scuttle Dev in-place
  bun run desktop:install                    # Compile, install/update, and launch Scuttle Dev
  bun run desktop:compile --desktop-shortcut # Also add a Desktop shortcut on Windows
  bun run desktop:compile --installer        # Also generate Windows Setup.exe in apps/desktop/artifacts
  bun run desktop:uninstall                  # Remove Scuttle Dev install and shortcuts
`;

const parseEnvValue = (raw: string): DesktopCompileEnv => {
  if (raw === "dev" || raw === "canary" || raw === "stable") {
    return raw;
  }
  throw new Error(`Invalid --env value "${raw}". Expected one of: dev, canary, stable.`);
};

export const parseDesktopCompileArgs = (argv: readonly string[]): DesktopCompileOptions => {
  let explicitEnv: DesktopCompileEnv | undefined;
  let installer = false;
  let install = true;
  let launch = false;
  let shortcut = true;
  let desktopShortcut = false;
  let consoleWindow = false;
  let uninstall = false;
  let purgeData = false;
  let installDir: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--installer") {
      installer = true;
    } else if (arg === "--launch" || arg === "--open") {
      launch = true;
    } else if (arg === "--no-install") {
      install = false;
    } else if (arg === "--desktop-shortcut") {
      desktopShortcut = true;
    } else if (arg === "--no-shortcut") {
      shortcut = false;
    } else if (arg === "--console") {
      consoleWindow = true;
    } else if (arg === "--uninstall") {
      uninstall = true;
    } else if (arg === "--purge-data") {
      purgeData = true;
    } else if (arg.startsWith("--env=")) {
      explicitEnv = parseEnvValue(arg.slice("--env=".length));
    } else if (arg === "--env") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("Missing value after --env. Expected one of: dev, canary, stable.");
      }
      explicitEnv = parseEnvValue(next);
      i += 1;
    } else if (arg.startsWith("--install-dir=")) {
      const value = arg.slice("--install-dir=".length).trim();
      if (value.length === 0) {
        throw new Error("--install-dir cannot be empty.");
      }
      installDir = value;
    } else if (arg === "--install-dir") {
      const next = argv[i + 1]?.trim();
      if (next === undefined || next.length === 0) {
        throw new Error("Missing path after --install-dir.");
      }
      installDir = next;
      i += 1;
    } else {
      throw new Error(`Unknown option "${arg}". Run with --help to see available options.`);
    }
  }

  const env: DesktopCompileEnv = explicitEnv ?? (installer ? "canary" : "dev");
  return {
    env,
    installer: installer || env !== "dev",
    install,
    launch,
    shortcut,
    desktopShortcut,
    console: consoleWindow,
    uninstall,
    purgeData,
    installDir,
    help,
  };
};

export const getExpectedBundleFolderName = (
  displayName: string,
  env: DesktopCompileEnv,
  platform: "win" | "linux" | "macos",
): string => {
  const base = platform === "macos" ? displayName : displayName.replace(/ /g, "");
  const suffix = env === "stable" ? base : `${base}-${env}`;
  return platform === "macos" ? `${suffix}.app` : suffix;
};

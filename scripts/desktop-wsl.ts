export interface WindowsHostEnv {
  readonly localAppDataWin: string;
  readonly appDataWin: string;
  readonly desktopWin: string;
  readonly nodeExeWin: string;
  readonly nodeExeExecPath: string;
}

export interface WindowsShortcutOptions {
  readonly shortcutPathWin: string;
  readonly targetPathWin: string;
  readonly workingDirectoryWin: string;
  readonly description: string;
}

export const isWslHost = (): boolean =>
  process.platform === "linux" &&
  process.env.SCUTTLE_DESKTOP_FORCE_LINUX !== "1" &&
  (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));

export const isWindowsDesktopTarget = (): boolean => process.platform === "win32" || isWslHost();

export const withWslEnv = (keys: readonly string[]): Record<string, string | undefined> => {
  const existing = process.env.WSLENV?.trim();
  const merged = existing ? `${existing}:${keys.join(":")}` : keys.join(":");
  return {
    ...process.env,
    WSLENV: merged,
  };
};

export const readWindowsCommandOutput = async (command: string): Promise<string> => {
  const proc = Bun.spawn(["cmd.exe", "/c", command], {
    cwd: process.platform === "win32" ? undefined : "/mnt/c",
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

export const runPowerShell = async (script: string): Promise<string> => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const proc = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    {
      cwd: process.platform === "win32" ? undefined : "/mnt/c",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`PowerShell failed (${exitCode}): ${stderr.trim() || stdout.trim()}`);
  }
  return stdout.trim();
};

export const toHostFsPath = async (windowsPath: string): Promise<string> => {
  if (process.platform === "win32") {
    return windowsPath;
  }
  const proc = Bun.spawn(["wslpath", "-u", windowsPath], {
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
    throw new Error(`Failed to convert Windows path "${windowsPath}": ${stderr.trim()}`);
  }
  return stdout.trim();
};

export const toWindowsPath = async (fsPath: string): Promise<string> => {
  if (process.platform === "win32" || /^[a-zA-Z]:[\\/]/.test(fsPath) || fsPath.startsWith("\\\\")) {
    return fsPath.replace(/\//g, "\\");
  }
  const proc = Bun.spawn(["wslpath", "-w", fsPath], {
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
    throw new Error(`Failed to convert path "${fsPath}" to Windows path: ${stderr.trim()}`);
  }
  return stdout.trim();
};

export const readWindowsHostEnv = async (): Promise<WindowsHostEnv> => {
  const [localAppDataWin, appDataWin, userProfileWin, whereNode] = await Promise.all([
    readWindowsCommandOutput("echo %LOCALAPPDATA%"),
    readWindowsCommandOutput("echo %APPDATA%"),
    readWindowsCommandOutput("echo %USERPROFILE%"),
    readWindowsCommandOutput("where node"),
  ]);
  const nodeExeWin = whereNode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (nodeExeWin === undefined) {
    throw new Error("Could not locate Windows node.exe via `where node`.");
  }
  const nodeExeExecPath = await toHostFsPath(nodeExeWin);
  return {
    localAppDataWin,
    appDataWin,
    desktopWin: `${userProfileWin}\\Desktop`,
    nodeExeWin,
    nodeExeExecPath,
  };
};

const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const stopWindowsProcessesInDir = async (dirWinPath: string): Promise<number> => {
  const normalized = dirWinPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$prefix = ${psQuote(`${normalized}\\`)}
$needle = ${psQuote(normalized)}
$procs = Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) -or
  ($_.CommandLine -and $_.CommandLine.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -notmatch '^(powershell|pwsh|cmd|wsl)')
}
$pids = @($procs | Select-Object -ExpandProperty ProcessId -Unique)
foreach ($procId in $pids) {
  & taskkill.exe /F /T /PID $procId 2>$null | Out-Null
}
if ($pids.Count -gt 0) {
  $deadline = [DateTime]::UtcNow.AddSeconds(4)
  while ([DateTime]::UtcNow -lt $deadline) {
    $alive = Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $alive) { break }
    Start-Sleep -Milliseconds 150
  }
}
Write-Output $pids.Count
`;
  const output = await runPowerShell(script);
  const parsed = Number.parseInt(output.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const syncWindowsDirectory = async (
  sourceWinPath: string,
  targetWinPath: string,
): Promise<void> => {
  const src = sourceWinPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const dst = targetWinPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$src = ${psQuote(src)}
$dst = ${psQuote(dst)}
if (!(Test-Path -LiteralPath $dst)) {
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
}
$output = & robocopy.exe $src $dst /MIR /NFL /NDL /NJH /NJS /NP /R:6 /W:1
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE syncing \${src} -> \${dst} ($($output -join ' '))"
}
exit 0
`;
  await runPowerShell(script);
};

export const removeWindowsDirectory = async (targetWinPath: string): Promise<void> => {
  const target = targetWinPath.replace(/\//g, "\\").replace(/\\+$/, "");
  const script = `
$ErrorActionPreference = 'Stop'
$target = ${psQuote(target)}
if (!(Test-Path -LiteralPath $target)) { exit 0 }
for ($attempt = 1; $attempt -le 6; $attempt++) {
  try {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    exit 0
  } catch {
    if ($attempt -eq 6) { throw }
    Start-Sleep -Milliseconds (250 * $attempt)
  }
}
`;
  await runPowerShell(script);
};

export const createWindowsShortcut = async (options: WindowsShortcutOptions): Promise<void> => {
  const script = `
$ErrorActionPreference = 'Stop'
$shortcutPath = ${psQuote(options.shortcutPathWin)}
$parentDir = Split-Path -Parent $shortcutPath
if ($parentDir -and !(Test-Path $parentDir)) {
  New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = ${psQuote(options.targetPathWin)}
$shortcut.WorkingDirectory = ${psQuote(options.workingDirectoryWin)}
$shortcut.Description = ${psQuote(options.description)}
$shortcut.IconLocation = ${psQuote(`${options.targetPathWin},0`)}
$shortcut.Save()
`;
  await runPowerShell(script);
};

export const launchWindowsExecutable = async (
  exeWinPath: string,
  workingDirWinPath: string,
): Promise<void> => {
  const script = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${psQuote(exeWinPath)} -WorkingDirectory ${psQuote(workingDirWinPath)}
`;
  await runPowerShell(script);
};

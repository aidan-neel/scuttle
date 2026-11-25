import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { EffortLevel, ProviderConfig, ProviderKind, ProviderModel } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";

export interface BuiltInProviderSpec {
  readonly id: ProviderId;
  readonly kind: ProviderKind;
  readonly name: string;
  readonly defaultBinary: string;
  readonly setupHint: string;
  readonly fallbackModels: ReadonlyArray<ProviderModel>;
}

const STANDARD_EFFORTS: ReadonlyArray<EffortLevel> = ["low", "medium", "high"];
const EXTENDED_EFFORTS: ReadonlyArray<EffortLevel> = ["low", "medium", "high", "xhigh", "max"];
const CODEX_EFFORTS: ReadonlyArray<EffortLevel> = ["low", "medium", "high", "xhigh"];

export const BUILT_IN_PROVIDERS: ReadonlyArray<BuiltInProviderSpec> = [
  {
    id: ProviderId.make("claude"),
    kind: "claude",
    name: "Claude Code",
    defaultBinary: "claude",
    setupHint: "Install Claude Code (`npm i -g @anthropic-ai/claude-code`) and run `claude login`.",
    fallbackModels: [
      {
        slug: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        isDefault: true,
        efforts: [...EXTENDED_EFFORTS],
        defaultEffort: "high",
      },
      {
        slug: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        efforts: [...EXTENDED_EFFORTS],
        defaultEffort: "high",
      },
      {
        slug: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        efforts: [...STANDARD_EFFORTS],
        defaultEffort: "medium",
      },
      {
        slug: "claude-fable-5-2",
        name: "Claude Fable 5.2",
        efforts: [...EXTENDED_EFFORTS],
        defaultEffort: "high",
      },
    ],
  },
  {
    id: ProviderId.make("codex"),
    kind: "codex",
    name: "Codex",
    defaultBinary: "codex",
    setupHint: "Install Codex CLI (`npm i -g @openai/codex`) and run `codex login`.",
    fallbackModels: [
      {
        slug: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        isDefault: true,
        efforts: [...CODEX_EFFORTS],
        defaultEffort: "high",
      },
      {
        slug: "gpt-6-astra",
        name: "GPT-6 Astra",
        efforts: [...CODEX_EFFORTS],
        defaultEffort: "high",
      },
      {
        slug: "gpt-6-luna",
        name: "GPT-6 Luna",
        efforts: [...CODEX_EFFORTS],
        defaultEffort: "medium",
      },
      {
        slug: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        efforts: [...STANDARD_EFFORTS],
        defaultEffort: "medium",
      },
    ],
  },
  {
    id: ProviderId.make("antigravity"),
    kind: "antigravity",
    name: "Antigravity",
    defaultBinary: "agy",
    setupHint: "Install Antigravity CLI (`agy`) and sign in with your Google account.",
    fallbackModels: [
      {
        slug: "gemini-4-carbon",
        name: "Gemini 4 Carbon",
        isDefault: true,
        efforts: [...STANDARD_EFFORTS],
        defaultEffort: "high",
      },
      {
        slug: "gemini-4-argon",
        name: "Gemini 4 Argon",
        efforts: [...STANDARD_EFFORTS],
        defaultEffort: "high",
      },
      {
        slug: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        efforts: [...STANDARD_EFFORTS],
        defaultEffort: "medium",
      },
    ],
  },
  {
    id: ProviderId.make("opencode"),
    kind: "opencode",
    name: "OpenCode",
    defaultBinary: "opencode",
    setupHint:
      "Install OpenCode (`curl -fsSL https://opencode.ai/install | bash`) and configure a provider.",
    fallbackModels: [
      {
        slug: "default",
        name: "OpenCode Default",
        isDefault: true,
        efforts: [],
      },
    ],
  },
  {
    id: ProviderId.make("copilot"),
    kind: "copilot",
    name: "GitHub Copilot",
    defaultBinary: "copilot",
    setupHint: "Install GitHub Copilot CLI (`npm i -g @github/copilot`) and run `copilot login`.",
    fallbackModels: [
      {
        slug: "default",
        name: "Copilot Default",
        isDefault: true,
        efforts: [],
      },
    ],
  },
];

export const getBuiltInProviderSpec = (kind: ProviderKind): BuiltInProviderSpec => {
  const spec = BUILT_IN_PROVIDERS.find((entry) => entry.kind === kind);
  if (!spec) {
    throw new Error(`Unknown provider kind: ${kind}`);
  }
  return spec;
};

export const defaultProviderConfigs = (): ReadonlyArray<ProviderConfig> =>
  BUILT_IN_PROVIDERS.map((spec) => ({
    id: spec.id,
    kind: spec.kind,
    name: spec.name,
    enabled: true,
    binaryPath: "",
    launchArgs: "",
    ...(spec.fallbackModels[0] ? { defaultModel: spec.fallbackModels[0].slug } : {}),
    ...(spec.fallbackModels[0]?.defaultEffort
      ? { defaultEffort: spec.fallbackModels[0].defaultEffort }
      : {}),
  }));

export const expandHome = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (trimmed === "~") return NodeOS.homedir();
  if (trimmed.startsWith("~/")) return NodePath.join(NodeOS.homedir(), trimmed.slice(2));
  return trimmed;
};

export const resolveExecutable = (
  configuredBinary: string,
  defaultBinary: string,
): string | undefined => {
  const candidate = expandHome(configuredBinary) || defaultBinary;
  if (candidate.includes("/") || candidate.includes("\\")) {
    return NodeFS.existsSync(candidate) ? candidate : undefined;
  }
  const resolved = Bun.which(candidate);
  if (resolved) return resolved;

  const extraDirs = [
    NodePath.join(NodeOS.homedir(), ".local", "bin"),
    NodePath.join(NodeOS.homedir(), ".opencode", "bin"),
    NodePath.join(NodeOS.homedir(), ".bun", "bin"),
    "/usr/local/bin",
  ];
  for (const dir of extraDirs) {
    const full = NodePath.join(dir, candidate);
    if (NodeFS.existsSync(full)) return full;
  }
  return undefined;
};

export const tokenizeLaunchArgs = (raw: string): ReadonlyArray<string> => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) args.push(current);
  return args;
};

export const runCliProbe = async (
  command: string,
  args: ReadonlyArray<string>,
  timeoutMs = 5_000,
): Promise<{ readonly ok: boolean; readonly stdout: string; readonly stderr: string }> => {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Ignore.
      }
    }, timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
};

export const parseVersionNumber = (text: string): string | undefined => {
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(text);
  return match?.[1];
};

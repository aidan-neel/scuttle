import { afterEach, describe, expect, it } from "bun:test";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import {
  materializeProviderRuntime,
  resolveProviderRuntime,
  ShadowHomeError,
} from "../../src/providers/shadowHomes.ts";

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("shadowHomes Claude isolation", () => {
  it("strips nested session vars and preserves HOME when resolving default home", () => {
    const root = makeTempDir("scuttle-claude-default-");
    const userHome = NodePath.join(root, "home");
    const dataDir = NodePath.join(root, "data");
    NodeFS.mkdirSync(userHome, { recursive: true });

    const runtime = materializeProviderRuntime(
      {
        instanceId: "claude",
        kind: "claude",
        dataDir,
      },
      {
        userHome,
        platform: "linux",
        baseEnv: {
          HOME: userHome,
          PATH: "/usr/bin",
          CLAUDECODE: "1",
          CLAUDE_CODE_SESSION_ID: "s1",
          CLAUDE_CODE_HOST_SESSION_ID: "h1",
          CLAUDE_CODE_CHILD_SESSION: "1",
          CLAUDE_CODE_SESSION_ATTENDED: "1",
          CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/sock",
          CLAUDE_CODE_MESSAGING_TOKEN: "tok",
          CLAUDE_CODE_EXECPATH: "/usr/bin/claude",
          CLAUDE_CODE_DESKTOP_APP_VERSION: "1.0.0",
          CLAUDE_EFFORT: "high",
          CLAUDE_PID: "1234",
          CLAUDE_AGENT_SDK_VERSION: "0.1.0",
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    );

    expect(runtime.effectiveHomePath).toBe(NodePath.join(userHome, ".claude"));
    expect(runtime.env.HOME).toBe(userHome);
    expect(runtime.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(runtime.env.CLAUDECODE).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_HOST_SESSION_ID).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_SESSION_ATTENDED).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_MESSAGING_SOCKET).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_EXECPATH).toBeUndefined();
    expect(runtime.env.CLAUDE_CODE_DESKTOP_APP_VERSION).toBeUndefined();
    expect(runtime.env.CLAUDE_EFFORT).toBeUndefined();
    expect(runtime.env.CLAUDE_PID).toBeUndefined();
    expect(runtime.env.CLAUDE_AGENT_SDK_VERSION).toBeUndefined();
    expect(runtime.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("sets CLAUDE_CONFIG_DIR without touching HOME for explicit homePath > env.CLAUDE_CONFIG_DIR", () => {
    const root = makeTempDir("scuttle-claude-custom-");
    const userHome = NodePath.join(root, "home");
    const dataDir = NodePath.join(root, "data");

    const fromEnv = materializeProviderRuntime(
      {
        instanceId: "claude-work",
        kind: "claude",
        dataDir,
      },
      {
        userHome,
        platform: "darwin",
        baseEnv: {
          HOME: userHome,
          CLAUDE_CONFIG_DIR: NodePath.join(root, "env-claude"),
        },
      },
    );
    expect(fromEnv.env.CLAUDE_CONFIG_DIR).toBe(NodePath.join(root, "env-claude"));
    expect(fromEnv.env.HOME).toBe(userHome);

    const fromExplicit = materializeProviderRuntime(
      {
        instanceId: "claude-work",
        kind: "claude",
        dataDir,
        homePath: "~/claude-personal",
      },
      {
        userHome,
        platform: "darwin",
        baseEnv: {
          HOME: userHome,
          CLAUDE_CONFIG_DIR: NodePath.join(root, "env-claude"),
        },
      },
    );
    expect(fromExplicit.env.CLAUDE_CONFIG_DIR).toBe(NodePath.join(userHome, "claude-personal"));
    expect(fromExplicit.effectiveHomePath).toBe(NodePath.join(userHome, "claude-personal"));
    expect(fromExplicit.env.HOME).toBe(userHome);
  });
});

describe("shadowHomes Codex authOverlay isolation", () => {
  it("symlinks shared entries, keeps auth files private, sets marketplace flag, and strips ambient keys", () => {
    const root = makeTempDir("scuttle-codex-overlay-");
    const userHome = NodePath.join(root, "home");
    const sharedHome = NodePath.join(userHome, ".codex");
    const dataDir = NodePath.join(root, "data");
    NodeFS.mkdirSync(NodePath.join(sharedHome, "skills"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(sharedHome, "log"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(sharedHome, "memories"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(sharedHome, "auth.json"), '{"token":"shared"}\n');
    NodeFS.writeFileSync(NodePath.join(sharedHome, "auth.lock"), "lock");
    NodeFS.writeFileSync(NodePath.join(sharedHome, "models_cache.json"), "{}");
    NodeFS.writeFileSync(NodePath.join(sharedHome, "config.toml"), 'model = "gpt-6"\n');

    const runtime = materializeProviderRuntime(
      {
        instanceId: "codex/work:1",
        kind: "codex",
        dataDir,
      },
      {
        userHome,
        platform: "linux",
        baseEnv: {
          HOME: userHome,
          OPENAI_API_KEY: "ambient-openai-key",
          OPENAI_BASE_URL: "https://ambient.example",
        },
      },
    );

    const expectedShadow = NodePath.join(dataDir, "providers", "codex", "codex_work_1", "shadow");
    expect(runtime.effectiveHomePath).toBe(expectedShadow);
    expect(runtime.authDir).toBe(expectedShadow);
    expect(runtime.env.CODEX_HOME).toBe(expectedShadow);
    expect(runtime.env.OPENAI_API_KEY).toBeUndefined();
    expect(runtime.env.OPENAI_BASE_URL).toBeUndefined();
    expect(runtime.extraLaunchArgs).toEqual([
      "-c",
      `marketplaces.openai-bundled.source=${JSON.stringify(
        NodePath.join(expectedShadow, ".tmp", "bundled-marketplaces", "openai-bundled"),
      )}`,
    ]);

    expect(NodeFS.lstatSync(NodePath.join(expectedShadow, "sessions")).isSymbolicLink()).toBe(true);
    expect(NodeFS.lstatSync(NodePath.join(expectedShadow, "skills")).isSymbolicLink()).toBe(true);
    expect(NodeFS.lstatSync(NodePath.join(expectedShadow, "config.toml")).isSymbolicLink()).toBe(
      true,
    );
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "auth.json"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "auth.lock"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "models_cache.json"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "log"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "memories"))).toBe(false);
  });

  it("rejects when shadow auth.json is a symlink", () => {
    const root = makeTempDir("scuttle-codex-symlink-auth-");
    const userHome = NodePath.join(root, "home");
    const sharedHome = NodePath.join(userHome, ".codex");
    const dataDir = NodePath.join(root, "data");
    const shadowHome = NodePath.join(root, "shadow-codex");
    NodeFS.mkdirSync(sharedHome, { recursive: true });
    NodeFS.mkdirSync(shadowHome, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(sharedHome, "auth.json"), '{"token":"shared"}\n');
    NodeFS.symlinkSync(
      NodePath.join(sharedHome, "auth.json"),
      NodePath.join(shadowHome, "auth.json"),
    );

    expect(() =>
      materializeProviderRuntime(
        {
          instanceId: "codex-2",
          kind: "codex",
          dataDir,
          shadowHomePath: shadowHome,
        },
        { userHome, platform: "linux", baseEnv: {} },
      ),
    ).toThrow(ShadowHomeError);
  });
});

describe("shadowHomes Antigravity and XDG isolation", () => {
  it("creates hashed Antigravity profile dir, symlinks user skills/rules, and strips ambient keys", () => {
    const root = makeTempDir("scuttle-agy-");
    const userHome = NodePath.join(root, "home");
    const userGemini = NodePath.join(userHome, ".gemini");
    const dataDir = NodePath.join(root, "data");
    NodeFS.mkdirSync(NodePath.join(userGemini, "skills", "my-skill"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(userGemini, "antigravity", "skills", "agy-skill"), {
      recursive: true,
    });
    NodeFS.writeFileSync(NodePath.join(userGemini, "AGENTS.md"), "# Agents");
    NodeFS.writeFileSync(NodePath.join(userGemini, "GEMINI.md"), "# Gemini");

    const instanceId = "antigravity-personal";
    const idHash = NodeCrypto.createHash("sha256").update(instanceId).digest("hex");
    const expectedProfile = NodePath.join(dataDir, "providers", "antigravity", idHash.slice(0, 24));
    const expectedTemp = NodePath.join(dataDir, "antigravity-tmp", idHash.slice(0, 12));

    const runtime = materializeProviderRuntime(
      {
        instanceId,
        kind: "antigravity",
        dataDir,
      },
      {
        userHome,
        platform: "linux",
        baseEnv: {
          GEMINI_API_KEY: "ambient-gemini",
          GOOGLE_API_KEY: "ambient-google",
          GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds.json",
        },
      },
    );

    expect(runtime.effectiveHomePath).toBe(expectedProfile);
    expect(runtime.extraLaunchArgs).toEqual([
      "--gemini-dir",
      expectedProfile,
      "--app-data-dir",
      "antigravity-acp",
    ]);
    expect(runtime.env.GEMINI_HOME).toBe(expectedProfile);
    expect(runtime.env.AGY_ACP_FORCE_FILE_STORAGE).toBe("1");
    expect(runtime.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe("1");
    expect(runtime.env.TMPDIR).toBe(expectedTemp);
    expect(runtime.env.GEMINI_API_KEY).toBeUndefined();
    expect(runtime.env.GOOGLE_API_KEY).toBeUndefined();
    expect(runtime.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();

    expect(NodeFS.lstatSync(NodePath.join(expectedProfile, "skills")).isSymbolicLink()).toBe(true);
    expect(
      NodeFS.lstatSync(NodePath.join(expectedProfile, "antigravity", "skills")).isSymbolicLink(),
    ).toBe(true);
    expect(NodeFS.lstatSync(NodePath.join(expectedProfile, "AGENTS.md")).isSymbolicLink()).toBe(
      true,
    );
    expect(NodeFS.lstatSync(NodePath.join(expectedProfile, "GEMINI.md")).isSymbolicLink()).toBe(
      true,
    );

    const withConfiguredKey = materializeProviderRuntime(
      {
        instanceId,
        kind: "antigravity",
        dataDir,
        env: { GEMINI_API_KEY: "instance-key" },
      },
      {
        userHome,
        platform: "linux",
        baseEnv: { GEMINI_API_KEY: "ambient-gemini" },
      },
    );
    expect(withConfiguredKey.env.GEMINI_API_KEY).toBe("instance-key");
  });

  it("configures XDG dirs for OpenCode / Copilot / ACP-registry when shadowHomePath is set and expands ~", async () => {
    const root = makeTempDir("scuttle-xdg-");
    const userHome = NodePath.join(root, "home");
    const dataDir = NodePath.join(root, "data");

    const runtime = await Effect.runPromise(
      resolveProviderRuntime(
        {
          instanceId: "opencode-alt",
          kind: "opencode",
          dataDir,
          shadowHomePath: "~/opencode-shadow",
          env: {
            CUSTOM_PATH: "~/workspace/tools",
            PLAIN_VAR: "value",
          },
        },
        {
          userHome,
          platform: "linux",
          baseEnv: { HOME: userHome },
        },
      ),
    );

    const expectedShadow = NodePath.join(userHome, "opencode-shadow");
    expect(runtime.effectiveHomePath).toBe(expectedShadow);
    expect(runtime.env.XDG_CONFIG_HOME).toBe(NodePath.join(expectedShadow, "config"));
    expect(runtime.env.XDG_DATA_HOME).toBe(NodePath.join(expectedShadow, "data"));
    expect(runtime.env.XDG_STATE_HOME).toBe(NodePath.join(expectedShadow, "state"));
    expect(runtime.env.CUSTOM_PATH).toBe(NodePath.join(userHome, "workspace", "tools"));
    expect(runtime.env.PLAIN_VAR).toBe("value");
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "config"))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "data"))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(expectedShadow, "state"))).toBe(true);
  });
});

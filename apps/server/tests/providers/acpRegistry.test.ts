import { afterEach, describe, expect, it } from "bun:test";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  buildClientCapabilitiesMeta,
  extractQuirkToolTitle,
  filterPermissionOptions,
  shouldAlwaysSetModel,
} from "../../src/providers/acpQuirks.ts";
import {
  AcpRegistryError,
  clearRegistryCache,
  fetchRegistry,
  installRegistryAgent,
  parseRegistryJson,
  resolveDistribution,
  resolvePlatformTarget,
  resolvePlatformTargetCandidates,
  validateArchiveEntries,
  type AcpRegistryAgent,
} from "../../src/providers/acpRegistry.ts";

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  clearRegistryCache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

const sha256Hex = (data: Uint8Array | string): string =>
  NodeCrypto.createHash("sha256").update(data).digest("hex");

const sampleRegistryJson = JSON.stringify({
  version: "1.0.0",
  agents: [
    {
      id: "demo-agent",
      name: "Demo Agent",
      version: "1.2.3",
      description: "Test ACP agent",
      website: "https://example.com/demo",
      repository: "https://github.com/example/demo",
      icon: "https://example.com/icon.png",
      distribution: {
        binary: {
          "linux-x86_64": {
            archive: "https://downloads.example.com/demo-linux-x64.tar.gz",
            cmd: "bin/demo-agent",
            sha256: "a".repeat(64),
            args: ["--acp"],
          },
          "windows-x86_64": {
            archive: "https://downloads.example.com/demo-win-x64.zip",
            cmd: "demo-agent.exe",
          },
        },
        npx: {
          package: "@example/demo-acp@1.2.3",
          args: ["--stdio"],
        },
        uvx: {
          package: "demo-acp==1.2.3",
        },
      },
    },
    {
      id: "unpinned-bad",
      name: "Bad Agent",
      version: "1.0.0",
      description: "Should be skipped because unpinned semver",
      distribution: {
        npx: {
          package: "@example/bad@latest",
        },
      },
    },
    {
      id: "insecure-bad",
      name: "Insecure Agent",
      version: "1.0.0",
      description: "Should be skipped because HTTP URL",
      website: "http://example.com/insecure",
      distribution: {
        uvx: {
          package: "good-pkg==1.0.0",
        },
      },
    },
  ],
});

describe("acpRegistry schema, caching, and platform resolution", () => {
  it("parses valid registry agents and drops malformed entries", () => {
    const parsed = parseRegistryJson(sampleRegistryJson);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.agents.map((a) => a.id)).toEqual(["demo-agent"]);
    expect(parsed.agents[0]?.distribution.npx?.package).toBe("@example/demo-acp@1.2.3");
  });

  it("rejects non-HTTPS registry URLs and caches fetches in memory + disk", async () => {
    const dataDir = makeTempDir("scuttle-reg-cache-");
    await expect(
      fetchRegistry({ dataDir, registryUrl: "http://example.com/registry.json" }),
    ).rejects.toThrow(AcpRegistryError);

    let fetchCount = 0;
    const mockFetch = (async () => {
      fetchCount += 1;
      return new Response(sampleRegistryJson, { status: 200 });
    }) as unknown as typeof fetch;

    const first = await fetchRegistry({
      dataDir,
      fetchFn: mockFetch,
      nowMs: 1_000,
    });
    const second = await fetchRegistry({
      dataDir,
      fetchFn: mockFetch,
      nowMs: 60_000,
    });
    expect(first.agents.length).toBe(1);
    expect(second.agents.length).toBe(1);
    expect(fetchCount).toBe(1);

    const diskCachePath = NodePath.join(dataDir, "cache", "acp-registry", "registry.json");
    expect(NodeFS.existsSync(diskCachePath)).toBe(true);

    clearRegistryCache();
    const failingFetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const offlineFallback = await fetchRegistry({
      dataDir,
      fetchFn: failingFetch,
      nowMs: 120_000,
    });
    expect(offlineFallback.agents[0]?.id).toBe("demo-agent");
  });

  it("resolves platform targets with windows arm64 fallback and distribution preference order", () => {
    expect(resolvePlatformTarget("darwin", "arm64")).toBe("darwin-aarch64");
    expect(resolvePlatformTarget("linux", "x64")).toBe("linux-x86_64");
    expect(resolvePlatformTarget("win32", "arm64")).toBe("windows-aarch64");
    expect(resolvePlatformTargetCandidates("win32", "arm64")).toEqual([
      "windows-aarch64",
      "windows-x86_64",
    ]);

    const parsed = parseRegistryJson(sampleRegistryJson);
    const agent = parsed.agents[0]!;

    expect(resolveDistribution(agent, "auto", "linux", "x64")?.kind).toBe("binary");
    expect(resolveDistribution(agent, "auto", "win32", "arm64")?.platformTarget).toBe(
      "windows-x86_64",
    );
    expect(resolveDistribution(agent, "auto", "darwin", "arm64")?.kind).toBe("npx");
    expect(resolveDistribution(agent, "uvx", "linux", "x64")?.kind).toBe("uvx");
  });
});

describe("acpRegistry installer", () => {
  it("verifies SHA-256 on raw binary install and rejects checksum mismatches", async () => {
    const dataDir = makeTempDir("scuttle-bin-install-");
    const payload = "#!/bin/sh\necho ok\n";
    const goodSha = sha256Hex(payload);
    const targetPlatform = resolvePlatformTarget() ?? "linux-x86_64";

    const makeAgent = (sha256: string): AcpRegistryAgent => ({
      id: "raw-agent",
      name: "Raw Agent",
      version: "0.1.0",
      description: "Raw binary agent",
      distribution: {
        binary: {
          [targetPlatform]: {
            archive: "https://downloads.example.com/raw-agent",
            cmd: "raw-agent",
            sha256,
            args: ["--acp"],
            env: { AGENT_MODE: "1" },
          },
        },
      },
    });

    const fetcher = (async () => new Response(payload, { status: 200 })) as unknown as typeof fetch;

    await expect(
      installRegistryAgent({
        agent: makeAgent("0".repeat(64)),
        dataDir,
        fetchFn: fetcher,
      }),
    ).rejects.toMatchObject({ reason: "checksum_mismatch" });

    const installed = await installRegistryAgent({
      agent: makeAgent(goodSha),
      dataDir,
      fetchFn: fetcher,
    });

    expect(installed.distributionKind).toBe("binary");
    expect(installed.args).toEqual(["--acp"]);
    expect(installed.env).toEqual({ AGENT_MODE: "1" });
    expect(NodeFS.existsSync(installed.command)).toBe(true);
    expect((NodeFS.statSync(installed.command).mode & 0o111) !== 0).toBe(true);
  });

  it("extracts tar.gz archives and rejects path traversal entries", async () => {
    const dataDir = makeTempDir("scuttle-tar-install-");
    const stageSrc = makeTempDir("scuttle-tar-src-");
    const binDir = NodePath.join(stageSrc, "bin");
    NodeFS.mkdirSync(binDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(binDir, "my-agent"), "#!/bin/sh\necho hi\n", {
      mode: 0o644,
    });

    const tarPath = NodePath.join(stageSrc, "good.tar.gz");
    const proc = Bun.spawnSync(["tar", "-czf", tarPath, "-C", stageSrc, "bin/my-agent"]);
    expect(proc.exitCode).toBe(0);
    const tarBytes = NodeFS.readFileSync(tarPath);
    const targetPlatform = resolvePlatformTarget() ?? "linux-x86_64";

    const agent: AcpRegistryAgent = {
      id: "tar-agent",
      name: "Tar Agent",
      version: "2.0.0",
      description: "Tarball agent",
      distribution: {
        binary: {
          [targetPlatform]: {
            archive: "https://downloads.example.com/tar-agent.tar.gz",
            cmd: "bin/my-agent",
            sha256: sha256Hex(tarBytes),
          },
        },
      },
    };

    const installed = await installRegistryAgent({
      agent,
      dataDir,
      fetchFn: (async () => new Response(tarBytes, { status: 200 })) as unknown as typeof fetch,
    });
    expect(NodeFS.existsSync(installed.command)).toBe(true);
    expect((NodeFS.statSync(installed.command).mode & 0o111) !== 0).toBe(true);

    expect(validateArchiveEntries("./\nbin/\nbin/my-agent\n")).toBe(true);
    expect(validateArchiveEntries("../outside\n")).toBe(false);
    expect(validateArchiveEntries("/etc/passwd\n")).toBe(false);
    expect(validateArchiveEntries("bin/../../escape\n")).toBe(false);

    const traversalArchive = NodePath.join(stageSrc, "traversal.tar.gz");
    const evilSrc = makeTempDir("scuttle-tar-evil-");
    NodeFS.writeFileSync(NodePath.join(evilSrc, "escape.txt"), "evil");
    const evilTar = Bun.spawnSync([
      "tar",
      "-czf",
      traversalArchive,
      "-C",
      evilSrc,
      "--transform",
      "s,^,../,",
      "escape.txt",
    ]);
    if (evilTar.exitCode === 0) {
      const evilBytes = NodeFS.readFileSync(traversalArchive);
      await expect(
        installRegistryAgent({
          agent: {
            ...agent,
            id: "evil-tar-agent",
            distribution: {
              binary: {
                [targetPlatform]: {
                  archive: "https://downloads.example.com/evil.tar.gz",
                  cmd: "bin/my-agent",
                  sha256: sha256Hex(evilBytes),
                },
              },
            },
          },
          dataDir,
          fetchFn: (async () =>
            new Response(evilBytes, { status: 200 })) as unknown as typeof fetch,
        }),
      ).rejects.toMatchObject({ reason: "archive_invalid" });
    }

    await expect(
      installRegistryAgent({
        agent: {
          ...agent,
          id: "oversized-agent",
        },
        dataDir,
        maxArchiveBytes: 10,
        fetchFn: (async () => new Response(tarBytes, { status: 200 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ reason: "archive_invalid" });
  });

  it("installs npx and uvx distributions into isolated prefixes", async () => {
    const dataDir = makeTempDir("scuttle-pkg-install-");
    const shimDir = makeTempDir("scuttle-pkg-shims-");

    const fakeNpm = NodePath.join(shimDir, "npm");
    NodeFS.writeFileSync(
      fakeNpm,
      `#!/usr/bin/env bun
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
const prefix = process.env.npm_config_prefix;
const binDir = NodePath.join(prefix, "bin");
const pkgDir = NodePath.join(prefix, "lib", "node_modules", "@acme", "demo-acp");
NodeFS.mkdirSync(binDir, { recursive: true });
NodeFS.mkdirSync(pkgDir, { recursive: true });
NodeFS.writeFileSync(NodePath.join(pkgDir, "package.json"), JSON.stringify({
  name: "@acme/demo-acp",
  version: "1.0.0",
  bin: { "demo-acp": "index.js" }
}));
NodeFS.writeFileSync(NodePath.join(binDir, "demo-acp"), "#!/bin/sh\\necho npm\\n", { mode: 0o755 });
`,
      { mode: 0o755 },
    );

    const fakeUv = NodePath.join(shimDir, "uv");
    NodeFS.writeFileSync(
      fakeUv,
      `#!/usr/bin/env bun
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
const binDir = process.env.UV_TOOL_BIN_DIR;
NodeFS.mkdirSync(binDir, { recursive: true });
NodeFS.writeFileSync(NodePath.join(binDir, "py-agent"), "#!/bin/sh\\necho uv\\n", { mode: 0o755 });
`,
      { mode: 0o755 },
    );

    const npxAgent: AcpRegistryAgent = {
      id: "demo-acp",
      name: "Demo NPX",
      version: "1.0.0",
      description: "NPX agent",
      distribution: {
        npx: { package: "@acme/demo-acp@1.0.0", args: ["--stdio"] },
      },
    };
    const npxRes = await installRegistryAgent({
      agent: npxAgent,
      dataDir,
      preference: "npx",
      env: { PATH: `${shimDir}:${process.env.PATH ?? ""}` },
      platform: "linux",
    });
    expect(npxRes.distributionKind).toBe("npx");
    expect(npxRes.installDir).toBe(NodePath.join(dataDir, "tools", "demo-acp", "1.0.0", "npm"));
    expect(npxRes.command).toBe(NodePath.join(npxRes.installDir, "bin", "demo-acp"));
    expect(npxRes.env.PATH?.startsWith(NodePath.join(npxRes.installDir, "bin"))).toBe(true);

    const uvxAgent: AcpRegistryAgent = {
      id: "py-agent",
      name: "Demo UVX",
      version: "2.1.0",
      description: "UVX agent",
      distribution: {
        uvx: { package: "py-agent==2.1.0" },
      },
    };
    const uvxRes = await installRegistryAgent({
      agent: uvxAgent,
      dataDir,
      preference: "uvx",
      env: { PATH: `${shimDir}:${process.env.PATH ?? ""}` },
      platform: "linux",
    });
    expect(uvxRes.distributionKind).toBe("uvx");
    expect(uvxRes.installDir).toBe(NodePath.join(dataDir, "tools", "py-agent", "2.1.0", "python"));
    expect(uvxRes.command).toBe(NodePath.join(uvxRes.installDir, "bin", "py-agent"));
    expect(uvxRes.env.PATH?.startsWith(NodePath.join(uvxRes.installDir, "bin"))).toBe(true);
  });
});

describe("acpQuirks", () => {
  it("applies Devin and Copilot capabilities, permission filtering, tool titles, and model forcing", () => {
    expect(buildClientCapabilitiesMeta("devin")).toEqual({
      "cognition.ai/subagentSupport": true,
      "cognition.ai/messageGrouping": true,
    });
    const copilotMeta = buildClientCapabilitiesMeta("github-copilot-cli");
    expect(copilotMeta["github.com/copilot"]).toBeDefined();
    expect(buildClientCapabilitiesMeta("opencode")).toEqual({});

    const options = [
      { optionId: "plan_bypass", name: "Bypass" },
      { optionId: "allow_once", name: "Allow once" },
    ];
    expect(filterPermissionOptions("devin", options)).toEqual([
      { optionId: "allow_once", name: "Allow once" },
    ]);
    expect(filterPermissionOptions("opencode", options)).toEqual(options);

    expect(
      extractQuirkToolTitle("devin", {
        _meta: { "cognition.ai/inferenceToolName": "view_file" },
      }),
    ).toBe("view_file");
    expect(
      extractQuirkToolTitle("opencode", {
        _meta: { "cognition.ai/inferenceToolName": "view_file" },
      }),
    ).toBeUndefined();

    expect(shouldAlwaysSetModel("copilot")).toBe(true);
    expect(shouldAlwaysSetModel("github-copilot-cli")).toBe(true);
    expect(shouldAlwaysSetModel("devin")).toBe(false);
  });
});

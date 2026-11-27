import { afterEach, describe, expect, it } from "bun:test";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Database } from "bun:sqlite";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../src/config.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { handleProviderRoute } from "../../src/providerRoutes.ts";
import { clearRegistryCache, resolvePlatformTarget } from "../../src/providers/acpRegistry.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import { getHarnessAdapter } from "../../src/providers/registry.ts";
import type { HarnessEvent } from "../../src/providers/types.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProviderService from "../../src/services/ProviderService.ts";

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

const makeLayer = (dataDir: string, options: ProviderService.ProviderServiceOptions = {}) => {
  const configLayer = ServerConfig.layer({ dbPath: ":memory:", dataDir });
  const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
  const eventBusLayer = EventBus.layer;
  const providerLayer = ProviderService.makeLayer(options).pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
  );
  return Layer.mergeAll(configLayer, sqliteLayer, eventBusLayer, providerLayer);
};

const writeFakeScript = (dir: string, filename: string, body: string): string => {
  const filePath = NodePath.join(dir, filename);
  NodeFS.writeFileSync(filePath, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o755 });
  return filePath;
};

describe("ProviderService multi-account Shadow Homes & ACP Registry", () => {
  it("supports multi-account CRUD, slug IDs, default shadowHomePath, and built-in deletion guard", async () => {
    const dataDir = makeTempDir("scuttle-multi-acct-");
    const layer = makeLayer(dataDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ProviderService.ProviderService;
        const initial = yield* providers.listSnapshots();
        expect(initial.every((p) => p.isBuiltIn === true)).toBe(true);

        const claudeWork = yield* providers.createInstance({
          kind: "claude",
          name: "Work",
          env: { ANTHROPIC_API_KEY: "sk-ant-work" },
        });
        expect(claudeWork.id).toBe(ProviderId.make("claude-work"));
        expect(claudeWork.isBuiltIn).toBe(false);
        expect(claudeWork.shadowHomePath).toBe(
          NodePath.join(dataDir, "providers", "claude", "claude-work", "shadow"),
        );
        expect(claudeWork.env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-work" });

        const claudeWorkDup = yield* providers.createInstance({
          kind: "claude",
          name: "Work",
        });
        expect(claudeWorkDup.id).toBe(ProviderId.make("claude-work-2"));

        const codexAidan = yield* providers.createInstance({
          kind: "codex",
          name: "Aidan",
          homePath: "~/codex-shared",
        });
        expect(codexAidan.id).toBe(ProviderId.make("codex-aidan"));
        expect(codexAidan.homePath).toBe("~/codex-shared");
        expect(codexAidan.shadowHomePath).toBe(
          NodePath.join(dataDir, "providers", "codex", "codex-aidan", "shadow"),
        );

        const patched = yield* providers.updateConfig(claudeWork.id, {
          name: "Work Primary",
          env: { CUSTOM_ENV: "yes" },
        });
        expect(patched.name).toBe("Work Primary");
        expect(patched.env).toEqual({ CUSTOM_ENV: "yes" });

        const builtInErr = yield* Effect.flip(providers.deleteInstance(ProviderId.make("claude")));
        expect(builtInErr.message).toContain("cannot be deleted");

        yield* providers.deleteInstance(claudeWorkDup.id);
        const after = yield* providers.listSnapshots();
        expect(after.some((p) => p.id === claudeWorkDup.id)).toBe(false);
        expect(after.some((p) => p.id === claudeWork.id)).toBe(true);
        expect(after.some((p) => p.id === codexAidan.id)).toBe(true);
      }).pipe(Effect.provide(layer)),
    );
  });

  it("self-migrates legacy provider_configs tables missing multi-account columns", async () => {
    const dir = makeTempDir("scuttle-legacy-db-");
    const dbPath = NodePath.join(dir, "legacy.sqlite");
    const rawDb = new Database(dbPath);
    rawDb.run(`
      CREATE TABLE provider_configs (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        binary_path TEXT NOT NULL DEFAULT '',
        launch_args TEXT NOT NULL DEFAULT '',
        default_model TEXT,
        default_effort TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    rawDb.close();

    const configLayer = ServerConfig.layer({ dbPath, dataDir: dir });
    const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
    const providerLayer = ProviderService.layer.pipe(
      Layer.provide(configLayer),
      Layer.provide(sqliteLayer),
      Layer.provide(EventBus.layer),
    );

    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ProviderService.ProviderService;
        return yield* providers.createInstance({
          kind: "opencode",
          name: "Personal",
        });
      }).pipe(Effect.provide(Layer.mergeAll(configLayer, sqliteLayer, providerLayer))),
    );
    expect(created.id).toBe(ProviderId.make("opencode-personal"));
    expect(created.shadowHomePath).toBe(
      NodePath.join(dir, "providers", "opencode", "opencode-personal", "shadow"),
    );
  });

  it("checks Claude auth hints against resolved CLAUDE_CONFIG_DIR", async () => {
    const root = makeTempDir("scuttle-claude-probe-");
    const fakeBin = writeFakeScript(
      root,
      "fake-claude",
      `if (process.argv.includes("--version")) { console.log("claude 2.1.0"); process.exit(0); }`,
    );
    const isolatedDir = NodePath.join(root, "isolated-claude");
    NodeFS.mkdirSync(isolatedDir, { recursive: true });

    const unauthSnap = await Effect.runPromise(
      claudeAdapter.probe(
        {
          id: ProviderId.make("claude-iso"),
          kind: "claude",
          name: "Claude Iso",
          enabled: true,
          binaryPath: fakeBin,
          launchArgs: "",
          shadowHomePath: isolatedDir,
        },
        { dataDir: root },
      ),
    );
    expect(unauthSnap.version).toBe("2.1.0");
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      expect(unauthSnap.status).toBe("unauthenticated");
    }

    NodeFS.writeFileSync(NodePath.join(isolatedDir, ".credentials.json"), '{"token":"ok"}\n');
    const readySnap = await Effect.runPromise(
      claudeAdapter.probe(
        {
          id: ProviderId.make("claude-iso"),
          kind: "claude",
          name: "Claude Iso",
          enabled: true,
          binaryPath: fakeBin,
          launchArgs: "",
          shadowHomePath: isolatedDir,
        },
        { dataDir: root },
      ),
    );
    expect(readySnap.status).toBe("ready");
  });

  it("lists ACP Registry agents, installs binary agent, persists config, and wires ACP quirks + XDG isolation", async () => {
    const dataDir = makeTempDir("scuttle-acp-reg-");
    const binDir = makeTempDir("scuttle-acp-bin-");
    const capturePath = NodePath.join(dataDir, "devin-capture.json");

    const scriptBody = `#!/usr/bin/env bun
import * as NodeFS from "node:fs";
if (process.argv.includes("--version")) {
  console.log("devin-acp 1.4.0");
  process.exit(0);
}
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = { env: { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, REG_TOKEN: process.env.REG_TOKEN }, init: null };
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    captured.init = msg.params;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + "\\n");
  } else if (msg.method === "session/new") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        sessionId: "devin-sess-1",
        models: { currentModelId: "devin-default", availableModels: [{ modelId: "devin-default", name: "Devin Default" }] }
      }
    }) + "\\n");
  } else if (msg.method === "session/prompt") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "devin-sess-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-1",
          kind: "tool",
          _meta: { "cognition.ai/inferenceToolName": "view_file" },
          rawInput: { file_path: "/tmp/demo.ts" },
          status: "in_progress"
        }
      }
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "session/request_permission",
      params: {
        toolCall: { title: "Allow edit" },
        options: [
          { optionId: "plan_bypass", name: "Bypass plan", kind: "allow_once" },
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" }
        ]
      }
    }) + "\\n");
  } else if (msg.id === 99 && msg.result) {
    captured.permOutcome = msg.result;
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } }) + "\\n");
  }
});
`;
    const sha256 = NodeCrypto.createHash("sha256").update(scriptBody).digest("hex");
    const targetPlatform = resolvePlatformTarget() ?? "linux-x86_64";
    const registryJson = JSON.stringify({
      version: "1.0.0",
      agents: [
        {
          id: "devin",
          name: "Devin",
          version: "1.4.0",
          description: "Devin ACP agent",
          distribution: {
            binary: {
              [targetPlatform]: {
                archive: "https://downloads.example.com/devin",
                cmd: "devin",
                sha256,
                args: ["--acp"],
                env: { REG_TOKEN: "from-reg" },
              },
            },
          },
        },
      ],
    });

    const mockFetch = (async (url: string) => {
      if (String(url).includes("registry.json")) {
        return new Response(registryJson, { status: 200 });
      }
      return new Response(scriptBody, { status: 200 });
    }) as unknown as typeof fetch;

    const layer = makeLayer(dataDir, { fetchFn: mockFetch });

    const installed = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ProviderService.ProviderService;
        const before = yield* providers.listAcpRegistry({ refresh: true });
        expect(before).toHaveLength(1);
        expect(before[0]?.installed).toBe(false);
        expect(before[0]?.distributions).toContain("binary");

        const snap = yield* providers.installAcpAgent({ agentId: "devin" });
        expect(snap.id).toBe(ProviderId.make("acp-devin"));
        expect(snap.kind).toBe("acp-registry");
        expect(snap.acpAgentId).toBe("devin");
        expect(snap.acpVersion).toBe("1.4.0");
        expect(snap.acpDistribution).toBe("binary");
        expect(snap.status).toBe("ready");
        expect(snap.launchArgs).toBe("--acp");
        expect(snap.models.map((m) => m.slug)).toContain("devin-default");

        const after = yield* providers.listAcpRegistry();
        expect(after[0]?.installed).toBe(true);
        expect(after[0]?.installedInstanceId).toBe(snap.id);
        return snap;
      }).pipe(Effect.provide(layer)),
    );

    const adapter = getHarnessAdapter("acp-registry");
    const events: HarnessEvent[] = [];
    await adapter.runTurn({
      config: {
        id: installed.id,
        kind: installed.kind,
        name: installed.name,
        enabled: installed.enabled,
        binaryPath: installed.binaryPath,
        launchArgs: installed.launchArgs,
        ...(installed.shadowHomePath !== undefined
          ? { shadowHomePath: installed.shadowHomePath }
          : {}),
        ...(installed.env !== undefined ? { env: installed.env } : {}),
        ...(installed.acpAgentId !== undefined ? { acpAgentId: installed.acpAgentId } : {}),
        ...(installed.acpVersion !== undefined ? { acpVersion: installed.acpVersion } : {}),
        ...(installed.acpDistribution !== undefined
          ? { acpDistribution: installed.acpDistribution }
          : {}),
      },
      cwd: binDir,
      prompt: "Inspect demo.ts",
      model: "devin-default",
      runtimeMode: "auto",
      interactionMode: "default",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      env: Record<string, string>;
      init: { clientCapabilities?: { _meta?: Record<string, unknown> } };
      permOutcome: { outcome?: { optionId?: string } };
    };
    expect(captured.env.XDG_CONFIG_HOME).toBe(NodePath.join(installed.shadowHomePath!, "config"));
    expect(captured.env.XDG_DATA_HOME).toBe(NodePath.join(installed.shadowHomePath!, "data"));
    expect(captured.env.REG_TOKEN).toBe("from-reg");
    expect(captured.init.clientCapabilities?._meta).toEqual({
      "cognition.ai/subagentSupport": true,
      "cognition.ai/messageGrouping": true,
    });
    expect(captured.permOutcome.outcome?.optionId).toBe("allow_once");
    expect(events.some((e) => e.kind === "activity.started" && e.activityKind === "file")).toBe(
      true,
    );
  });

  it("handles /api/providers/* and /api/acp-registry/* routes via handleProviderRoute", async () => {
    const dataDir = makeTempDir("scuttle-routes-");
    const registryJson = JSON.stringify({
      version: "1.0.0",
      agents: [
        {
          id: "demo-cli",
          name: "Demo CLI",
          version: "0.1.0",
          description: "Demo",
          distribution: { npx: { package: "demo-cli@0.1.0" } },
        },
      ],
    });
    const layer = makeLayer(dataDir, {
      fetchFn: (async () => new Response(registryJson, { status: 200 })) as unknown as typeof fetch,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ProviderService.ProviderService;
        const call = (method: string, path: string, body?: unknown) =>
          handleProviderRoute(
            new Request(`http://localhost${path}`, {
              method,
              ...(body !== undefined
                ? {
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  }
                : {}),
            }),
            new URL(`http://localhost${path}`),
            providers,
            method,
          );

        const listRes = yield* call("GET", "/api/providers");
        expect(listRes?.status).toBe(200);

        const createRes = yield* call("POST", "/api/providers", {
          kind: "claude",
          name: "Route Test",
        });
        expect(createRes?.status).toBe(201);
        const created = (yield* Effect.promise(() => createRes!.json())) as { id: string };
        expect(created.id).toBe("claude-route-test");

        const patchRes = yield* call("PATCH", `/api/providers/${created.id}`, {
          name: "Route Renamed",
        });
        expect(patchRes?.status).toBe(200);

        const deleteBuiltInRes = yield* call("DELETE", "/api/providers/claude");
        expect(deleteBuiltInRes?.status).toBe(400);

        const deleteRes = yield* call("DELETE", `/api/providers/${created.id}`);
        expect(deleteRes?.status).toBe(204);

        const regRes = yield* call("GET", "/api/acp-registry");
        expect(regRes?.status).toBe(200);
        const regBody = (yield* Effect.promise(() => regRes!.json())) as Array<{ id: string }>;
        expect(regBody[0]?.id).toBe("demo-cli");

        const unmatched = yield* call("GET", "/api/other");
        expect(unmatched).toBeNull();
      }).pipe(Effect.provide(layer)),
    );
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { createAcpAdapter } from "../../src/providers/acpAdapter.ts";
import { DEFAULT_ACP_STDIO_BRIDGE_PATH } from "../../src/providers/acpMcp.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import { codexAdapter } from "../../src/providers/codexAdapter.ts";
import { StdioJsonRpcProcess } from "../../src/providers/stdioJsonRpc.ts";
import type { HarnessEvent, SteerHandler } from "../../src/providers/types.ts";
import { startScuttleServer } from "../../src/server.ts";

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const writeFakeScript = (dir: string, filename: string, body: string): string => {
  const scriptPath = NodePath.join(dir, filename);
  NodeFS.writeFileSync(scriptPath, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o755 });
  return scriptPath;
};

const makeCfg = (
  id: string,
  kind: ProviderConfig["kind"],
  binaryPath: string,
  acpAgentId?: string,
): ProviderConfig => ({
  id: ProviderId.make(id),
  kind,
  name: id,
  enabled: true,
  binaryPath,
  launchArgs: "",
  ...(acpAgentId ? { acpAgentId } : {}),
});

const mcpFor = (tok: string, threadId: string) => ({
  url: "http://127.0.0.1:4310/mcp",
  authorizationHeader: `Bearer ${tok}`,
  threadId,
});

const waitUntil = async (fn: () => boolean) => {
  while (!fn()) await Bun.sleep(10);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    NodeFS.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("StdioJsonRpcProcess env stripping", () => {
  it("does not leak stripped process.env keys when replaceEnv is true", async () => {
    const dir = makeTempDir("scuttle-rpc-env-");
    const prevKey = process.env.OPENAI_API_KEY;
    const prevKeep = process.env.SCUTTLE_KEEP_ENV_TEST;
    process.env.OPENAI_API_KEY = "leaked-ambient-key";
    process.env.SCUTTLE_KEEP_ENV_TEST = "ambient-value";

    try {
      const script = writeFakeScript(
        dir,
        "env-echo.ts",
        `const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "check") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
      openaiKey: process.env.OPENAI_API_KEY ?? null,
      keepTest: process.env.SCUTTLE_KEEP_ENV_TEST ?? null,
      custom: process.env.CUSTOM_ISOLATED ?? null,
    } }) + "\\n");
  }
});`,
      );

      const isolatedRpc = new StdioJsonRpcProcess({
        command: script,
        args: [],
        cwd: dir,
        env: { PATH: process.env.PATH, CUSTOM_ISOLATED: "yes" },
        replaceEnv: true,
      });
      expect(await isolatedRpc.request("check")).toEqual({
        openaiKey: null,
        keepTest: null,
        custom: "yes",
      });
      isolatedRpc.kill();

      const unsetRpc = new StdioJsonRpcProcess({
        command: script,
        args: [],
        cwd: dir,
        env: { OPENAI_API_KEY: undefined, CUSTOM_ISOLATED: "no" },
      });
      expect(await unsetRpc.request("check")).toEqual({
        openaiKey: null,
        keepTest: "ambient-value",
        custom: "no",
      });
      unsetRpc.kill();
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevKeep === undefined) delete process.env.SCUTTLE_KEEP_ENV_TEST;
      else process.env.SCUTTLE_KEEP_ENV_TEST = prevKeep;
    }
  });
});

describe("claudeAdapter steer + MCP injection", () => {
  it("passes --mcp-config, emits firstTokenMs, writes NDJSON steer, and returns false after end", async () => {
    const dir = makeTempDir("scuttle-claude-steer-");
    const capturePath = NodePath.join(dir, "captured.json");
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const script = writeFakeScript(
      dir,
      "fake-claude.ts",
      `import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = { argv: process.argv.slice(2), messages: [] };
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  captured.messages.push(msg);
  if (captured.messages.length === 1) {
    process.stdout.write(JSON.stringify({ type: "stream_event", session_id: "claude-sess-1", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Working..." } } }) + "\\n");
  } else if (captured.messages.length === 2) {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
    process.stdout.write(JSON.stringify({ type: "result", session_id: "claude-sess-1", is_error: false, result: "Steered done." }) + "\\n");
  }
});`,
    );

    let steerHandler: SteerHandler | undefined;
    const events: HarnessEvent[] = [];
    const turnPromise = claudeAdapter.runTurn({
      config: makeCfg("claude", "claude", script),
      cwd: dir,
      prompt: "Initial prompt",
      model: "claude-sonnet-5-5",
      runtimeMode: "auto",
      interactionMode: "default",
      mcpServer: mcpFor("tok-claude", "th-1"),
      registerSteer: (h) => {
        steerHandler = h;
      },
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    await waitUntil(() => events.some((e) => e.kind === "assistant.delta"));
    expect(
      await steerHandler!({
        prompt: "Focus on tests",
        attachments: [
          {
            id: "att-1",
            name: "shot.png",
            mimeType: "image/png",
            path: "/tmp/shot.png",
            bytes: pngBytes,
          },
        ],
      }),
    ).toBe(true);

    const result = await turnPromise;
    expect(result.finalText).toBe("Steered done.");
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(await steerHandler!({ prompt: "Too late" })).toBe(false);

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      argv: string[];
      messages: Array<Record<string, unknown>>;
    };
    const mcpIdx = captured.argv.indexOf("--mcp-config");
    expect(JSON.parse(captured.argv[mcpIdx + 1]!)).toEqual({
      mcpServers: {
        scuttle: {
          type: "http",
          url: "http://127.0.0.1:4310/mcp",
          headers: { Authorization: "Bearer tok-claude" },
        },
      },
    });
    expect(captured.messages[1]?.priority).toBe("next");
    expect(typeof captured.messages[1]?.uuid).toBe("string");
    expect(captured.messages[1]?.message).toEqual({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: Buffer.from(pngBytes).toString("base64"),
          },
        },
        { type: "text", text: "Focus on tests" },
      ],
    });
  });
});

describe("codexAdapter steer + MCP injection", () => {
  it("passes mcp_servers.scuttle config, calls turn/steer with nativeTurnId, and emits firstTokenMs", async () => {
    const dir = makeTempDir("scuttle-codex-steer-");
    const capturePath = NodePath.join(dir, "captured.json");

    const script = writeFakeScript(
      dir,
      "fake-codex.ts",
      `import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = { threadStart: null, turnSteer: null };
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  else if (msg.method === "thread/start") {
    captured.threadStart = msg.params;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "codex-th-1" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "codex-turn-1" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { delta: "Thinking..." } }) + "\\n");
  } else if (msg.method === "turn/steer") {
    captured.turnSteer = msg.params;
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { item: { id: "m1", type: "agentMessage", text: "Codex done." } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { turn: { id: "codex-turn-1", status: "completed" } } }) + "\\n");
  }
});`,
    );

    let steerHandler: SteerHandler | undefined;
    const events: HarnessEvent[] = [];
    const turnPromise = codexAdapter.runTurn({
      config: makeCfg("codex", "codex", script),
      cwd: dir,
      prompt: "Initial codex prompt",
      model: "gpt-6.1-sol",
      runtimeMode: "auto",
      interactionMode: "default",
      mcpServer: mcpFor("tok-codex", "th-codex"),
      registerSteer: (h) => {
        steerHandler = h;
      },
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    await waitUntil(
      () => Boolean(steerHandler) && events.some((e) => e.kind === "assistant.delta"),
    );
    expect(await steerHandler!({ prompt: "Switch target" })).toBe(true);

    const result = await turnPromise;
    expect(result.finalText).toBe("Codex done.");
    expect(result.providerSessionId).toBe("codex-th-1");
    expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(await steerHandler!({ prompt: "After end" })).toBe(false);

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      threadStart: Record<string, unknown>;
      turnSteer: Record<string, unknown>;
    };
    expect(captured.threadStart.config).toEqual({
      "mcp_servers.scuttle": {
        url: "http://127.0.0.1:4310/mcp",
        http_headers: { Authorization: "Bearer tok-codex" },
        tool_timeout_sec: 3900,
      },
    });
    expect(captured.turnSteer).toEqual({
      threadId: "codex-th-1",
      expectedTurnId: "codex-turn-1",
      input: [{ type: "text", text: "Switch target" }],
    });
  });
});

describe("acpAdapter HTTP vs stdio bridge MCP + steer", () => {
  const makeFakeAcpScript = (dir: string, name: string, httpCap: boolean, capturePath: string) =>
    writeFakeScript(
      dir,
      name,
      `import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = { sessionNew: null, prompts: [] };
let mainPromptId = null;
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: ${httpCap ? "true" : "false"} }, promptCapabilities: { image: true } } } }) + "\\n");
  } else if (msg.method === "session/new") {
    captured.sessionNew = msg.params;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "acp-sess-1" } }) + "\\n");
  } else if (msg.method === "session/prompt") {
    captured.prompts.push(msg.params);
    if (captured.prompts.length === 1) {
      mainPromptId = msg.id;
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "acp-sess-1", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reading..." } } } }) + "\\n");
    } else {
      NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
      process.stdout.write(JSON.stringify(${httpCap ? '{ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }' : '{ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Busy" } }'}) + "\\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: mainPromptId, result: { stopReason: "end_turn" } }) + "\\n");
    }
  }
});`,
    );

  it("uses HTTP MCP when agentCapabilities.mcpCapabilities.http is true and steers via session/prompt", async () => {
    const dir = makeTempDir("scuttle-acp-http-");
    const capturePath = NodePath.join(dir, "acp-http.json");
    const script = makeFakeAcpScript(dir, "acp-http.ts", true, capturePath);
    let steerHandler: SteerHandler | undefined;
    const events: HarnessEvent[] = [];
    const turnPromise = createAcpAdapter("opencode").runTurn({
      config: makeCfg("opencode", "opencode", script),
      cwd: dir,
      prompt: "Main task",
      model: "default",
      runtimeMode: "auto",
      interactionMode: "default",
      mcpServer: mcpFor("tok-acp-http", "th-acp-1"),
      registerSteer: (h) => {
        steerHandler = h;
      },
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    await waitUntil(() => Boolean(steerHandler) && events.some((e) => e.kind === "thinking.delta"));
    expect(await steerHandler!({ prompt: "Steer ACP" })).toBe(true);
    expect((await turnPromise).firstTokenMs).toBeGreaterThanOrEqual(0);
    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      sessionNew: { mcpServers: Array<Record<string, unknown>> };
    };
    expect(captured.sessionNew.mcpServers).toEqual([
      {
        type: "http",
        name: "scuttle",
        url: "http://127.0.0.1:4310/mcp",
        headers: [{ name: "Authorization", value: "Bearer tok-acp-http" }],
      },
    ]);
  });

  it("falls back to stdioBridge when http MCP capability is false and returns false when busy", async () => {
    const dir = makeTempDir("scuttle-acp-stdio-");
    const capturePath = NodePath.join(dir, "acp-stdio.json");
    const script = makeFakeAcpScript(dir, "acp-stdio.ts", false, capturePath);
    let steerHandler: SteerHandler | undefined;
    const events: HarnessEvent[] = [];
    const turnPromise = createAcpAdapter("acp-registry").runTurn({
      config: makeCfg("acp-demo", "acp-registry", script, "demo"),
      cwd: dir,
      prompt: "Main task",
      model: "default",
      runtimeMode: "auto",
      interactionMode: "default",
      mcpServer: mcpFor("tok-acp-stdio", "th-acp-2"),
      registerSteer: (h) => {
        steerHandler = h;
      },
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    await waitUntil(() => Boolean(steerHandler) && events.some((e) => e.kind === "thinking.delta"));
    expect(await steerHandler!({ prompt: "Steer while busy" })).toBe(false);
    await turnPromise;
    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      sessionNew: { mcpServers: Array<Record<string, unknown>> };
    };
    expect(captured.sessionNew.mcpServers).toEqual([
      {
        name: "scuttle",
        command: process.execPath,
        args: [DEFAULT_ACP_STDIO_BRIDGE_PATH],
        env: [
          { name: "SCUTTLE_MCP_ENDPOINT", value: "http://127.0.0.1:4310/mcp" },
          { name: "SCUTTLE_MCP_AUTHORIZATION", value: "Bearer tok-acp-stdio" },
        ],
      },
    ]);
  });
});

describe("server /mcp + /api/providers wiring", () => {
  it("mounts /mcp, routes /api/providers, and mints per-thread MCP tokens on turn dispatch", async () => {
    const dir = makeTempDir("scuttle-server-mcp-");
    const projectDir = makeTempDir("scuttle-proj-mcp-");
    const prevDisableProbes = process.env.SCUTTLE_DISABLE_STARTUP_PROBES;
    process.env.SCUTTLE_DISABLE_STARTUP_PROBES = "1";

    const fakeClaude = writeFakeScript(
      dir,
      "fake-claude-mcp.ts",
      `const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type !== "user") return;
  const mcpIdx = process.argv.indexOf("--mcp-config");
  const scuttle = mcpIdx >= 0 ? JSON.parse(process.argv[mcpIdx + 1])?.mcpServers?.scuttle : null;
  let toolOk = false;
  if (scuttle) {
    const res = await fetch(scuttle.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: scuttle.headers.Authorization },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "scuttle_capabilities", arguments: {} } }),
    });
    toolOk = res.status === 200 && (await res.json()).result?.isError === false;
  }
  process.stdout.write(JSON.stringify({ type: "result", session_id: "sess-live-mcp", is_error: false, result: toolOk ? "MCP_OK" : "MCP_FAIL" }) + "\\n");
});`,
    );

    const handle = await startScuttleServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: NodePath.join(dir, "state.sqlite"),
      dataDir: dir,
      seedCwdProject: false,
    });
    try {
      const api = (path: string, method = "GET", body?: unknown) =>
        fetch(`${handle.url}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      const providersRes = await api("/api/providers");
      expect(providersRes.status).toBe(200);
      expect(
        ((await providersRes.json()) as Array<{ id: string }>).some((p) => p.id === "claude"),
      ).toBe(true);
      expect((await api("/api/providers/claude", "PATCH", { binaryPath: fakeClaude })).status).toBe(
        200,
      );
      const project = (await (
        await api("/api/projects", "POST", { path: projectDir, name: "McpProj" })
      ).json()) as { id: string; defaultBranch: string };
      const threadRes = await api("/api/threads", "POST", {
        projectId: project.id,
        prompt: "Check MCP",
        runtime: "local",
        branch: project.defaultBranch,
        modelSelection: {
          providerId: "claude",
          providerKind: "claude",
          model: "claude-sonnet-5-5",
        },
      });
      expect(threadRes.status).toBe(201);
      const detail = (await threadRes.json()) as { thread: { id: string } };
      let finalAssistant = "";
      for (let i = 0; i < 60; i++) {
        const d = (await (await api(`/api/threads/${detail.thread.id}`)).json()) as {
          turns: Array<{ status: string; assistantMessage: string }>;
        };
        if (d.turns[0]?.status === "completed") {
          finalAssistant = d.turns[0].assistantMessage;
          break;
        }
        await Bun.sleep(25);
      }
      expect(finalAssistant).toBe("MCP_OK");
      expect((await api("/mcp", "POST", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(
        401,
      );
    } finally {
      await handle.stop();
      if (prevDisableProbes === undefined) delete process.env.SCUTTLE_DISABLE_STARTUP_PROBES;
      else process.env.SCUTTLE_DISABLE_STARTUP_PROBES = prevDisableProbes;
    }
  });
});

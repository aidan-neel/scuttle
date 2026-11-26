import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { createAcpAdapter } from "../../src/providers/acpAdapter.ts";
import { codexAdapter } from "../../src/providers/codexAdapter.ts";
import type { HarnessEvent } from "../../src/providers/types.ts";

const writeFakeCliScript = (dir: string, filename: string, scriptBody: string): string => {
  const scriptPath = NodePath.join(dir, filename);
  NodeFS.writeFileSync(scriptPath, `#!/usr/bin/env bun\n${scriptBody}\n`, { mode: 0o755 });
  return scriptPath;
};

describe("adapter resume fallback and ACP usage_update", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends freshSessionPrompt when Codex thread/resume fails and falls back to thread/start", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-codex-fb-"));
    tempDirs.push(dir);
    const capturePath = NodePath.join(dir, "captured.json");

    const scriptPath = writeFakeCliScript(
      dir,
      "fake-codex",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  } else if (msg.method === "thread/resume") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "session expired" } }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "new-codex-thread" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(msg.params));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn-1" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { item: { id: "m1", type: "agentMessage", text: "ok" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } }) + "\\n");
  }
});
`,
    );

    const config: ProviderConfig = {
      id: ProviderId.make("codex"),
      kind: "codex",
      name: "Codex",
      enabled: true,
      binaryPath: scriptPath,
      launchArgs: "",
    };
    const events: HarnessEvent[] = [];
    const result = await codexAdapter.runTurn({
      config,
      cwd: dir,
      prompt: "bare resumed prompt",
      freshSessionPrompt:
        "<scuttle_agent_context>full</scuttle_agent_context>\n\n<scuttle_session_handoff>handoff</scuttle_session_handoff>\n\nbare resumed prompt",
      model: "gpt-5-codex",
      runtimeMode: "full-access",
      interactionMode: "default",
      providerSessionId: "stale-codex-sess",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    expect(result.providerSessionId).toBe("new-codex-thread");
    const sent = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      input: Array<{ text: string }>;
    };
    expect(sent.input[0]?.text).toContain("<scuttle_agent_context>");
    expect(sent.input[0]?.text).toContain("<scuttle_session_handoff>");
    expect(
      events.some((e) => e.kind === "session" && e.providerSessionId === "new-codex-thread"),
    ).toBe(true);
  });

  it("sends freshSessionPrompt when ACP resume/load fail and captures usage_update occupancy + contextWindowTokens", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-acp-fb-"));
    tempDirs.push(dir);
    const capturePath = NodePath.join(dir, "captured-acp.json");

    const scriptPath = writeFakeCliScript(
      dir,
      "fake-acp",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }) + "\\n");
  } else if (msg.method === "session/resume" || msg.method === "session/load") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "not found" } }) + "\\n");
  } else if (msg.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "new-acp-sess" } }) + "\\n");
  } else if (msg.method === "session/prompt") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(msg.params));
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "new-acp-sess", update: { sessionUpdate: "usage_update", used: 18500, size: 1000000 } }
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { usage: { inputTokens: 2000, outputTokens: 250, cachedReadTokens: 1200 } }
    }) + "\\n");
  }
});
`,
    );

    const adapter = createAcpAdapter("antigravity");
    const config: ProviderConfig = {
      id: ProviderId.make("antigravity"),
      kind: "antigravity",
      name: "Gemini",
      enabled: true,
      binaryPath: scriptPath,
      launchArgs: "",
    };
    const events: HarnessEvent[] = [];
    const result = await adapter.runTurn({
      config,
      cwd: dir,
      prompt: "bare acp resumed",
      freshSessionPrompt:
        "<scuttle_agent_context>full</scuttle_agent_context>\n\n<scuttle_session_handoff>handoff</scuttle_session_handoff>\n\nbare acp resumed",
      model: "default",
      runtimeMode: "full-access",
      interactionMode: "default",
      providerSessionId: "stale-acp-sess",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    const sent = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      prompt: Array<{ text: string }>;
    };
    expect(sent.prompt[0]?.text).toContain("<scuttle_agent_context>");
    expect(sent.prompt[0]?.text).toContain("<scuttle_session_handoff>");

    const usageEvents = events.filter((e) => e.kind === "usage");
    expect(usageEvents).toHaveLength(2);
    expect(usageEvents[0]).toEqual({
      kind: "usage",
      usage: { inputTokens: 18_500, outputTokens: 0, contextWindowTokens: 1_000_000 },
    });
    expect(result.usage).toEqual({
      inputTokens: 800,
      outputTokens: 250,
      cacheReadTokens: 1200,
      contextWindowTokens: 1_000_000,
    });
  });
});

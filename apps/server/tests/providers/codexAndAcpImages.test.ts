import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { createAcpAdapter } from "../../src/providers/acpAdapter.ts";
import { codexAdapter } from "../../src/providers/codexAdapter.ts";

const writeFakeScript = (dir: string, filename: string, body: string): string => {
  const path = NodePath.join(dir, filename);
  NodeFS.writeFileSync(path, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o755 });
  return path;
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

describe("Codex and ACP image forwarding", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      NodeFS.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  const makeTempDir = (prefix: string) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  };

  it("sends data URI image items in Codex turn/start params.input", async () => {
    const dir = makeTempDir("scuttle-codex-img-");
    const capturePath = NodePath.join(dir, "codex-capture.json");
    const scriptPath = writeFakeScript(
      dir,
      "fake-codex",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "thr-1" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(msg.params));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "trn-1" } } }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: { item: { id: "msg-1", type: "agentMessage", text: "Analyzed." } },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { turn: { id: "trn-1", status: "completed" } },
    }) + "\\n");
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

    const result = await codexAdapter.runTurn({
      config,
      cwd: dir,
      prompt: "Check this screenshot",
      model: "gpt-5.4",
      runtimeMode: "auto",
      interactionMode: "default",
      resolvedAttachments: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "shot.png",
          mimeType: "image/png",
          path: "/tmp/shot.png",
          bytes: PNG_BYTES,
        },
      ],
      signal: new AbortController().signal,
      emit: () => {},
    });

    expect(result.finalText).toBe("Analyzed.");
    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      input: Array<Record<string, unknown>>;
    };
    expect(captured.input).toEqual([
      { type: "text", text: "Check this screenshot" },
      { type: "image", url: `data:image/png;base64,${PNG_B64}` },
    ]);
  });

  it("sends base64 image blocks in ACP session/prompt when promptCapabilities.image is true", async () => {
    const dir = makeTempDir("scuttle-acp-img-true-");
    const capturePath = NodePath.join(dir, "acp-true.json");
    const scriptPath = writeFakeScript(
      dir,
      "fake-acp-true",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { agentCapabilities: { promptCapabilities: { image: true } } },
    }) + "\\n");
  } else if (msg.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "acp-1" } }) + "\\n");
  } else if (msg.method === "session/set_config_option") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  } else if (msg.method === "session/prompt") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(msg.params));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  }
});
`,
    );

    const adapter = createAcpAdapter("opencode");
    await adapter.runTurn({
      config: {
        id: ProviderId.make("opencode"),
        kind: "opencode",
        name: "OpenCode",
        enabled: true,
        binaryPath: scriptPath,
        launchArgs: "",
      },
      cwd: dir,
      prompt: "Look closely",
      model: "default",
      runtimeMode: "auto",
      interactionMode: "default",
      resolvedAttachments: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "ui.png",
          mimeType: "image/png",
          path: "/data/attachments/22222222-2222-4222-8222-222222222222.png",
          bytes: PNG_BYTES,
        },
      ],
      signal: new AbortController().signal,
      emit: () => {},
    });

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      prompt: Array<Record<string, unknown>>;
    };
    expect(captured.prompt).toEqual([
      { type: "image", data: PNG_B64, mimeType: "image/png" },
      { type: "text", text: "Look closely" },
    ]);
  });

  it("falls back to on-disk image path in ACP session/prompt when promptCapabilities.image is false", async () => {
    const dir = makeTempDir("scuttle-acp-img-false-");
    const capturePath = NodePath.join(dir, "acp-false.json");
    const scriptPath = writeFakeScript(
      dir,
      "fake-acp-false",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { agentCapabilities: { promptCapabilities: { image: false } } },
    }) + "\\n");
  } else if (msg.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "acp-2" } }) + "\\n");
  } else if (msg.method === "session/prompt") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(msg.params));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  }
});
`,
    );

    const storedPath = "/data/attachments/33333333-3333-4333-8333-333333333333.png";
    const adapter = createAcpAdapter("opencode");
    await adapter.runTurn({
      config: {
        id: ProviderId.make("opencode"),
        kind: "opencode",
        name: "OpenCode",
        enabled: true,
        binaryPath: scriptPath,
        launchArgs: "",
      },
      cwd: dir,
      prompt: "Inspect screenshot",
      model: "default",
      runtimeMode: "auto",
      interactionMode: "default",
      resolvedAttachments: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "ui.png",
          mimeType: "image/png",
          path: storedPath,
          bytes: PNG_BYTES,
        },
      ],
      signal: new AbortController().signal,
      emit: () => {},
    });

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      prompt: Array<Record<string, unknown>>;
    };
    expect(captured.prompt).toEqual([
      {
        type: "text",
        text: `Inspect screenshot\n\nAttached image saved at: ${storedPath}`,
      },
    ]);
  });
});

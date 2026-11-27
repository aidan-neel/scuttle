import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { claudeAdapter, isScuttleBridgeCurl } from "../../src/providers/claudeAdapter.ts";
import type { HarnessEvent } from "../../src/providers/types.ts";

const writeFakeClaudeScript = (dir: string, filename: string, scriptBody: string): string => {
  const scriptPath = NodePath.join(dir, filename);
  NodeFS.writeFileSync(scriptPath, `#!/usr/bin/env bun\n${scriptBody}\n`, { mode: 0o755 });
  return scriptPath;
};

describe("isScuttleBridgeCurl", () => {
  const apiUrl = "http://127.0.0.1:4310";

  it("allows single-command curl calls targeting the Scuttle REST bridge", () => {
    expect(
      isScuttleBridgeCurl(
        "Bash",
        `curl -sS -X PATCH "${apiUrl}/api/agents/a1" -H "Content-Type: application/json" -d '{"purpose":"Own repo; keep files < 500 lines"}'`,
        apiUrl,
      ),
    ).toBe(true);
    expect(
      isScuttleBridgeCurl(
        "Bash",
        `curl -sS -X POST "$SCUTTLE_API_URL/api/agents/$SCUTTLE_AGENT_ID/delegations" -d '{}'`,
        apiUrl,
      ),
    ).toBe(true);
  });

  it("rejects non-bridge curl commands and shell chaining", () => {
    expect(isScuttleBridgeCurl("Bash", "curl -sS https://example.com/api/x", apiUrl)).toBe(false);
    expect(
      isScuttleBridgeCurl("Bash", `curl -sS "${apiUrl}/api/agents/a1" && rm -rf /`, apiUrl),
    ).toBe(false);
    expect(isScuttleBridgeCurl("Bash", `curl -sS "${apiUrl}/api/agents/a1" | sh`, apiUrl)).toBe(
      false,
    );
    expect(isScuttleBridgeCurl("Bash", `curl -sS "${apiUrl}/api/agents/$(whoami)"`, apiUrl)).toBe(
      false,
    );
    expect(isScuttleBridgeCurl("Read", `curl -sS "${apiUrl}/api/agents/a1"`, apiUrl)).toBe(false);
  });
});

describe("claudeAdapter stdio permission control protocol", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  const makeConfig = (binaryPath: string): ProviderConfig => ({
    id: ProviderId.make("claude"),
    kind: "claude",
    name: "Claude Code",
    enabled: true,
    binaryPath,
    launchArgs: "",
  });

  it("auto-approves can_use_tool control_request in auto mode over stream-json stdio", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-claude-auto-"));
    tempDirs.push(dir);
    const capturePath = NodePath.join(dir, "captured.json");

    const scriptPath = writeFakeClaudeScript(
      dir,
      "fake-claude",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = { argv: process.argv.slice(2), messages: [] };
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  captured.messages.push(msg);
  if (msg.type === "user") {
    process.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "req-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "curl -sS -X PATCH http://127.0.0.1:4310/api/agents/a1 -d '{}'" },
        description: "Save agent purpose",
      },
    }) + "\\n");
  } else if (msg.type === "control_response") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
    process.stdout.write(JSON.stringify({
      type: "result",
      session_id: "sess-1",
      is_error: false,
      result: "Saved purpose.",
    }) + "\\n");
  }
});
`,
    );

    const events: HarnessEvent[] = [];
    const result = await claudeAdapter.runTurn({
      config: makeConfig(scriptPath),
      cwd: dir,
      prompt: "Save your purpose",
      model: "claude-sonnet-4-6",
      runtimeMode: "auto",
      interactionMode: "default",
      extraEnv: { SCUTTLE_API_URL: "http://127.0.0.1:4310" },
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    expect(result.finalText).toBe("Saved purpose.");
    expect(result.providerSessionId).toBe("sess-1");
    expect(events.some((e) => e.kind === "approval.requested")).toBe(false);

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as {
      argv: string[];
      messages: Array<Record<string, unknown>>;
    };
    expect(captured.argv).toContain("--input-format");
    expect(captured.argv).toContain("--permission-prompt-tool");
    expect(captured.argv).toContain("stdio");
    expect(captured.messages[0]).toEqual({
      type: "user",
      message: { role: "user", content: "Save your purpose" },
    });
    expect(captured.messages[1]).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        response: {
          behavior: "allow",
          updatedInput: {
            command: "curl -sS -X PATCH http://127.0.0.1:4310/api/agents/a1 -d '{}'",
          },
        },
      },
    });
  });

  it("surfaces approval.requested in approval-required mode and forwards user decision", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-claude-ask-"));
    tempDirs.push(dir);
    const capturePath = NodePath.join(dir, "captured-ask.json");

    const scriptPath = writeFakeClaudeScript(
      dir,
      "fake-claude-ask",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const responses = [];
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    process.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "req-bridge",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "curl -sS http://127.0.0.1:4310/api/agents/a1" },
      },
    }) + "\\n");
  } else if (msg.type === "control_response") {
    responses.push(msg);
    if (responses.length === 1) {
      process.stdout.write(JSON.stringify({
        type: "control_request",
        request_id: "req-shell",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: { command: "git push origin main" },
          description: "Push branch",
        },
      }) + "\\n");
    } else {
      NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(responses));
      process.stdout.write(JSON.stringify({
        type: "result",
        session_id: "sess-2",
        is_error: false,
        result: "Handled.",
      }) + "\\n");
    }
  }
});
`,
    );

    const requested: Array<{ title: string; command?: string }> = [];
    const result = await claudeAdapter.runTurn({
      config: makeConfig(scriptPath),
      cwd: dir,
      prompt: "Check agent and push",
      model: "claude-sonnet-4-6",
      runtimeMode: "approval-required",
      interactionMode: "default",
      extraEnv: { SCUTTLE_API_URL: "http://127.0.0.1:4310" },
      signal: new AbortController().signal,
      emit: (e) => {
        if (e.kind === "approval.requested") {
          requested.push({
            title: e.title,
            ...(e.command ? { command: e.command } : {}),
          });
          e.resolve({ optionId: "deny", customText: "Do not push yet." });
        }
      },
    });

    expect(result.finalText).toBe("Handled.");
    expect(requested).toEqual([
      { title: "Approve shell command", command: "git push origin main" },
    ]);
    const responses = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as Array<{
      response: { request_id: string; response: Record<string, unknown> };
    }>;
    expect(responses[0]?.response.request_id).toBe("req-bridge");
    expect(responses[0]?.response.response.behavior).toBe("allow");
    expect(responses[1]?.response.request_id).toBe("req-shell");
    expect(responses[1]?.response.response).toEqual({
      behavior: "deny",
      message: "Do not push yet.",
    });
  });

  it("sends base64 image content blocks before the text block in SDKUserMessage", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-claude-img-"));
    tempDirs.push(dir);
    const capturePath = NodePath.join(dir, "captured-img.json");
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngB64 = Buffer.from(pngBytes).toString("base64");

    const scriptPath = writeFakeClaudeScript(
      dir,
      "fake-claude-img",
      `
import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(msg));
    process.stdout.write(JSON.stringify({
      type: "result",
      session_id: "sess-img",
      is_error: false,
      result: "Looks good.",
    }) + "\\n");
  }
});
`,
    );

    const result = await claudeAdapter.runTurn({
      config: makeConfig(scriptPath),
      cwd: dir,
      prompt: "Describe this UI",
      model: "claude-sonnet-4-6",
      runtimeMode: "auto",
      interactionMode: "default",
      resolvedAttachments: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "ui.png",
          mimeType: "image/png",
          path: "/tmp/ui.png",
          bytes: pngBytes,
        },
      ],
      signal: new AbortController().signal,
      emit: () => {},
    });

    expect(result.finalText).toBe("Looks good.");
    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(captured).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: pngB64 },
          },
          { type: "text", text: "Describe this UI" },
        ],
      },
    });
  });

  it("rejects Claude image attachments exceeding 20 MB total raw size", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-claude-big-"));
    tempDirs.push(dir);
    const scriptPath = writeFakeClaudeScript(dir, "fake-claude-big", "");

    await expect(
      claudeAdapter.runTurn({
        config: makeConfig(scriptPath),
        cwd: dir,
        prompt: "Too large",
        model: "claude-sonnet-4-6",
        runtimeMode: "auto",
        interactionMode: "default",
        resolvedAttachments: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "big.png",
            mimeType: "image/png",
            path: "/tmp/big.png",
            bytes: new Uint8Array(20 * 1024 * 1024 + 1),
          },
        ],
        signal: new AbortController().signal,
        emit: () => {},
      }),
    ).rejects.toThrow("20 MB");
  });
});

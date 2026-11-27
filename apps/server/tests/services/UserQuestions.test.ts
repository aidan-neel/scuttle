import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ProviderConfig, ThreadDetail } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import { codexAdapter } from "../../src/providers/codexAdapter.ts";
import type { HarnessEvent } from "../../src/providers/types.ts";
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

const makeCfg = (id: string, kind: ProviderConfig["kind"], binaryPath: string): ProviderConfig => ({
  id: ProviderId.make(id),
  kind,
  name: id,
  enabled: true,
  binaryPath,
  launchArgs: "",
});

const waitUntil = async (fn: () => Promise<boolean> | boolean, ms = 6_000): Promise<void> => {
  for (let end = Date.now() + ms; Date.now() < end; await Bun.sleep(20)) {
    if (await fn()) return;
  }
  throw new Error("Timed out waiting for condition.");
};

afterEach(() => {
  while (tempDirs.length > 0) {
    NodeFS.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Claude AskUserQuestion", () => {
  it("never auto-approves AskUserQuestion in full-access mode and formats multi-select answers", async () => {
    const dir = makeTempDir("scuttle-claude-q-");
    const capturePath = NodePath.join(dir, "captured.json");
    const questionsInput = [
      {
        question: "Which auth method?",
        header: "Auth",
        options: [
          { label: "OAuth", description: "Standard OAuth2" },
          { label: "JWT", description: "Stateless token" },
        ],
        multiSelect: false,
      },
      {
        question: "Which extras?",
        header: "Extras",
        options: [{ label: "MFA" }, { label: "Audit" }],
        multiSelect: true,
      },
    ];
    const script = writeFakeScript(
      dir,
      "fake-claude-q",
      `import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = [];
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type === "user") {
    process.stdout.write(JSON.stringify({
      type: "control_request",
      request_id: "req-ask-1",
      request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: ${JSON.stringify(questionsInput)} } },
    }) + "\\n");
  } else if (msg.type === "control_response") {
    captured.push(msg);
    if (captured.length === 1) {
      process.stdout.write(JSON.stringify({
        type: "control_request",
        request_id: "req-ask-2",
        request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: ${JSON.stringify([questionsInput[0]])} } },
      }) + "\\n");
    } else {
      NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
      process.stdout.write(JSON.stringify({ type: "result", session_id: "sess-q", is_error: false, result: "Done." }) + "\\n");
    }
  }
});`,
    );

    const emitted: Array<Extract<HarnessEvent, { kind: "approval.requested" }>> = [];
    let callCount = 0;
    const result = await claudeAdapter.runTurn({
      config: makeCfg("claude", "claude", script),
      cwd: dir,
      prompt: "Ask me",
      model: "claude-sonnet-4-6",
      runtimeMode: "full-access",
      interactionMode: "default",
      signal: new AbortController().signal,
      emit: (e) => {
        if (e.kind !== "approval.requested") return;
        emitted.push(e);
        callCount += 1;
        if (callCount === 1) {
          e.resolve({
            optionId: "",
            answers: {
              "Which auth method?": "OAuth",
              "Which extras?": ["MFA", "Audit"],
            },
          });
        } else {
          e.resolve({ optionId: "", dismissed: true });
        }
      },
    });

    expect(result.finalText).toBe("Done.");
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.approvalKind).toBe("question");
    expect(emitted[0]?.title).toBe("Auth");
    expect(emitted[0]?.questions).toEqual([
      {
        id: "Which auth method?",
        header: "Auth",
        question: "Which auth method?",
        options: [
          { id: "OAuth", label: "OAuth", description: "Standard OAuth2" },
          { id: "JWT", label: "JWT", description: "Stateless token" },
        ],
        multiSelect: false,
        allowCustom: true,
      },
      {
        id: "Which extras?",
        header: "Extras",
        question: "Which extras?",
        options: [
          { id: "MFA", label: "MFA" },
          { id: "Audit", label: "Audit" },
        ],
        multiSelect: true,
        allowCustom: true,
      },
    ]);

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as Array<{
      response: { request_id: string; response: Record<string, unknown> };
    }>;
    expect(captured[0]?.response.response).toEqual({
      behavior: "allow",
      updatedInput: {
        questions: questionsInput,
        answers: {
          "Which auth method?": "OAuth",
          "Which extras?": "MFA, Audit",
        },
      },
    });
    expect(captured[1]?.response.response).toEqual({
      behavior: "deny",
      message: "User dismissed question.",
    });
  });
});

describe("Codex item/tool/requestUserInput", () => {
  it("preserves all 3 questions, multi-select, and per-question answers", async () => {
    const dir = makeTempDir("scuttle-codex-q-");
    const capturePath = NodePath.join(dir, "codex-answers.json");
    const script = writeFakeScript(
      dir,
      "fake-codex-q",
      `import * as NodeFS from "node:fs";
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
const captured = [];
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  } else if (msg.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: "ct-1" } } }) + "\\n");
  } else if (msg.method === "turn/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn-1" } } }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 901,
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          { id: "framework", header: "Stack", question: "Choose framework", options: [{ label: "React" }, { label: "Svelte" }] },
          { id: "features", header: "Features", question: "Pick features", isMultiSelect: true, options: [{ label: "Auth" }, { label: "Billing" }] },
          { id: "notes", header: "Notes", question: "Extra notes", isOther: false, options: [{ label: "None" }, { label: "Urgent" }] }
        ]
      }
    }) + "\\n");
  } else if (msg.id === 901) {
    captured.push(msg.result);
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 902,
      method: "item/tool/requestUserInput",
      params: { questions: [{ id: "confirm", header: "Confirm", question: "Proceed?" }] }
    }) + "\\n");
  } else if (msg.id === 902) {
    captured.push(msg.result);
    NodeFS.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(captured));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { item: { id: "m1", type: "agentMessage", text: "Codex done" } } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { turn: { id: "turn-1", status: "completed" } } }) + "\\n");
  }
});`,
    );

    const emitted: Array<Extract<HarnessEvent, { kind: "approval.requested" }>> = [];
    const res = await codexAdapter.runTurn({
      config: makeCfg("codex", "codex", script),
      cwd: dir,
      prompt: "Run codex questions",
      model: "gpt-5.3-codex",
      runtimeMode: "approval-required",
      interactionMode: "default",
      signal: new AbortController().signal,
      emit: (e) => {
        if (e.kind !== "approval.requested") return;
        emitted.push(e);
        if (emitted.length === 1) {
          e.resolve({
            optionId: "",
            answers: {
              framework: "React",
              features: ["Auth", "Billing"],
              notes: "Urgent",
            },
          });
        } else {
          e.resolve({ optionId: "", dismissed: true });
        }
      },
    });

    expect(res.finalText).toBe("Codex done");
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.questions).toHaveLength(3);
    expect(emitted[0]?.questions?.[1]?.multiSelect).toBe(true);
    expect(emitted[0]?.questions?.[2]?.allowCustom).toBe(false);

    const captured = JSON.parse(NodeFS.readFileSync(capturePath, "utf8")) as Array<unknown>;
    expect(captured[0]).toEqual({
      answers: {
        framework: { answers: ["React"] },
        features: { answers: ["Auth", "Billing"] },
        notes: { answers: ["Urgent"] },
      },
    });
    expect(captured[1]).toEqual({ answers: {} });
  });
});

const fakeMcpCallerScript = (argsJson: string, onPayload: string, withSigterm = false) => `
import * as NodeFS from "node:fs";
let pendingFetch = null;
${withSigterm ? `process.on("SIGTERM", async () => { if (pendingFetch) await pendingFetch.catch(() => {}); process.exit(0); });` : ""}
const rl = (await import("node:readline")).createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.type !== "user") return;
  const mcpIdx = process.argv.indexOf("--mcp-config");
  const scuttle = JSON.parse(process.argv[mcpIdx + 1]).mcpServers.scuttle;
  pendingFetch = fetch(scuttle.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: scuttle.headers.Authorization },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "scuttle_ask_user", arguments: ${argsJson} } }),
  }).then(async (res) => {
    const payload = await res.json();
    ${onPayload}
  });
});`;

describe("MCP scuttle_ask_user over live HTTP", () => {
  const setupLiveServer = async (dir: string, fakeClaudeBody: string) => {
    const prevDisableProbes = process.env.SCUTTLE_DISABLE_STARTUP_PROBES;
    process.env.SCUTTLE_DISABLE_STARTUP_PROBES = "1";
    const projectDir = NodePath.join(dir, "repo");
    NodeFS.mkdirSync(projectDir, { recursive: true });
    const fakeClaude = writeFakeScript(dir, "fake-claude-mcp", fakeClaudeBody);
    const dbPath = NodePath.join(dir, "state.sqlite");
    const handle = await startScuttleServer({
      host: "127.0.0.1",
      port: 0,
      dbPath,
      dataDir: dir,
      seedCwdProject: false,
    });
    const api = (path: string, method = "GET", body?: unknown) =>
      fetch(`${handle.url}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    await api("/api/providers/claude", "PATCH", { binaryPath: fakeClaude });
    const project = (await (
      await api("/api/projects", "POST", { path: projectDir, name: "AskProj" })
    ).json()) as { id: string; defaultBranch: string };

    return {
      dbPath,
      api,
      startThread: async (prompt: string) =>
        (await (
          await api("/api/threads", "POST", {
            projectId: project.id,
            prompt,
            runtime: "local",
            branch: project.defaultBranch,
            modelSelection: {
              providerId: "claude",
              providerKind: "claude",
              model: "claude-sonnet-4-6",
            },
          })
        ).json()) as ThreadDetail,
      cleanup: async () => {
        await handle.stop();
        if (prevDisableProbes === undefined) delete process.env.SCUTTLE_DISABLE_STARTUP_PROBES;
        else process.env.SCUTTLE_DISABLE_STARTUP_PROBES = prevDisableProbes;
      },
    };
  };

  it("blocks while needs-input, unblocks on approval POST, and persists questions + answers in SQLite", async () => {
    const dir = makeTempDir("scuttle-mcp-ask-");
    const env = await setupLiveServer(
      dir,
      fakeMcpCallerScript(
        JSON.stringify({
          title: "Deploy Config",
          questions: [
            {
              id: "env",
              header: "Env",
              question: "Target environment?",
              options: [{ label: "Staging" }, { label: "Prod" }],
            },
            {
              header: "Flags",
              question: "Enable flags?",
              multiSelect: true,
              options: [{ label: "Canary" }, { label: "Metrics" }],
            },
          ],
        }),
        `process.stdout.write(JSON.stringify({ type: "result", session_id: "sess-mcp-ask", is_error: false, result: JSON.stringify(payload.result.structuredContent) }) + "\\n");`,
      ),
    );

    try {
      const created = await env.startThread("Ask user via MCP");
      let approvalId = "";
      await waitUntil(async () => {
        const detail = (await (
          await env.api(`/api/threads/${created.thread.id}`)
        ).json()) as ThreadDetail;
        if (detail.thread.status.kind === "needs-input") {
          approvalId = detail.thread.status.approvalId;
          return true;
        }
        return false;
      });

      const badRes = await env.api(
        `/api/threads/${created.thread.id}/approvals/${approvalId}`,
        "POST",
        {},
      );
      expect(badRes.status).toBe(400);

      const submitRes = await env.api(
        `/api/threads/${created.thread.id}/approvals/${approvalId}`,
        "POST",
        { answers: { env: "Prod", Flags: ["Canary", "Metrics"] } },
      );
      expect(submitRes.status).toBe(204);

      let finalDetail!: ThreadDetail;
      await waitUntil(async () => {
        finalDetail = (await (
          await env.api(`/api/threads/${created.thread.id}`)
        ).json()) as ThreadDetail;
        return finalDetail.turns[0]?.status === "completed";
      });

      expect(JSON.parse(finalDetail.turns[0]!.assistantMessage)).toEqual({
        answered: true,
        dismissed: false,
        answers: { env: "Prod", Flags: ["Canary", "Metrics"] },
      });

      const persistedApproval = finalDetail.turns[0]?.approvals[0];
      expect(persistedApproval?.status).toBe("resolved");
      expect(persistedApproval?.questions).toHaveLength(2);
      expect(persistedApproval?.answers).toEqual({ env: "Prod", Flags: ["Canary", "Metrics"] });

      const checkDb = new Database(env.dbPath, { readonly: true });
      const row = checkDb
        .query<
          { questions_json: string | null; answers_json: string | null; dismissed: number },
          [string]
        >("SELECT questions_json, answers_json, dismissed FROM approvals WHERE id = ?")
        .get(approvalId);
      checkDb.close();
      expect(row?.dismissed).toBe(0);
      expect(JSON.parse(row?.questions_json ?? "[]")).toHaveLength(2);
      expect(JSON.parse(row?.answers_json ?? "{}")).toEqual({
        env: "Prod",
        Flags: ["Canary", "Metrics"],
      });
    } finally {
      await env.cleanup();
    }
  });

  it("unblocks cleanly with dismissed=true when the turn is interrupted", async () => {
    const dir = makeTempDir("scuttle-mcp-int-");
    const mcpResultPath = NodePath.join(dir, "mcp-interrupted.json");
    const env = await setupLiveServer(
      dir,
      fakeMcpCallerScript(
        JSON.stringify({
          questions: [{ question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] }],
        }),
        `NodeFS.writeFileSync(${JSON.stringify(mcpResultPath)}, JSON.stringify(payload.result.structuredContent));`,
        true,
      ),
    );

    try {
      const created = await env.startThread("Interrupt while asking");
      await waitUntil(async () => {
        const detail = (await (
          await env.api(`/api/threads/${created.thread.id}`)
        ).json()) as ThreadDetail;
        return detail.thread.status.kind === "needs-input";
      });

      expect((await env.api(`/api/threads/${created.thread.id}/interrupt`, "POST")).status).toBe(
        204,
      );
      await waitUntil(() => NodeFS.existsSync(mcpResultPath));
      expect(JSON.parse(NodeFS.readFileSync(mcpResultPath, "utf8"))).toEqual({
        answered: false,
        dismissed: true,
        answers: {},
      });

      let finalDetail!: ThreadDetail;
      await waitUntil(async () => {
        finalDetail = (await (
          await env.api(`/api/threads/${created.thread.id}`)
        ).json()) as ThreadDetail;
        return finalDetail.turns[0]?.status === "interrupted";
      });
      expect(finalDetail.turns[0]?.approvals[0]?.status).toBe("resolved");
      expect(finalDetail.turns[0]?.approvals[0]?.dismissed).toBe(true);
    } finally {
      await env.cleanup();
    }
  });
});

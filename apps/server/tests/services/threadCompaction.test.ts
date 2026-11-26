import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { CompactThreadResult, type ServerPushEvent } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { handleApiRequest } from "../../src/httpRoutes.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import { codexAdapter } from "../../src/providers/codexAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-compact-test-"));
  const repo = NodePath.join(root, "repo");
  NodeFS.mkdirSync(repo, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
  Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: repo });
  Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: repo });
  NodeFS.writeFileSync(NodePath.join(repo, "README.md"), "# repo\n");
  Bun.spawnSync(["git", "add", "."], { cwd: repo });
  Bun.spawnSync(["git", "commit", "-qm", "init"], { cwd: repo });
  return { root, repo };
};

const waitUntil = async (fn: () => boolean, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for condition.");
};

describe("thread compaction and session rollover", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compacts an agent thread via HTTP, increments sessionEpoch, clears providerSessionId, and seeds handoff on next turn", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const recordedPrompts: string[] = [];
    const claudeSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        recordedPrompts.push(input.prompt);
        input.emit({ kind: "session", providerSessionId: "claude-sess-1" });
        return {
          finalText: "Implemented initial auth layer.",
          providerSessionId: "claude-sess-1",
          usage: { inputTokens: 1200, outputTokens: 300, contextWindowTokens: 200_000 },
        };
      },
    );

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    const events: ServerPushEvent[] = [];

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const eventBus = yield* EventBus.EventBus;
          const unsub = eventBus.subscribe((e) => events.push(e));
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "widgets" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          yield* agents.createMemory(agent.id, {
            category: "convention",
            title: "Auth invariant",
            content: "Always validate session cookies on server.",
            pinned: true,
          });
          yield* agents.createIssue(agent.id, {
            title: "Add refresh tokens",
            description: "Handle token rotation",
          });

          const turn0 = yield* agents.sendTurn(agent.id, { prompt: "Design auth layer" });
          expect(turn0.sessionEpoch).toBe(0);
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === turn0.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          const compactReq = new Request(
            `http://127.0.0.1/api/threads/${agent.primaryThreadId}/compact`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ focus: "Keep auth decisions" }),
            },
          );
          const compactRes = yield* handleApiRequest(compactReq, new URL(compactReq.url));
          expect(compactRes?.status).toBe(200);
          const compactPayload = Schema.decodeUnknownSync(CompactThreadResult)(
            yield* Effect.promise(() => compactRes!.json()),
          );

          expect(compactPayload.sessionEpoch).toBe(1);
          expect(compactPayload.thread.sessionEpoch).toBe(1);
          expect(compactPayload.thread.providerSessionId).toBeUndefined();
          expect(compactPayload.thread.lastUsage).toBeUndefined();
          expect(compactPayload.summary).toContain("Keep auth decisions");
          expect(compactPayload.summary).toContain("Design auth layer");
          expect(compactPayload.summary).toContain("Auth invariant");
          expect(compactPayload.summary).toContain("Add refresh tokens");

          const turn1 = yield* threads.sendTurn(agent.primaryThreadId, {
            prompt: "Continue with refresh tokens",
          });
          expect(turn1.sessionEpoch).toBe(1);
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === turn1.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          expect(recordedPrompts[1]).toContain("<scuttle_agent_context>");
          expect(recordedPrompts[1]).toContain("<scuttle_session_handoff>");
          expect(recordedPrompts[1]).toContain("Keep auth decisions");
          expect(recordedPrompts[1]).toContain("Continue with refresh tokens");
          unsub();
        }),
      );
    } finally {
      claudeSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("rolls over epoch and seeds handoff on model or provider switch for sessions with turns, and skips rollover before first turn", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const codexPrompts: string[] = [];
    const claudeSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        input.emit({ kind: "session", providerSessionId: "claude-sess-switch" });
        return { finalText: "Drafted plan in Claude.", providerSessionId: "claude-sess-switch" };
      },
    );
    const codexSpy = spyOn(codexAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        codexPrompts.push(input.prompt);
        input.emit({ kind: "session", providerSessionId: "codex-sess-1" });
        return { finalText: "Executed in Codex.", providerSessionId: "codex-sess-1" };
      },
    );

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    const events: ServerPushEvent[] = [];

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const eventBus = yield* EventBus.EventBus;
          const unsub = eventBus.subscribe((e) => events.push(e));
          const projects = yield* ProjectService.ProjectService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "switch-repo" });

          // Idle thread with 0 turns: switching model does NOT increment epoch.
          const idleThread = yield* threads.createIdle({
            projectId: proj.id,
            title: "Plain thread",
            runtime: "local",
            branch: "main",
            modelSelection: {
              providerId: ProviderId.make("claude"),
              providerKind: "claude",
              model: "claude-opus-5-5",
            },
          });
          const preTurnUpdated = yield* threads.update(idleThread.id, {
            modelSelection: {
              providerId: ProviderId.make("claude"),
              providerKind: "claude",
              model: "claude-sonnet-5-5",
            },
          });
          expect(preTurnUpdated.sessionEpoch ?? 0).toBe(0);
          expect(preTurnUpdated.activeSummary).toBeUndefined();

          // Run turn 0 on Claude.
          const t0 = yield* threads.sendTurn(idleThread.id, { prompt: "Plan database schema" });
          expect(t0.sessionEpoch).toBe(0);
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === t0.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          // Switch provider/model on sendTurn -> clean rollover to epoch 1 with handoff.
          const t1 = yield* threads.sendTurn(idleThread.id, {
            prompt: "Implement the schema",
            modelSelection: {
              providerId: ProviderId.make("codex"),
              providerKind: "codex",
              model: "gpt-5-codex",
            },
          });
          expect(t1.sessionEpoch).toBe(1);
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === t1.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          expect(codexPrompts[0]).toContain("<scuttle_session_handoff>");
          expect(codexPrompts[0]).toContain("Plan database schema");
          expect(codexPrompts[0]).toContain("Drafted plan in Claude.");
          expect(codexPrompts[0]).toContain("Implement the schema");

          // Switching model via ThreadService.update also rolls over cleanly to epoch 2.
          const afterUpdateSwitch = yield* threads.update(idleThread.id, {
            modelSelection: {
              providerId: ProviderId.make("codex"),
              providerKind: "codex",
              model: "gpt-6-codex",
            },
          });
          expect(afterUpdateSwitch.sessionEpoch).toBe(2);
          expect(afterUpdateSwitch.providerSessionId).toBeUndefined();
          expect(afterUpdateSwitch.activeSummary).toContain("Implement the schema");

          unsub();
        }),
      );
    } finally {
      claudeSpy.mockRestore();
      codexSpy.mockRestore();
      await runtime.dispose();
    }
  });
});

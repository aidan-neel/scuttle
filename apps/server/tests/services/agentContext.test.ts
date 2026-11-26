import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { Agent, ServerPushEvent } from "@scuttle/contracts";
import { AgentId, ProjectId, ProviderId, ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import { isCheckInDue, runDueCheckIns } from "../../src/services/agent/agentCheckInScheduler.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-ctx-test-"));
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

describe("agentContext & check-in scheduler", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects stable context once, sends delta-only or unwrapped prompts on resume, re-injects on hash change, and notifies settled delegations once", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const recordedPrompts: { threadId?: string; prompt: string }[] = [];
    let sessionSeq = 0;
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        recordedPrompts.push({
          ...(input.providerSessionId ? { threadId: input.providerSessionId } : {}),
          prompt: input.prompt,
        });
        if (input.prompt.includes("You are a delegated")) {
          return {
            finalText: "Finished https://github.com/acme/repo/pull/99",
            providerSessionId: "child-sess-1",
          };
        }
        if (!input.providerSessionId) {
          sessionSeq += 1;
          const sid = `sess-${sessionSeq}`;
          input.emit({ kind: "session", providerSessionId: sid });
          return { finalText: "Acknowledged.", providerSessionId: sid };
        }
        return {
          finalText: "Done.",
          ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}),
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

          const proj = yield* projects.create({ path: repo, name: "repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          yield* agents.sendTurn(agent.id, { prompt: "First turn" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.threadId === agent.primaryThreadId &&
                  e.turn.userMessage === "First turn" &&
                  e.turn.status === "completed",
              ),
            ),
          );

          expect(recordedPrompts[0]!.prompt).toContain("<scuttle_agent_context>");
          expect(recordedPrompts[0]!.prompt).toContain("First turn");
          expect(recordedPrompts[0]!.prompt).toContain("/memories?q=");

          // Second turn with resumed session, unchanged profile, zero deltas -> unwrapped prompt.
          yield* agents.sendTurn(agent.id, { prompt: "Second turn unwrapped" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.threadId === agent.primaryThreadId &&
                  e.turn.userMessage === "Second turn unwrapped" &&
                  e.turn.status === "completed",
              ),
            ),
          );
          expect(recordedPrompts[1]!.prompt).toBe("Second turn unwrapped");

          // Update agent profile -> hash changes -> re-injects stable context on next turn.
          yield* agents.update(agent.id, { purpose: "Own context management" });
          yield* agents.sendTurn(agent.id, { prompt: "Third turn after profile change" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.threadId === agent.primaryThreadId &&
                  e.turn.userMessage === "Third turn after profile change" &&
                  e.turn.status === "completed",
              ),
            ),
          );
          expect(recordedPrompts[2]!.prompt).toContain("<scuttle_agent_context>");
          expect(recordedPrompts[2]!.prompt).toContain("Own context management");

          // Delegate a task and wait for it to settle.
          const del = yield* agents.delegateTask(agent.id, {
            role: "fast",
            kind: "task",
            title: "Audit cache",
            brief: "Check prompt caching",
            runtime: "local",
          });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "agent.delegation.upserted" &&
                  e.delegation.id === del.id &&
                  e.delegation.status === "completed",
              ),
            ),
          );

          // Fourth turn surfaces newly settled delegation in delta header ONLY (no full context).
          yield* agents.sendTurn(agent.id, { prompt: "Fourth turn after delegation" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.threadId === agent.primaryThreadId &&
                  e.turn.userMessage === "Fourth turn after delegation" &&
                  e.turn.status === "completed",
              ),
            ),
          );
          const fourthPrompt = recordedPrompts.find((r) =>
            r.prompt.includes("Fourth turn after delegation"),
          )!.prompt;
          expect(fourthPrompt).not.toContain("<scuttle_agent_context>");
          expect(fourthPrompt).toContain("<scuttle_agent_delta");
          expect(fourthPrompt).toContain("Audit cache");
          expect(fourthPrompt).toContain("https://github.com/acme/repo/pull/99");

          // Fifth turn must NOT repeat the already-notified settled delegation.
          yield* agents.sendTurn(agent.id, { prompt: "Fifth turn clean" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.threadId === agent.primaryThreadId &&
                  e.turn.userMessage === "Fifth turn clean" &&
                  e.turn.status === "completed",
              ),
            ),
          );
          const fifthPrompt = recordedPrompts.find((r) =>
            r.prompt.includes("Fifth turn clean"),
          )!.prompt;
          expect(fifthPrompt).toBe("Fifth turn clean");

          unsub();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("evaluates check-in intervals accurately and only runs due agents", async () => {
    const baseAgent: Agent = {
      id: AgentId.make("agent-1"),
      projectId: ProjectId.make("proj-1"),
      projectName: "repo",
      projectPath: "/tmp/repo",
      name: "Repo",
      purpose: "",
      primaryThreadId: ThreadId.make("thread-1"),
      runtime: "local",
      modelSelection: {
        providerId: ProviderId.make("claude"),
        providerKind: "claude",
        model: "claude-opus-5-5",
      },
      modelStack: {},
      instructionsMd: "",
      pinned: false,
      needsAttention: false,
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    };

    const nowMs = Date.parse("2026-11-25T01:00:00Z");
    expect(isCheckInDue(baseAgent, nowMs)).toBe(false);
    expect(isCheckInDue({ ...baseAgent, checkInIntervalMinutes: 0 }, nowMs)).toBe(false);
    expect(isCheckInDue({ ...baseAgent, checkInIntervalMinutes: 30 }, nowMs)).toBe(true);
    expect(
      isCheckInDue(
        { ...baseAgent, checkInIntervalMinutes: 30, lastCheckInAt: "2026-11-25T00:45:00Z" },
        nowMs,
      ),
    ).toBe(false);
    expect(
      isCheckInDue(
        { ...baseAgent, checkInIntervalMinutes: 30, lastCheckInAt: "2026-11-25T00:30:00Z" },
        nowMs,
      ),
    ).toBe(true);

    const ranFor: string[] = [];
    const dueAgent = { ...baseAgent, id: AgentId.make("due-1"), checkInIntervalMinutes: 15 };
    const freshAgent = {
      ...baseAgent,
      id: AgentId.make("fresh-1"),
      checkInIntervalMinutes: 15,
      lastCheckInAt: "2026-11-25T00:55:00Z",
    };

    const count = await Effect.runPromise(
      runDueCheckIns({
        listAgents: () => [baseAgent, dueAgent, freshAgent],
        now: () => nowMs,
        runCheckIn: (agentId) => {
          ranFor.push(agentId);
          return Effect.succeed({
            id: "chk-1" as never,
            agentId,
            summary: "ok",
            activeDelegations: 0,
            openPrs: 0,
            openIssues: 0,
            createdAt: new Date(nowMs).toISOString(),
          });
        },
      }),
    );

    expect(count).toBe(1);
    expect(ranFor).toEqual(["due-1"]);
  });
});

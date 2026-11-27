import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ServerPushEvent } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ProviderService from "../../src/services/ProviderService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";
import { readAgentById } from "../../src/services/agent/agentStore.ts";
import { listDelegations } from "../../src/services/agent/agentWorkStore.ts";
import { readThreadById, readThreadContextHash } from "../../src/services/threadStore.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-guard-test-"));
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

describe("turn guards and deferred commit", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks mid-run sendTurn/update mutations without rollover and guards stale epoch writes in turnRunner", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let releaseTurn0!: () => void;
    const turn0Gate = new Promise<void>((resolve) => {
      releaseTurn0 = resolve;
    });
    let resolveTurn0Started!: () => void;
    const turn0Started = new Promise<void>((resolve) => {
      resolveTurn0Started = resolve;
    });

    const claudeSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        resolveTurn0Started();
        await turn0Gate;
        input.emit({ kind: "session", providerSessionId: "late-epoch0-sess" });
        input.emit({ kind: "usage", usage: { inputTokens: 999, outputTokens: 111 } });
        return {
          finalText: "Finished epoch 0",
          providerSessionId: "late-epoch0-sess",
          usage: { inputTokens: 999, outputTokens: 111 },
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
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const providers = yield* ProviderService.ProviderService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "guards-repo" });
          const created = yield* threads.create({
            projectId: proj.id,
            prompt: "Initial running turn",
            runtime: "local",
            branch: "main",
            modelSelection: {
              providerId: ProviderId.make("claude"),
              providerKind: "claude",
              model: "claude-sonnet-4-5",
            },
          });

          yield* Effect.promise(() => turn0Started);

          const midRunSend = yield* threads
            .sendTurn(created.thread.id, {
              prompt: "Should reject without rollover",
              modelSelection: {
                providerId: ProviderId.make("codex"),
                providerKind: "codex",
                model: "gpt-5-codex",
              },
            })
            .pipe(Effect.flip);
          expect(midRunSend.message).toContain("already has a turn running");

          const midRunUpdate = yield* threads
            .update(created.thread.id, {
              modelSelection: {
                providerId: ProviderId.make("codex"),
                providerKind: "codex",
                model: "gpt-5-codex",
              },
            })
            .pipe(Effect.flip);
          expect(midRunUpdate.message).toBe(
            "Stop the running turn before changing runtime or model.",
          );

          const stillRunning = readThreadById(db, created.thread.id)!;
          expect(stillRunning.sessionEpoch ?? 0).toBe(0);
          expect(stillRunning.modelSelection.model).toBe("claude-sonnet-4-5");
          expect(stillRunning.activeSummary).toBeUndefined();

          db.prepare(
            "UPDATE threads SET session_epoch = 1, provider_session_id = NULL, last_usage_json = NULL WHERE id = ?",
          ).run(created.thread.id);
          releaseTurn0();

          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === created.turns[0]!.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          const afterLateFinish = readThreadById(db, created.thread.id)!;
          expect(afterLateFinish.sessionEpoch).toBe(1);
          expect(afterLateFinish.providerSessionId).toBeUndefined();
          expect(afterLateFinish.lastUsage).toBeUndefined();

          yield* providers.updateConfig(ProviderId.make("codex"), { enabled: false });
          const disabledErr = yield* threads
            .sendTurn(created.thread.id, {
              prompt: "Should reject before rollover",
              modelSelection: {
                providerId: ProviderId.make("codex"),
                providerKind: "codex",
                model: "gpt-5-codex",
              },
            })
            .pipe(Effect.flip);
          expect(disabledErr.message).toContain("disabled");

          const afterDisabled = readThreadById(db, created.thread.id)!;
          expect(afterDisabled.sessionEpoch).toBe(1);
          expect(afterDisabled.modelSelection.providerId).toBe(ProviderId.make("claude"));
          unsub();
        }),
      );
    } finally {
      claudeSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("rejects AgentService.update modelSelection changes while primary thread is running and keeps agent and thread unchanged", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let releaseTurn!: () => void;
    const turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    let resolveTurnStarted!: () => void;
    const turnStarted = new Promise<void>((resolve) => {
      resolveTurnStarted = resolve;
    });

    const claudeSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (): Promise<HarnessTurnResult> => {
        resolveTurnStarted();
        await turnGate;
        return {
          finalText: "Agent turn completed",
          providerSessionId: "agent-running-sess",
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
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "agent-guards-repo" });
          const seeded = (yield* agents.list()).find((a) => a.projectId === proj.id)!;
          const originalSelection = {
            providerId: ProviderId.make("claude"),
            providerKind: "claude" as const,
            model: "claude-sonnet-4-5",
          };
          yield* agents.update(seeded.id, { modelSelection: originalSelection });

          const runningTurn = yield* agents.sendTurn(seeded.id, {
            prompt: "Active agent turn",
          });
          yield* Effect.promise(() => turnStarted);

          const updateErr = yield* agents
            .update(seeded.id, {
              modelSelection: {
                providerId: ProviderId.make("codex"),
                providerKind: "codex",
                model: "gpt-5-codex",
              },
            })
            .pipe(Effect.flip);

          expect(updateErr).toBeInstanceOf(AgentService.AgentServiceError);
          expect(updateErr.reason).toBe("rejected");
          expect(updateErr.message).toBe("Stop the running turn before changing runtime or model.");

          const agentRow = readAgentById(db, seeded.id)!;
          const threadRow = readThreadById(db, seeded.primaryThreadId)!;
          expect(agentRow.modelSelection).toEqual(originalSelection);
          expect(threadRow.modelSelection.providerId).toBe(ProviderId.make("claude"));
          expect(threadRow.modelSelection.model).toBe("claude-sonnet-4-5");
          expect(threadRow.sessionEpoch ?? 0).toBe(0);

          releaseTurn();
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === runningTurn.id &&
                  e.turn.status === "completed",
              ),
            ),
          );
          unsub();
        }),
      );
    } finally {
      claudeSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("defers context hash and delegation notification until completion, retries post-compact handoff, and caps unnotified delegations at 10", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let failPrimary = true;
    const prompts: string[] = [];
    const claudeSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          return { finalText: "Child done", providerSessionId: "child-sess" };
        }
        prompts.push(input.prompt);
        if (failPrimary) {
          input.emit({ kind: "session", providerSessionId: "partial-sess-id" });
          throw new Error("Simulated launch failure");
        }
        input.emit({ kind: "session", providerSessionId: "good-sess-id" });
        return { finalText: "Recovered cleanly", providerSessionId: "good-sess-id" };
      },
    );

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    const events: ServerPushEvent[] = [];

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const eventBus = yield* EventBus.EventBus;
          const unsub = eventBus.subscribe((e) => events.push(e));
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "retry-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          for (let i = 0; i < 12; i += 1) {
            const del = yield* agents.delegateTask(agent.id, {
              role: "fast",
              kind: "task",
              title: `BatchTask-${i}`,
              brief: `Run batch ${i}`,
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
          }

          const failedTurn = yield* agents.sendTurn(agent.id, { prompt: "First attempt fails" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === failedTurn.id &&
                  e.turn.status === "failed",
              ),
            ),
          );

          expect(readThreadContextHash(db, agent.primaryThreadId)).toBeNull();
          expect(
            listDelegations(db, agent.id, 20).every((d) => d.parentNotifiedAt === undefined),
          ).toBe(true);

          failPrimary = false;
          const retryTurn = yield* agents.sendTurn(agent.id, { prompt: "Retry succeeds" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === retryTurn.id &&
                  e.turn.status === "completed",
              ),
            ),
          );

          const retryPrompt = prompts[1]!;
          expect(retryPrompt).toContain("<scuttle_agent_context>");
          expect(retryPrompt).toContain("BatchTask-0");
          expect(retryPrompt).toContain("BatchTask-9");
          expect(retryPrompt).not.toContain("BatchTask-10");
          expect(readThreadContextHash(db, agent.primaryThreadId)).not.toBeNull();

          const notifiedAfterFirst = listDelegations(db, agent.id, 20).filter(
            (d) => d.parentNotifiedAt !== undefined,
          );
          expect(notifiedAfterFirst).toHaveLength(10);

          const overflowTurn = yield* agents.sendTurn(agent.id, { prompt: "Drain remaining 2" });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === overflowTurn.id &&
                  e.turn.status === "completed",
              ),
            ),
          );
          expect(prompts[2]!).toContain("BatchTask-10");
          expect(prompts[2]!).toContain("BatchTask-11");

          yield* threads.compact(agent.primaryThreadId, { focus: "Preserve after crash" });
          failPrimary = true;
          const postCompactFail = yield* agents.sendTurn(agent.id, {
            prompt: "Post-compact first attempt crashes",
          });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === postCompactFail.id &&
                  e.turn.status === "failed",
              ),
            ),
          );

          expect(readThreadById(db, agent.primaryThreadId)?.providerSessionId).toBe(
            "partial-sess-id",
          );

          failPrimary = false;
          const postCompactRetry = yield* agents.sendTurn(agent.id, {
            prompt: "Post-compact retry",
          });
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "turn.upserted" &&
                  e.turn.id === postCompactRetry.id &&
                  e.turn.status === "completed",
              ),
            ),
          );
          const postCompactRetryPrompt = prompts[prompts.length - 1]!;
          expect(postCompactRetryPrompt).toContain("<scuttle_agent_context>");
          expect(postCompactRetryPrompt).toContain("<scuttle_session_handoff>");
          expect(postCompactRetryPrompt).toContain("Preserve after crash");
          unsub();
        }),
      );
    } finally {
      claudeSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("re-syncs a diverged primary thread model when AgentService.update receives the agent's stored modelSelection", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "resync-repo" });
          const seeded = (yield* agents.list()).find((a) => a.projectId === proj.id)!;
          const storedSelection = {
            providerId: ProviderId.make("claude"),
            providerKind: "claude" as const,
            model: "claude-sonnet-4-5",
          };
          yield* agents.update(seeded.id, { modelSelection: storedSelection });

          const divergedSelection = {
            providerId: ProviderId.make("codex"),
            providerKind: "codex" as const,
            model: "gpt-5-codex",
          };
          yield* threads.update(seeded.primaryThreadId, { modelSelection: divergedSelection });

          const agentBefore = readAgentById(db, seeded.id)!;
          const threadBefore = readThreadById(db, seeded.primaryThreadId)!;
          expect(agentBefore.modelSelection).toEqual(storedSelection);
          expect(threadBefore.modelSelection.providerId).toBe(ProviderId.make("codex"));
          expect(threadBefore.modelSelection.model).toBe("gpt-5-codex");

          yield* agents.update(seeded.id, { modelSelection: agentBefore.modelSelection });

          const agentAfter = readAgentById(db, seeded.id)!;
          const threadAfter = readThreadById(db, seeded.primaryThreadId)!;
          expect(agentAfter.modelSelection).toEqual(storedSelection);
          expect(threadAfter.modelSelection.providerId).toBe(ProviderId.make("claude"));
          expect(threadAfter.modelSelection.providerKind).toBe("claude");
          expect(threadAfter.modelSelection.model).toBe("claude-sonnet-4-5");
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });
});

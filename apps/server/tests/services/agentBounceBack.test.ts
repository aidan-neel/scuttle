import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AgentDelegation, AgentDelegationQuestion, type ServerPushEvent } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { makeAppLayer, startScuttleServer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ProviderService from "../../src/services/ProviderService.ts";
import { listDelegations } from "../../src/services/agent/agentWorkStore.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-bounce-test-"));
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

const waitUntil = async (fn: () => boolean | Promise<boolean>, timeoutMs = 4_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for condition.");
};

describe("Agent delegation bounce-back", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      NodeFS.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("injects SCUTTLE_DELEGATION_ID on turn 1, formats briefs by maxBounces, and cleans up if turn 1 fails", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const recordedInputs: HarnessTurnInput[] = [];
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        recordedInputs.push(input);
        return { finalText: "Done." };
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
          const providers = yield* ProviderService.ProviderService;

          const proj = yield* projects.create({ path: repo, name: "env-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const delWithBudget = yield* agents.delegateTask(agent.id, {
            role: "workhorse",
            kind: "task",
            title: "Task with bounce",
            brief: "Solve it",
            runtime: "local",
            maxBounces: 2,
          });
          expect(delWithBudget.bounceCount).toBe(0);
          expect(delWithBudget.maxBounces).toBe(2);

          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "agent.delegation.upserted" &&
                  e.delegation.id === delWithBudget.id &&
                  e.delegation.status === "completed",
              ),
            ),
          );

          const turn1Input = recordedInputs.find(
            (i) => i.extraEnv?.SCUTTLE_DELEGATION_ID === delWithBudget.id,
          );
          expect(turn1Input).toBeDefined();
          expect(turn1Input!.extraEnv?.SCUTTLE_AGENT_ID).toBe(agent.id);
          expect(turn1Input!.extraEnv?.SCUTTLE_API_URL).toContain("http://");
          expect(turn1Input!.prompt).toContain(`Delegation ID: ${delWithBudget.id}`);
          expect(turn1Input!.prompt).toContain("## Asking Your Parent Agent");
          expect(turn1Input!.prompt).toContain("/delegations/$SCUTTLE_DELEGATION_ID/ask");

          const delZero = yield* agents.delegateTask(agent.id, {
            role: "fast",
            kind: "task",
            title: "Task zero bounce",
            brief: "No asking",
            runtime: "local",
            maxBounces: 0,
          });
          expect(delZero.maxBounces).toBe(0);

          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "agent.delegation.upserted" &&
                  e.delegation.id === delZero.id &&
                  e.delegation.status === "completed",
              ),
            ),
          );

          const zeroInput = recordedInputs.find(
            (i) => i.extraEnv?.SCUTTLE_DELEGATION_ID === delZero.id,
          );
          expect(zeroInput).toBeDefined();
          expect(zeroInput!.prompt).not.toContain("## Asking Your Parent Agent");

          yield* providers.updateConfig(ProviderId.make("claude"), { enabled: false });
          const failedDelegate = yield* agents
            .delegateTask(agent.id, {
              role: "fast",
              kind: "task",
              title: "Disabled provider task",
              brief: "Should clean up",
              runtime: "local",
            })
            .pipe(Effect.flip);
          expect(failedDelegate.message).toContain("disabled");

          const activeAfterFailure = listDelegations(db, agent.id, 20).filter(
            (d) => d.status === "running" || d.status === "waiting_parent",
          );
          expect(activeAfterFailure).toHaveLength(0);
          unsub();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("completes end-to-end HTTP /ask round-trip, enforces budget and duplicate guards, and persists questions", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const server = await startScuttleServer({ port: 0, dbPath: ":memory:" });
    let capturedParentPrompt = "";
    const observedStatusesDuringAsk: string[] = [];

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          const apiUrl = input.extraEnv?.SCUTTLE_API_URL;
          const agentId = input.extraEnv?.SCUTTLE_AGENT_ID;
          const delegationId = input.extraEnv?.SCUTTLE_DELEGATION_ID;
          if (!apiUrl || !agentId || !delegationId) {
            throw new Error("Missing SCUTTLE_* env vars on turn 1");
          }

          const askRes = await fetch(
            `${apiUrl}/api/agents/${agentId}/delegations/${delegationId}/ask`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: "missing_context",
                question: "Which config file defines the port?",
                attempted: "Checked src/index.ts and env.ts",
                context: "Need port constant for test fixture",
              }),
            },
          );
          expect(askRes.status).toBe(200);
          const settledQuestion = Schema.decodeUnknownSync(AgentDelegationQuestion)(
            await askRes.json(),
          );
          expect(settledQuestion.status).toBe("answered");
          expect(settledQuestion.answer).toBe("Use src/config.ts DEFAULT_PORT.");
          expect(settledQuestion.bounceNumber).toBe(1);

          const overBudgetRes = await fetch(
            `${apiUrl}/api/agents/${agentId}/delegations/${delegationId}/ask`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: "One more?" }),
            },
          );
          expect(overBudgetRes.status).toBe(422);

          return { finalText: `Resolved using: ${settledQuestion.answer}` };
        }

        if (input.prompt.includes("Worker question from")) {
          capturedParentPrompt = input.prompt;
          const agentId = input.extraEnv?.SCUTTLE_AGENT_ID;
          if (agentId) {
            const detailRes = await fetch(`${server.url}/api/agents/${agentId}`);
            const detailJson = (await detailRes.json()) as {
              delegations: ReadonlyArray<{ status: string }>;
            };
            for (const d of detailJson.delegations) {
              observedStatusesDuringAsk.push(d.status);
            }
          }
          await Bun.sleep(20);
          return { finalText: "Use src/config.ts DEFAULT_PORT." };
        }

        return { finalText: "OK" };
      },
    );

    try {
      const projRes = await fetch(`${server.url}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: repo, name: "http-bounce" }),
      });
      expect(projRes.status).toBe(201);
      const proj = (await projRes.json()) as { id: string };

      const agentsRes = await fetch(`${server.url}/api/agents`);
      const agents = (await agentsRes.json()) as ReadonlyArray<{ id: string; projectId: string }>;
      const agent = agents.find((a) => a.projectId === proj.id)!;

      const delRes = await fetch(`${server.url}/api/agents/${agent.id}/delegations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "workhorse",
          kind: "task",
          title: "Wire port config",
          brief: "Update fixture",
          runtime: "local",
          maxBounces: 1,
        }),
      });
      expect(delRes.status).toBe(201);
      const delegation = Schema.decodeUnknownSync(AgentDelegation)(await delRes.json());

      await waitUntil(async () => {
        const res = await fetch(`${server.url}/api/agents/${agent.id}`);
        const detail = (await res.json()) as {
          delegations: ReadonlyArray<AgentDelegation>;
        };
        const current = detail.delegations.find((d) => d.id === delegation.id);
        return current?.status === "completed";
      });

      expect(observedStatusesDuringAsk).toContain("waiting_parent");
      expect(capturedParentPrompt).toContain("Which config file defines the port?");
      expect(capturedParentPrompt).toContain("Checked src/index.ts and env.ts");
      expect(capturedParentPrompt).toContain("Need port constant for test fixture");
      expect(capturedParentPrompt).toContain("bounce 1/1");

      const questionsRes = await fetch(
        `${server.url}/api/agents/${agent.id}/delegations/${delegation.id}/questions`,
      );
      expect(questionsRes.status).toBe(200);
      const questions = Schema.decodeUnknownSync(Schema.Array(AgentDelegationQuestion))(
        await questionsRes.json(),
      );
      expect(questions).toHaveLength(1);
      expect(questions[0]?.status).toBe("answered");
      expect(questions[0]?.answer).toBe("Use src/config.ts DEFAULT_PORT.");
      expect(questions[0]?.parentTurnId).toBeDefined();

      const notFoundRes = await fetch(
        `${server.url}/api/agents/${agent.id}/delegations/missing-del/ask`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: "Hello?" }),
        },
      );
      expect(notFoundRes.status).toBe(404);
    } finally {
      runSpy.mockRestore();
      await server.stop();
    }
  });

  it("queues behind an active user turn and serializes concurrent worker asks FIFO", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let releaseUserTurn!: () => void;
    const userTurnGate = new Promise<void>((resolve) => {
      releaseUserTurn = resolve;
    });
    let markUserTurnStarted!: () => void;
    const userTurnStarted = new Promise<void>((resolve) => {
      markUserTurnStarted = resolve;
    });

    let activePrimaryCount = 0;
    let maxPrimaryConcurrency = 0;
    const parentDispatchOrder: string[] = [];

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("Slow user turn")) {
          activePrimaryCount += 1;
          maxPrimaryConcurrency = Math.max(maxPrimaryConcurrency, activePrimaryCount);
          markUserTurnStarted();
          await userTurnGate;
          activePrimaryCount -= 1;
          return { finalText: "User turn done." };
        }
        if (input.prompt.includes("Worker question from")) {
          activePrimaryCount += 1;
          maxPrimaryConcurrency = Math.max(maxPrimaryConcurrency, activePrimaryCount);
          await Bun.sleep(20);
          activePrimaryCount -= 1;
          if (input.prompt.includes("Q-ONE")) {
            parentDispatchOrder.push("Q-ONE");
            return { finalText: "Answer for one" };
          }
          if (input.prompt.includes("Q-TWO")) {
            parentDispatchOrder.push("Q-TWO");
            return { finalText: "Answer for two" };
          }
          return { finalText: "Generic answer" };
        }
        await Bun.sleep(10);
        return { finalText: "Child idle finish" };
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

          const proj = yield* projects.create({ path: repo, name: "queue-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const d1 = yield* agents.delegateTask(agent.id, {
            role: "workhorse",
            kind: "task",
            title: "Worker 1",
            brief: "Work 1",
            runtime: "local",
          });
          const d2 = yield* agents.delegateTask(agent.id, {
            role: "workhorse",
            kind: "task",
            title: "Worker 2",
            brief: "Work 2",
            runtime: "local",
          });
          yield* Effect.promise(() =>
            waitUntil(() => {
              const all = listDelegations(db, agent.id, 10);
              return (
                all.find((d) => d.id === d1.id)?.status === "completed" &&
                all.find((d) => d.id === d2.id)?.status === "completed"
              );
            }),
          );

          db.prepare(
            "UPDATE agent_delegations SET status = 'running', completed_at = NULL WHERE id IN (?, ?)",
          ).run(d1.id, d2.id);

          yield* agents.sendTurn(agent.id, { prompt: "Slow user turn" });
          yield* Effect.promise(() => userTurnStarted);

          const ask1Promise = runtime.runPromise(
            agents.askParent(agent.id, d1.id, { kind: "plan_conflict", question: "Q-ONE" }),
          );
          yield* Effect.promise(() => Bun.sleep(15));
          const ask2Promise = runtime.runPromise(
            agents.askParent(agent.id, d2.id, { kind: "test_failure", question: "Q-TWO" }),
          );

          yield* Effect.promise(() => Bun.sleep(25));
          expect(parentDispatchOrder).toEqual([]);

          const dupErr = yield* agents
            .askParent(agent.id, d1.id, { question: "Dup?" })
            .pipe(Effect.flip);
          expect(dupErr.reason).toBe("rejected");

          releaseUserTurn();

          const [ans1, ans2] = yield* Effect.promise(() => Promise.all([ask1Promise, ask2Promise]));
          expect(ans1.status).toBe("answered");
          expect(ans1.answer).toBe("Answer for one");
          expect(ans2.status).toBe("answered");
          expect(ans2.answer).toBe("Answer for two");
          expect(parentDispatchOrder).toEqual(["Q-ONE", "Q-TWO"]);
          expect(maxPrimaryConcurrency).toBe(1);
          unsub();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });
});

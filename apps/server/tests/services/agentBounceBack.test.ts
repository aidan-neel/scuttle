import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  Agent,
  AgentDelegation,
  AgentDelegationQuestion,
  AgentDetail,
  Project,
  type ServerPushEvent,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const fetchDecoded = async <A>(url: string, schema: Schema.Decoder<A>, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, data: Schema.decodeUnknownSync(schema)(await res.json()) };
};

const createHttpProjectAgent = async (baseUrl: string, repo: string, name: string) => {
  const { status, data: proj } = await fetchDecoded(
    `${baseUrl}/api/projects`,
    Project,
    jsonPost({ path: repo, name }),
  );
  expect(status).toBe(201);
  const { data: agents } = await fetchDecoded(`${baseUrl}/api/agents`, Schema.Array(Agent));
  return agents.find((a) => a.projectId === proj.id)!;
};

const createHttpDelegation = (baseUrl: string, agentId: string, body: unknown) =>
  fetchDecoded(`${baseUrl}/api/agents/${agentId}/delegations`, AgentDelegation, jsonPost(body));

const waitHttpDelegationDone = (baseUrl: string, agentId: string, delegationId: string) =>
  waitUntil(async () => {
    const { data } = await fetchDecoded(`${baseUrl}/api/agents/${agentId}`, AgentDetail);
    return data.delegations.find((d) => d.id === delegationId)?.status === "completed";
  });

const waitDelegationDone = (events: ServerPushEvent[], delegationId: string) =>
  waitUntil(() =>
    events.some(
      (e) =>
        e.kind === "agent.delegation.upserted" &&
        e.delegation.id === delegationId &&
        e.delegation.status === "completed",
    ),
  );

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

          const runLocal = (title: string, maxBounces: number) =>
            Effect.gen(function* () {
              const del = yield* agents.delegateTask(agent.id, {
                role: "workhorse",
                kind: "task",
                title,
                brief: title,
                runtime: "local",
                maxBounces,
              });
              yield* Effect.promise(() => waitDelegationDone(events, del.id));
              return del;
            });

          const delWithBudget = yield* runLocal("Task with bounce", 2);
          expect(delWithBudget.bounceCount).toBe(0);
          expect(delWithBudget.maxBounces).toBe(2);

          const turn1Input = recordedInputs.find(
            (i) => i.extraEnv?.SCUTTLE_DELEGATION_ID === delWithBudget.id,
          );
          expect(turn1Input).toBeDefined();
          expect(turn1Input!.extraEnv?.SCUTTLE_AGENT_ID).toBe(agent.id);
          expect(turn1Input!.extraEnv?.SCUTTLE_API_URL).toContain("http://");
          expect(turn1Input!.prompt).toContain(`Delegation ID: ${delWithBudget.id}`);
          expect(turn1Input!.prompt).toContain("## Asking Your Parent Agent");
          expect(turn1Input!.prompt).toContain("--max-time 300");
          expect(turn1Input!.prompt).toContain("/delegations/$SCUTTLE_DELEGATION_ID/ask");
          expect(turn1Input!.prompt).toContain("/delegations/$SCUTTLE_DELEGATION_ID/questions");

          const delZero = yield* runLocal("Task zero bounce", 0);
          expect(delZero.maxBounces).toBe(0);

          const zeroInput = recordedInputs.find(
            (i) => i.extraEnv?.SCUTTLE_DELEGATION_ID === delZero.id,
          );
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

  it("completes HTTP /ask round-trip, rejects blank/oversized inputs with 400, enforces budget, and persists questions", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const server = await startScuttleServer({ port: 0, dbPath: ":memory:" });
    let capturedParentPrompt = "";
    let parentTurnCount = 0;
    const observedStatusesDuringAsk: string[] = [];

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          const apiUrl = input.extraEnv!.SCUTTLE_API_URL!;
          const agentId = input.extraEnv!.SCUTTLE_AGENT_ID!;
          const delegationId = input.extraEnv!.SCUTTLE_DELEGATION_ID!;
          const askUrl = `${apiUrl}/api/agents/${agentId}/delegations/${delegationId}/ask`;

          const invalidPayloads = [
            { question: "   \n\t " },
            { question: "x".repeat(4_001) },
            { question: "Valid?", attempted: "x".repeat(4_001) },
            { question: "Valid?", context: "x".repeat(8_001) },
          ];
          for (const payload of invalidPayloads) {
            expect((await fetch(askUrl, jsonPost(payload))).status).toBe(400);
          }

          const { data: before } = await fetchDecoded(
            `${apiUrl}/api/agents/${agentId}`,
            AgentDetail,
          );
          expect(before.delegations.find((d) => d.id === delegationId)?.bounceCount).toBe(0);
          expect(parentTurnCount).toBe(0);

          const { status, data: settledQuestion } = await fetchDecoded(
            askUrl,
            AgentDelegationQuestion,
            jsonPost({
              kind: "missing_context",
              question: "Which config file defines the port?",
              attempted: "Checked src/index.ts and env.ts",
              context: "Need port constant for test fixture",
            }),
          );
          expect(status).toBe(200);
          expect(settledQuestion.status).toBe("answered");
          expect(settledQuestion.answer).toBe("Use src/config.ts DEFAULT_PORT.");
          expect(settledQuestion.bounceNumber).toBe(1);

          expect((await fetch(askUrl, jsonPost({ question: "One more?" }))).status).toBe(422);

          return { finalText: `Resolved using: ${settledQuestion.answer}` };
        }

        if (input.prompt.includes("Worker question from")) {
          parentTurnCount += 1;
          capturedParentPrompt = input.prompt;
          const agentId = input.extraEnv?.SCUTTLE_AGENT_ID;
          if (agentId) {
            const { data } = await fetchDecoded(`${server.url}/api/agents/${agentId}`, AgentDetail);
            for (const d of data.delegations) observedStatusesDuringAsk.push(d.status);
          }
          await Bun.sleep(20);
          return { finalText: "Use src/config.ts DEFAULT_PORT." };
        }

        return { finalText: "OK" };
      },
    );

    try {
      const agent = await createHttpProjectAgent(server.url, repo, "http-bounce");
      const { status: delStatus, data: delegation } = await createHttpDelegation(
        server.url,
        agent.id,
        {
          role: "workhorse",
          kind: "task",
          title: "Wire port config",
          brief: "Update fixture",
          runtime: "local",
          maxBounces: 1,
        },
      );
      expect(delStatus).toBe(201);

      await waitHttpDelegationDone(server.url, agent.id, delegation.id);

      expect(observedStatusesDuringAsk).toContain("waiting_parent");
      expect(capturedParentPrompt).toContain("Which config file defines the port?");
      expect(capturedParentPrompt).toContain("Checked src/index.ts and env.ts");
      expect(capturedParentPrompt).toContain("Need port constant for test fixture");
      expect(capturedParentPrompt).toContain("bounce 1/1");
      expect(capturedParentPrompt).toContain("Do not call `POST .../cancel`");

      const { status: qStatus, data: questions } = await fetchDecoded(
        `${server.url}/api/agents/${agent.id}/delegations/${delegation.id}/questions`,
        Schema.Array(AgentDelegationQuestion),
      );
      expect(qStatus).toBe(200);
      expect(questions).toHaveLength(1);
      expect(questions[0]?.status).toBe("answered");
      expect(questions[0]?.answer).toBe("Use src/config.ts DEFAULT_PORT.");
      expect(questions[0]?.parentTurnId).toBeDefined();

      const notFoundRes = await fetch(
        `${server.url}/api/agents/${agent.id}/delegations/missing-del/ask`,
        jsonPost({ question: "Hello?" }),
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

    const userTurnGate = deferred();
    const userTurnStarted = deferred();
    let activePrimaryCount = 0;
    let maxPrimaryConcurrency = 0;
    const parentDispatchOrder: string[] = [];

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("Slow user turn")) {
          activePrimaryCount += 1;
          maxPrimaryConcurrency = Math.max(maxPrimaryConcurrency, activePrimaryCount);
          userTurnStarted.resolve();
          await userTurnGate.promise;
          activePrimaryCount -= 1;
          return { finalText: "User turn done." };
        }
        if (input.prompt.includes("Worker question from")) {
          activePrimaryCount += 1;
          maxPrimaryConcurrency = Math.max(maxPrimaryConcurrency, activePrimaryCount);
          await Bun.sleep(20);
          activePrimaryCount -= 1;
          const tag = input.prompt.includes("Q-ONE") ? "Q-ONE" : "Q-TWO";
          parentDispatchOrder.push(tag);
          return { finalText: `Answer for ${tag}` };
        }
        await Bun.sleep(10);
        return { finalText: "Child idle finish" };
      },
    );

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "queue-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const mkTask = (title: string) =>
            agents.delegateTask(agent.id, {
              role: "workhorse",
              kind: "task",
              title,
              brief: title,
              runtime: "local",
            });
          const [d1, d2] = yield* Effect.all([mkTask("Worker 1"), mkTask("Worker 2")]);
          yield* Effect.promise(() =>
            waitUntil(() =>
              [d1.id, d2.id].every(
                (id) =>
                  listDelegations(db, agent.id, 10).find((d) => d.id === id)?.status ===
                  "completed",
              ),
            ),
          );

          db.prepare(
            "UPDATE agent_delegations SET status = 'running', completed_at = NULL WHERE id IN (?, ?)",
          ).run(d1.id, d2.id);

          yield* agents.sendTurn(agent.id, { prompt: "Slow user turn" });
          yield* Effect.promise(() => userTurnStarted.promise);

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

          userTurnGate.resolve();

          const [ans1, ans2] = yield* Effect.promise(() => Promise.all([ask1Promise, ask2Promise]));
          expect(ans1.status).toBe("answered");
          expect(ans1.answer).toBe("Answer for Q-ONE");
          expect(ans2.status).toBe("answered");
          expect(ans2.answer).toBe("Answer for Q-TWO");
          expect(parentDispatchOrder).toEqual(["Q-ONE", "Q-TWO"]);
          expect(maxPrimaryConcurrency).toBe(1);
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("keeps pending question alive when HTTP client disconnects mid-wait and persists parent answer", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const server = await startScuttleServer({ port: 0, dbPath: ":memory:" });
    const parentStarted = deferred();
    const parentGate = deferred();
    const childGate = deferred();

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          const apiUrl = input.extraEnv!.SCUTTLE_API_URL!;
          const agentId = input.extraEnv!.SCUTTLE_AGENT_ID!;
          const delegationId = input.extraEnv!.SCUTTLE_DELEGATION_ID!;
          const controller = new AbortController();
          const askPromise = fetch(
            `${apiUrl}/api/agents/${agentId}/delegations/${delegationId}/ask`,
            {
              ...jsonPost({ question: "Will this survive curl disconnect?" }),
              signal: controller.signal,
            },
          );
          await parentStarted.promise;
          controller.abort();
          await askPromise.catch(() => undefined);
          await childGate.promise;
          return { finalText: "Polled answer and finished." };
        }
        if (input.prompt.includes("Worker question from")) {
          parentStarted.resolve();
          await parentGate.promise;
          return { finalText: "Answer persisted after disconnect." };
        }
        return { finalText: "OK" };
      },
    );

    try {
      const agent = await createHttpProjectAgent(server.url, repo, "disconnect-bounce");
      const { data: delegation } = await createHttpDelegation(server.url, agent.id, {
        role: "workhorse",
        kind: "task",
        title: "Disconnect resilience",
        brief: "Ask and disconnect",
        runtime: "local",
      });

      await parentStarted.promise;
      await Bun.sleep(25);
      const questionsUrl = `${server.url}/api/agents/${agent.id}/delegations/${delegation.id}/questions`;
      const QuestionsSchema = Schema.Array(AgentDelegationQuestion);
      const { data: midQuestions } = await fetchDecoded(questionsUrl, QuestionsSchema);
      expect(midQuestions).toHaveLength(1);
      expect(midQuestions[0]?.status).toBe("pending");

      parentGate.resolve();
      let settledQuestions: ReadonlyArray<AgentDelegationQuestion> = [];
      await waitUntil(async () => {
        const { data } = await fetchDecoded(questionsUrl, QuestionsSchema);
        settledQuestions = data;
        return data[0]?.status === "answered";
      });
      expect(settledQuestions[0]?.answer).toBe("Answer persisted after disconnect.");

      const { data: afterDetail } = await fetchDecoded(
        `${server.url}/api/agents/${agent.id}`,
        AgentDetail,
      );
      expect(afterDetail.delegations.find((d) => d.id === delegation.id)?.status).toBe("running");

      childGate.resolve();
      await waitHttpDelegationDone(server.url, agent.id, delegation.id);
    } finally {
      runSpy.mockRestore();
      await server.stop();
    }
  });
});

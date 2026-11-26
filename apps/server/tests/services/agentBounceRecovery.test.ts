import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AgentDelegationId, AgentDelegationQuestionId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as ServerConfig from "../../src/config.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as GitForgeService from "../../src/services/GitForgeService.ts";
import * as GitService from "../../src/services/GitService.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ProviderService from "../../src/services/ProviderService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";
import {
  insertQuestion,
  listQuestionsForDelegation,
} from "../../src/services/agent/agentQuestionStore.ts";
import { readAgentById } from "../../src/services/agent/agentStore.ts";
import {
  insertDelegation,
  listUnnotifiedSettledDelegations,
  readDelegationById,
  recoverStaleDelegations,
} from "../../src/services/agent/agentWorkStore.ts";
import { buildCompactionSummary } from "../../src/services/threadCompaction.ts";
import { readThreadById, recoverInterruptedThreads } from "../../src/services/threadStore.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-bounce-rec-"));
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

const makeCustomTimeoutLayer = (askParentTimeoutMs: number) => {
  const configLayer = ServerConfig.layer({ dbPath: ":memory:" });
  const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
  const eventBusLayer = EventBus.layer;
  const gitLayer = GitService.layer;
  const providerLayer = ProviderService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
  );
  const projectLayer = ProjectService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(gitLayer),
    Layer.provide(eventBusLayer),
  );
  const threadLayer = ThreadService.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
    Layer.provide(gitLayer),
    Layer.provide(projectLayer),
    Layer.provide(providerLayer),
  );
  const gitForgeLayer = GitForgeService.layer(
    GitForgeService.readGitForgeOptions(process.env),
  ).pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(gitLayer),
    Layer.provide(projectLayer),
    Layer.provide(threadLayer),
  );
  const agentLayer = AgentService.layer({
    runner: () =>
      Effect.succeed({ exitCode: 1, stdout: "", stderr: "not installed", timedOut: false }),
    fetch: (input, init) => fetch(input, init),
    enableCheckInScheduler: false,
    askParentTimeoutMs,
  }).pipe(
    Layer.provide(configLayer),
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
    Layer.provide(projectLayer),
    Layer.provide(providerLayer),
    Layer.provide(threadLayer),
    Layer.provide(gitLayer),
    Layer.provide(gitForgeLayer),
  );

  return Layer.mergeAll(
    configLayer,
    sqliteLayer,
    eventBusLayer,
    gitLayer,
    providerLayer,
    projectLayer,
    threadLayer,
    gitForgeLayer,
    agentLayer,
  );
};

describe("Agent delegation bounce-back recovery and edge cases", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      NodeFS.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("handles cancelDelegation, parent turn failure, timeout, AbortSignal cleanup, compaction, and crash recovery", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let mode: "block-parent" | "fail-parent" | "slow-user" = "block-parent";
    let releaseBlockedParent!: () => void;
    let blockedParentGate = new Promise<void>((resolve) => {
      releaseBlockedParent = resolve;
    });
    let markBlockedParentStarted!: () => void;
    let blockedParentStarted = new Promise<void>((resolve) => {
      markBlockedParentStarted = resolve;
    });
    let releaseSlowUser!: () => void;
    const slowUserGate = new Promise<void>((resolve) => {
      releaseSlowUser = resolve;
    });
    let markSlowUserStarted!: () => void;
    const slowUserStarted = new Promise<void>((resolve) => {
      markSlowUserStarted = resolve;
    });

    const seenParentQuestions: string[] = [];
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          await Bun.sleep(10);
          return { finalText: "Child turn finished" };
        }
        if (input.prompt.includes("Hold primary")) {
          markSlowUserStarted();
          await slowUserGate;
          return { finalText: "Released primary" };
        }
        if (input.prompt.includes("Worker question from")) {
          seenParentQuestions.push(input.prompt);
          if (mode === "fail-parent") {
            throw new Error("Parent model crashed");
          }
          markBlockedParentStarted();
          await blockedParentGate;
          return { finalText: "Late answer" };
        }
        return { finalText: "Ok" };
      },
    );

    const runtime = ManagedRuntime.make(makeCustomTimeoutLayer(60));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "edge-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const dTimeout = yield* agents.delegateTask(agent.id, {
            role: "workhorse",
            kind: "task",
            title: "Timeout worker",
            brief: "Work",
            runtime: "local",
          });
          yield* Effect.promise(() =>
            waitUntil(() => readDelegationById(db, agent.id, dTimeout.id)?.status === "completed"),
          );
          db.prepare(
            "UPDATE agent_delegations SET status = 'running', completed_at = NULL WHERE id = ?",
          ).run(dTimeout.id);

          const timedOutQuestion = yield* agents.askParent(agent.id, dTimeout.id, {
            kind: "unexpected_error",
            question: "Will time out",
          });
          expect(timedOutQuestion.status).toBe("canceled");
          expect(timedOutQuestion.error).toContain("Timed out");
          expect(readDelegationById(db, agent.id, dTimeout.id)?.status).toBe("running");

          releaseBlockedParent();
          yield* Effect.promise(() =>
            waitUntil(() => readThreadById(db, agent.primaryThreadId)?.status.kind === "idle"),
          );
          blockedParentGate = new Promise<void>((resolve) => {
            releaseBlockedParent = resolve;
          });
          blockedParentStarted = new Promise<void>((resolve) => {
            markBlockedParentStarted = resolve;
          });

          const askWaitPromise = runtime.runPromise(
            agents.askParent(agent.id, dTimeout.id, { question: "Cancel while waiting" }),
          );
          yield* Effect.promise(() => blockedParentStarted);

          expect(listUnnotifiedSettledDelegations(db, agent.id).map((d) => d.id)).not.toContain(
            dTimeout.id,
          );
          const checkInWhileWaiting = yield* agents.runCheckIn(agent.id);
          expect(checkInWhileWaiting.activeDelegations).toBe(1);
          const primaryDetail = yield* threads.getDetail(agent.primaryThreadId);
          const summary = buildCompactionSummary({
            db,
            thread: primaryDetail.thread,
            turns: primaryDetail.turns,
          });
          expect(summary).toContain("[waiting_parent] Timeout worker");

          const canceledDelegation = yield* agents.cancelDelegation(agent.id, dTimeout.id);
          expect(canceledDelegation.status).toBe("canceled");
          const canceledQuestion = yield* Effect.promise(() => askWaitPromise);
          expect(canceledQuestion.status).toBe("canceled");

          releaseBlockedParent();
          yield* Effect.promise(() =>
            waitUntil(() => readThreadById(db, agent.primaryThreadId)?.status.kind === "idle"),
          );

          const dFail = yield* agents.delegateTask(agent.id, {
            role: "workhorse",
            kind: "task",
            title: "Fail parent worker",
            brief: "Work",
            runtime: "local",
          });
          yield* Effect.promise(() =>
            waitUntil(() => readDelegationById(db, agent.id, dFail.id)?.status === "completed"),
          );
          db.prepare(
            "UPDATE agent_delegations SET status = 'running', completed_at = NULL WHERE id = ?",
          ).run(dFail.id);
          yield* agents.update(agent.id, { needsAttention: false });

          mode = "fail-parent";
          const failedQuestion = yield* agents.askParent(agent.id, dFail.id, {
            question: "Parent fails here",
          });
          expect(failedQuestion.status).toBe("failed");
          expect(failedQuestion.error).toContain("Parent model crashed");
          expect(readDelegationById(db, agent.id, dFail.id)?.status).toBe("running");
          expect(readAgentById(db, agent.id)?.needsAttention).toBe(true);

          mode = "slow-user";
          yield* agents.sendTurn(agent.id, { prompt: "Hold primary" });
          yield* Effect.promise(() => slowUserStarted);

          const abortController = new AbortController();
          const abortedPromise = runtime.runPromise(
            agents.askParent(
              agent.id,
              dFail.id,
              { question: "SHOULD_NOT_REACH_PARENT" },
              { signal: abortController.signal },
            ),
          );
          yield* Effect.promise(() => Bun.sleep(10));
          abortController.abort();
          const abortedQuestion = yield* Effect.promise(() => abortedPromise);
          expect(abortedQuestion.status).toBe("canceled");
          expect(readDelegationById(db, agent.id, dFail.id)?.status).toBe("running");

          releaseSlowUser();
          yield* Effect.promise(() =>
            waitUntil(() => readThreadById(db, agent.primaryThreadId)?.status.kind === "idle"),
          );
          expect(seenParentQuestions.some((p) => p.includes("SHOULD_NOT_REACH_PARENT"))).toBe(
            false,
          );

          const crashDelId = AgentDelegationId.make("del-crash-1");
          const crashChild = yield* threads.createIdle({
            projectId: proj.id,
            title: "Crashed child",
            runtime: "local",
            branch: "main",
            modelSelection: agent.modelSelection,
          });
          insertDelegation(db, {
            id: crashDelId,
            agentId: agent.id,
            parentThreadId: agent.primaryThreadId,
            childThreadId: crashChild.id,
            role: "workhorse",
            kind: "task",
            title: "Crashed child",
            brief: "Boom",
            modelSelection: agent.modelSelection,
            status: "waiting_parent",
            bounceCount: 1,
            maxBounces: 3,
            createdAt: new Date().toISOString(),
          });
          insertQuestion(db, {
            id: AgentDelegationQuestionId.make("q-crash-1"),
            delegationId: crashDelId,
            agentId: agent.id,
            childThreadId: crashChild.id,
            parentThreadId: agent.primaryThreadId,
            kind: "other",
            question: "Still waiting on restart?",
            status: "pending",
            bounceNumber: 1,
            createdAt: new Date().toISOString(),
          });

          recoverInterruptedThreads(db);
          recoverStaleDelegations(db);

          expect(readDelegationById(db, agent.id, crashDelId)?.status).toBe("canceled");
          const recoveredQuestions = listQuestionsForDelegation(db, agent.id, crashDelId);
          expect(recoveredQuestions[0]?.status).toBe("canceled");
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("cancels pending question and resolves waiter when child thread settles while waiting_parent", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let releaseChild!: () => void;
    const childGate = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    let markParentStarted!: () => void;
    const parentStarted = new Promise<void>((resolve) => {
      markParentStarted = resolve;
    });
    let releaseParent!: () => void;
    const parentGate = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          await childGate;
          return { finalText: "Child exited early without answer." };
        }
        if (input.prompt.includes("Worker question from")) {
          markParentStarted();
          await parentGate;
          return { finalText: "Too late" };
        }
        return { finalText: "Ok" };
      },
    );

    const runtime = ManagedRuntime.make(makeCustomTimeoutLayer(5_000));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "child-settle-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const del = yield* agents.delegateTask(agent.id, {
            role: "workhorse",
            kind: "task",
            title: "Early exit worker",
            brief: "Work",
            runtime: "local",
          });

          const askPromise = runtime.runPromise(
            agents.askParent(agent.id, del.id, { question: "Are you there?" }),
          );
          yield* Effect.promise(() => parentStarted);
          expect(readDelegationById(db, agent.id, del.id)?.status).toBe("waiting_parent");

          releaseChild();

          const settledQ = yield* Effect.promise(() => askPromise);
          expect(settledQ.status).toBe("canceled");
          expect(settledQ.error).toContain("Child thread settled");
          yield* Effect.promise(() =>
            waitUntil(() => readDelegationById(db, agent.id, del.id)?.status === "completed"),
          );

          releaseParent();
          yield* Effect.promise(() =>
            waitUntil(() => readThreadById(db, agent.primaryThreadId)?.status.kind === "idle"),
          );
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });
});

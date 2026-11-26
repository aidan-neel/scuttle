import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AgentDelegationId, AgentDelegationQuestionId, AgentId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";
import {
  insertQuestion,
  listQuestionsForDelegation,
  readPendingQuestionForDelegation,
} from "../../src/services/agent/agentQuestionStore.ts";
import { readAgentById } from "../../src/services/agent/agentStore.ts";
import {
  insertDelegation,
  listUnnotifiedSettledDelegations,
  readDelegationById,
} from "../../src/services/agent/agentWorkStore.ts";
import { buildCompactionSummary } from "../../src/services/threadCompaction.ts";
import { readThreadById } from "../../src/services/threadStore.ts";

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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const abortableWait = (signal: AbortSignal): Promise<HarnessTurnResult> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ interrupted: true });
      return;
    }
    signal.addEventListener("abort", () => resolve({ interrupted: true }), { once: true });
  });

const makeBounceLayer = (askParentTimeoutMs = 5_000, dbPath = ":memory:") =>
  makeAppLayer({ dbPath }, undefined, { askParentTimeoutMs, enableCheckInScheduler: false });

const delegateLocal = (
  agents: AgentService.AgentService["Service"],
  agentId: AgentId,
  title: string,
) =>
  agents.delegateTask(agentId, {
    role: "workhorse",
    kind: "task",
    title,
    brief: title,
    runtime: "local",
  });

const delegateCompletedToRunning = (
  db: Parameters<typeof readDelegationById>[0],
  agents: AgentService.AgentService["Service"],
  agentId: AgentId,
  title: string,
) =>
  Effect.gen(function* () {
    const del = yield* delegateLocal(agents, agentId, title);
    yield* Effect.promise(() =>
      waitUntil(() => readDelegationById(db, agentId, del.id)?.status === "completed"),
    );
    db.prepare(
      "UPDATE agent_delegations SET status = 'running', completed_at = NULL WHERE id = ?",
    ).run(del.id);
    return del;
  });

const waitThreadIdle = (db: Parameters<typeof readThreadById>[0], threadId: string) =>
  Effect.promise(() => waitUntil(() => readThreadById(db, threadId)?.status.kind === "idle"));

const spyGatedTurns = (childGate: Promise<void>, parentStarted: () => void) =>
  spyOn(claudeAdapter, "runTurn").mockImplementation(
    async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
      if (input.prompt.includes("You are a delegated")) {
        await childGate;
        return { finalText: "Child finished." };
      }
      if (input.prompt.includes("Worker question from")) {
        parentStarted();
        return abortableWait(input.signal);
      }
      return { finalText: "Ok" };
    },
  );

describe("Agent delegation bounce-back recovery and edge cases", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      NodeFS.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("handles timeout interrupt, cancelDelegation, parent turn failure, and compaction", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let mode: "block-parent" | "fail-parent" = "block-parent";
    let blockedParentStarted = deferred();

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated")) {
          await Bun.sleep(10);
          return { finalText: "Child turn finished" };
        }
        if (input.prompt.includes("Worker question from")) {
          if (mode === "fail-parent") throw new Error("Parent model crashed");
          blockedParentStarted.resolve();
          return abortableWait(input.signal);
        }
        return { finalText: "Ok" };
      },
    );

    const runtime = ManagedRuntime.make(makeBounceLayer(60));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "edge-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const dTimeout = yield* delegateCompletedToRunning(
            db,
            agents,
            agent.id,
            "Timeout worker",
          );

          const timedOutQuestion = yield* agents.askParent(agent.id, dTimeout.id, {
            kind: "unexpected_error",
            question: "Will time out",
          });
          expect(timedOutQuestion.status).toBe("canceled");
          expect(timedOutQuestion.error).toContain("Timed out");
          expect(readDelegationById(db, agent.id, dTimeout.id)?.status).toBe("running");

          yield* waitThreadIdle(db, agent.primaryThreadId);
          blockedParentStarted = deferred();

          const askWaitPromise = runtime.runPromise(
            agents.askParent(agent.id, dTimeout.id, { question: "Cancel while waiting" }),
          );
          yield* Effect.promise(() => blockedParentStarted.promise);

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

          yield* waitThreadIdle(db, agent.primaryThreadId);

          const dFail = yield* delegateCompletedToRunning(
            db,
            agents,
            agent.id,
            "Fail parent worker",
          );
          yield* agents.update(agent.id, { needsAttention: false });

          mode = "fail-parent";
          const failedQuestion = yield* agents.askParent(agent.id, dFail.id, {
            question: "Parent fails here",
          });
          expect(failedQuestion.status).toBe("failed");
          expect(failedQuestion.error).toContain("Parent model crashed");
          expect(readDelegationById(db, agent.id, dFail.id)?.status).toBe("running");
          expect(readAgentById(db, agent.id)?.needsAttention).toBe(true);
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("cancels pending question and interrupts parent turn when child settles while waiting_parent", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const childGate = deferred();
    const parentStarted = deferred();
    const runSpy = spyGatedTurns(childGate.promise, parentStarted.resolve);

    const runtime = ManagedRuntime.make(makeBounceLayer(5_000));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "child-settle-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const del = yield* delegateLocal(agents, agent.id, "Early exit worker");

          const askPromise = runtime.runPromise(
            agents.askParent(agent.id, del.id, { question: "Are you there?" }),
          );
          yield* Effect.promise(() => parentStarted.promise);
          expect(readDelegationById(db, agent.id, del.id)?.status).toBe("waiting_parent");

          childGate.resolve();

          const settledQ = yield* Effect.promise(() => askPromise);
          expect(settledQ.status).toBe("canceled");
          expect(settledQ.error).toContain("Child thread settled");
          yield* Effect.promise(() =>
            waitUntil(() => readDelegationById(db, agent.id, del.id)?.status === "completed"),
          );
          yield* waitThreadIdle(db, agent.primaryThreadId);
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("interrupts only the canceled worker parent turn and unblocks queued worker B immediately", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const parentAStarted = deferred();
    const childAGate = deferred();
    let parentAAborted = false;
    let answerForB = "";

    const runtime = ManagedRuntime.make(makeBounceLayer(5_000));

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("You are a delegated") && input.prompt.includes("Worker A")) {
          await childAGate.promise;
          return { finalText: "Worker A done" };
        }
        if (input.prompt.includes("You are a delegated") && input.prompt.includes("Worker B")) {
          const apiUrl = input.extraEnv!.SCUTTLE_API_URL;
          expect(apiUrl).toBeDefined();
          await parentAStarted.promise;
          const res = await runtime.runPromise(
            Effect.gen(function* () {
              const agents = yield* AgentService.AgentService;
              return yield* agents.askParent(
                AgentId.make(input.extraEnv!.SCUTTLE_AGENT_ID!),
                AgentDelegationId.make(input.extraEnv!.SCUTTLE_DELEGATION_ID!),
                { question: "QUESTION_B" },
              );
            }),
          );
          answerForB = res.answer ?? "";
          return { finalText: `Worker B done: ${answerForB}` };
        }
        if (input.prompt.includes("Worker question from") && input.prompt.includes("QUESTION_A")) {
          parentAStarted.resolve();
          const res = await abortableWait(input.signal);
          parentAAborted = res.interrupted === true;
          return res;
        }
        if (input.prompt.includes("Worker question from") && input.prompt.includes("QUESTION_B")) {
          return { finalText: "Answer for B" };
        }
        return { finalText: "Ok" };
      },
    );

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "concurrent-cancel" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const [dA, dB] = yield* Effect.all([
            delegateLocal(agents, agent.id, "Worker A"),
            delegateLocal(agents, agent.id, "Worker B"),
          ]);

          const askAPromise = runtime.runPromise(
            agents.askParent(agent.id, dA.id, { question: "QUESTION_A" }),
          );
          yield* Effect.promise(() => parentAStarted.promise);
          yield* Effect.promise(() =>
            waitUntil(() => readPendingQuestionForDelegation(db, dB.id) !== null),
          );

          const canceledA = yield* agents.cancelDelegation(agent.id, dA.id);
          expect(canceledA.status).toBe("canceled");
          const settledA = yield* Effect.promise(() => askAPromise);
          expect(settledA.status).toBe("canceled");

          yield* Effect.promise(() =>
            waitUntil(() => readDelegationById(db, agent.id, dB.id)?.status === "completed"),
          );
          expect(parentAAborted).toBe(true);
          expect(answerForB).toBe("Answer for B");
          childAGate.resolve();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("immediately unblocks awaiting /ask with canceled status when agent is deleted", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const parentStarted = deferred();
    const childGate = deferred();
    const runSpy = spyGatedTurns(childGate.promise, parentStarted.resolve);

    const runtime = ManagedRuntime.make(makeBounceLayer(30_000));

    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "delete-agent-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const del = yield* delegateLocal(agents, agent.id, "Blocked worker");

          const askPromise = runtime.runPromise(
            agents.askParent(agent.id, del.id, { question: "Are you still there?" }),
          );
          yield* Effect.promise(() => parentStarted.promise);

          const startMs = Date.now();
          yield* agents.remove(agent.id);
          const settled = yield* Effect.promise(() => askPromise);
          expect(Date.now() - startMs).toBeLessThan(1_000);
          expect(settled.status).toBe("canceled");
          expect(settled.error).toContain("deleted");

          const remaining = db
            .query<{ readonly count: number }, [string]>(
              "SELECT COUNT(*) AS count FROM agent_delegation_questions WHERE agent_id = ?",
            )
            .get(agent.id);
          expect(remaining?.count).toBe(0);
          childGate.resolve();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("recovers waiting_parent delegations and pending questions across a real SQLite file restart", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);
    const dbPath = NodePath.join(root, "scuttle.sqlite");

    const delId = AgentDelegationId.make("del-file-crash");
    const qId = AgentDelegationQuestionId.make("q-file-crash");
    let agentId!: AgentId;

    const runtime1 = ManagedRuntime.make(makeBounceLayer(5_000, dbPath));
    try {
      await runtime1.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          const proj = yield* projects.create({ path: repo, name: "restart-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;
          agentId = agent.id;

          const child = yield* threads.createIdle({
            projectId: proj.id,
            title: "Restarted child",
            runtime: "local",
            branch: "main",
            modelSelection: agent.modelSelection,
          });
          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO turns
               (id, thread_id, seq, origin, session_epoch, user_message, assistant_message, thinking_text, status, started_at, cost_usd, model_selection_json)
             VALUES (?, ?, 1, 'user', 0, 'work', '', '', 'running', ?, 0, ?)`,
          ).run(TurnId.make("turn-crash-1"), child.id, now, JSON.stringify(agent.modelSelection));
          insertDelegation(db, {
            id: delId,
            agentId: agent.id,
            parentThreadId: agent.primaryThreadId,
            childThreadId: child.id,
            role: "workhorse",
            kind: "task",
            title: "Restarted child",
            brief: "Work",
            modelSelection: agent.modelSelection,
            status: "waiting_parent",
            bounceCount: 1,
            maxBounces: 3,
            createdAt: now,
          });
          insertQuestion(db, {
            id: qId,
            delegationId: delId,
            agentId: agent.id,
            childThreadId: child.id,
            parentThreadId: agent.primaryThreadId,
            kind: "other",
            question: "Still waiting after restart?",
            status: "pending",
            bounceNumber: 1,
            createdAt: now,
          });
        }),
      );
    } finally {
      await runtime1.dispose();
    }

    const runtime2 = ManagedRuntime.make(makeBounceLayer(5_000, dbPath));
    try {
      await runtime2.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          yield* AgentService.AgentService;
          expect(readDelegationById(db, agentId, delId)?.status).toBe("canceled");
          const questions = listQuestionsForDelegation(db, agentId, delId);
          expect(questions).toHaveLength(1);
          expect(questions[0]?.status).toBe("canceled");
        }),
      );
    } finally {
      await runtime2.dispose();
    }
  });
});

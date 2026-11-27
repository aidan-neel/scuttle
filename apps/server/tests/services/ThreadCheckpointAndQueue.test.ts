import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  ModelPerformanceSummary,
  ModelPerfRun,
  type QueuedTurn,
  RewindThreadResult,
  type ServerPushEvent,
  ThreadVisualization,
  VisualizationId,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { handleApiRequest } from "../../src/httpRoutes.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import { codexAdapter } from "../../src/providers/codexAdapter.ts";
import type {
  HarnessTurnInput,
  HarnessTurnResult,
  SteerPayload,
} from "../../src/providers/types.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ModelPerformanceService from "../../src/services/ModelPerformanceService.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";
import * as VisualizationStore from "../../src/services/VisualizationStore.ts";

const CLAUDE = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude" as const,
  model: "claude-sonnet-4-5",
};
const CODEX = {
  providerId: ProviderId.make("codex"),
  providerKind: "codex" as const,
  model: "gpt-5-codex",
};

const makeGitRepo = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-cq-"));
  const repo = NodePath.join(root, "repo");
  NodeFS.mkdirSync(repo, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
  Bun.spawnSync(["git", "config", "user.email", "t@e.co"], { cwd: repo });
  Bun.spawnSync(["git", "config", "user.name", "T"], { cwd: repo });
  NodeFS.writeFileSync(NodePath.join(repo, "app.txt"), "v0\n");
  Bun.spawnSync(["git", "add", "."], { cwd: repo });
  Bun.spawnSync(["git", "commit", "-qm", "init"], { cwd: repo });
  return { root, repo };
};

const waitUntil = async (fn: () => boolean, ms = 4_000) => {
  for (let end = Date.now() + ms; Date.now() < end; await Bun.sleep(10)) if (fn()) return;
  throw new Error("Timed out waiting for condition.");
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const api = (path: string, method = "GET", body?: unknown) => {
  const url = `http://127.0.0.1${path}`;
  return handleApiRequest(
    new Request(url, {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }),
    new URL(url),
  );
};

const waitTurn = (events: ServerPushEvent[], msg: string, status = "completed") =>
  Effect.promise(() =>
    waitUntil(() =>
      events.some(
        (e) => e.kind === "turn.upserted" && e.turn.userMessage === msg && e.turn.status === status,
      ),
    ),
  );

const runTest = async <E>(
  fn: (
    events: ServerPushEvent[],
  ) => Effect.Effect<void, E, Layer.Success<ReturnType<typeof makeAppLayer>>>,
) => {
  const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
  const events: ServerPushEvent[] = [];
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const unsub = (yield* EventBus.EventBus).subscribe((e) => events.push(e));
        try {
          yield* fn(events);
        } finally {
          unsub();
        }
      }),
    );
  } finally {
    await runtime.dispose();
  }
};

describe("Thread checkpoints, rewind, queue/steer, telemetry, and visualizations", () => {
  const tempRoots: string[] = [];
  afterEach(() => {
    while (tempRoots.length > 0) NodeFS.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  });

  it("captures baseline + post-turn checkpoints, records perf telemetry, and supports rewind with restoreFiles true/false and cwd safety guard", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);
    let n = 0;
    const spy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input): Promise<HarnessTurnResult> => {
        n += 1;
        input.emit({ kind: "session", providerSessionId: `s-${n}` });
        await Bun.sleep(15);
        input.emit({ kind: "assistant.delta", text: `R${n}` });
        NodeFS.writeFileSync(NodePath.join(input.cwd, "app.txt"), `v${n}\n`);
        NodeFS.writeFileSync(NodePath.join(input.cwd, `step${n}.txt`), `${n}\n`);
        return {
          finalText: `R${n}`,
          providerSessionId: `s-${n}`,
          costUsd: 0.12,
          usage: { inputTokens: 200, outputTokens: 50, cacheReadTokens: 20 },
        };
      },
    );

    try {
      await runTest((events) =>
        Effect.gen(function* () {
          const bus = yield* EventBus.EventBus;
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const threads = yield* ThreadService.ThreadService;
          const perf = yield* ModelPerformanceService.ModelPerformanceService;

          const proj = yield* projects.create({ path: repo, name: "ckpt" });
          const created = yield* threads.create({
            projectId: proj.id,
            prompt: "First",
            runtime: "local",
            branch: "main",
            modelSelection: CLAUDE,
          });
          const tid = created.thread.id;
          const t1Id = created.turns[0]!.id;
          yield* waitTurn(events, "First");
          const t2 = yield* threads.sendTurn(tid, { prompt: "Second" });
          yield* waitTurn(events, "Second");

          VisualizationStore.upsertVisualization(
            db,
            {
              threadId: tid,
              turnId: t1Id,
              spec: { mode: "structured", title: "V1", blocks: [{ kind: "callout", body: "a" }] },
            },
            bus,
          );
          VisualizationStore.upsertVisualization(
            db,
            {
              threadId: tid,
              turnId: t2.id,
              spec: { mode: "structured", title: "V2", blocks: [{ kind: "callout", body: "b" }] },
            },
            bus,
          );

          const detail = yield* threads.getDetail(tid);
          expect(detail.checkpoints?.map((c) => c.ordinal)).toEqual([0, 1, 2]);
          expect(detail.checkpoints![0]!.turnId).toBeUndefined();
          expect(detail.checkpoints![1]!.filesChanged).toBe(2);
          expect(detail.checkpoints![2]!.filesChanged).toBe(2);
          expect(detail.visualizations?.map((v) => v.title)).toEqual(["V1", "V2"]);
          expect(events.filter((e) => e.kind === "checkpoint.created").length).toBe(3);
          expect(events.filter((e) => e.kind === "perf.recorded").length).toBe(2);

          const perf1 = yield* perf.getRunByTurnOrDelegation({ turnId: t1Id });
          expect(perf1?.firstTokenMs).toBeGreaterThanOrEqual(0);
          expect(perf1?.costUsd).toBe(0.12);

          const perfRes = yield* api("/api/performance?days=7");
          expect(perfRes?.status).toBe(200);
          const summary = Schema.decodeUnknownSync(ModelPerformanceSummary)(
            yield* Effect.promise(() => perfRes!.json()),
          );
          expect(summary.recentRuns.length).toBeGreaterThanOrEqual(2);

          const rateRes = yield* api("/api/performance/rate", "POST", {
            turnId: t1Id,
            category: "backend",
            score: 9,
            outcome: "pass",
          });
          expect(
            Schema.decodeUnknownSync(ModelPerfRun)(yield* Effect.promise(() => rateRes!.json()))
              .score,
          ).toBe(9);

          const other = yield* threads.createIdle({
            projectId: proj.id,
            title: "Other",
            runtime: "local",
            branch: "main",
            modelSelection: CLAUDE,
          });
          const guardErr = yield* threads
            .rewindThread(tid, { checkpointOrdinal: 1, restoreFiles: true })
            .pipe(Effect.flip);
          expect(guardErr.message).toContain("worktree");

          const noFiles = yield* threads.rewindThread(tid, {
            checkpointOrdinal: 1,
            restoreFiles: false,
          });
          expect(noFiles.filesRestored).toBe(false);
          expect(noFiles.restoredPrompt).toBe("Second");
          expect(noFiles.turns.map((t) => t.id)).toEqual([t1Id]);
          expect(noFiles.checkpoints.map((c) => c.ordinal)).toEqual([0, 1]);
          expect(noFiles.thread.providerSessionId).toBeUndefined();
          expect(NodeFS.existsSync(NodePath.join(repo, "step2.txt"))).toBe(true);
          expect((yield* threads.getDetail(tid)).visualizations?.map((v) => v.title)).toEqual([
            "V1",
          ]);

          yield* threads.settle(other.id, true);
          const rwRes = yield* api(`/api/threads/${tid}/rewind`, "POST", {
            checkpointOrdinal: 0,
            restoreFiles: true,
          });
          expect(rwRes?.status).toBe(200);
          const rw = Schema.decodeUnknownSync(RewindThreadResult)(
            yield* Effect.promise(() => rwRes!.json()),
          );
          expect(rw.filesRestored).toBe(true);
          expect(rw.restoredPrompt).toBe("First");
          expect(rw.turns).toHaveLength(0);
          expect(rw.checkpoints.map((c) => c.ordinal)).toEqual([0]);
          expect(NodeFS.readFileSync(NodePath.join(repo, "app.txt"), "utf8")).toBe("v0\n");
          expect(NodeFS.existsSync(NodePath.join(repo, "step1.txt"))).toBe(false);
          expect(events.some((e) => e.kind === "thread.rewound" && e.checkpointOrdinal === 0)).toBe(
            true,
          );
          expect((yield* api(`/api/performance/runs/${perf1!.id}`, "DELETE"))?.status).toBe(204);
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("steers by default, falls back to front of queue, supports edit/cancel/promote, and auto-drains on completion/interruption", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);
    const t1Started = deferred();
    const t1Gate = deferred();
    const steered: SteerPayload[] = [];
    const prompts: string[] = [];
    let acceptSteer = true;

    const claudeSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput) => {
        prompts.push(input.prompt);
        input.registerSteer?.(async (p) => {
          if (!acceptSteer) return false;
          steered.push(p);
          return true;
        });
        t1Started.resolve();
        await t1Gate.promise;
        return { finalText: "Done 1", providerSessionId: "s-1" };
      },
    );
    const codexSpy = spyOn(codexAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput) => {
        prompts.push(`codex:${input.prompt}`);
        return { finalText: "Codex drained", providerSessionId: "c-1" };
      },
    );

    try {
      await runTest((events) =>
        Effect.gen(function* () {
          const projects = yield* ProjectService.ProjectService;
          const threads = yield* ThreadService.ThreadService;
          const proj = yield* projects.create({ path: repo, name: "queue" });
          const created = yield* threads.create({
            projectId: proj.id,
            prompt: "Active",
            runtime: "local",
            branch: "main",
            modelSelection: CLAUDE,
          });
          const tid = created.thread.id;
          yield* Effect.promise(() => t1Started.promise);

          const steerRes = yield* api(`/api/threads/${tid}/turns`, "POST", { prompt: "Steer 1" });
          expect(steerRes?.status).toBe(201);
          const steerJson = (yield* Effect.promise(() => steerRes!.json())) as {
            kind: string;
            disposition: string;
            id: string;
          };
          expect([steerJson.kind, steerJson.disposition, steerJson.id]).toEqual([
            "steered",
            "steered",
            created.turns[0]!.id,
          ]);
          expect(steered.map((p) => p.prompt)).toEqual(["Steer 1"]);

          const q1 = yield* threads.dispatchTurn(tid, { prompt: "QA", mode: "queue" });
          const q2 = yield* threads.dispatchTurn(tid, {
            prompt: "QB",
            mode: "queue",
            modelSelection: CODEX,
          });
          if (q1.kind !== "queued" || q2.kind !== "queued") throw new Error("Expected queued");
          acceptSteer = false;
          const fb = yield* threads.dispatchTurn(tid, { prompt: "Fallback" });
          if (fb.kind !== "queued") throw new Error("Expected queued fallback");
          expect((yield* threads.listQueuedTurns(tid)).map((q) => q.prompt)).toEqual([
            "Fallback",
            "QA",
            "QB",
          ]);

          const patchRes = yield* api(`/api/threads/${tid}/queue/${q1.queuedTurn.id}`, "PATCH", {
            prompt: "QA2",
          });
          expect(((yield* Effect.promise(() => patchRes!.json())) as QueuedTurn).prompt).toBe(
            "QA2",
          );
          expect(
            (yield* api(`/api/threads/${tid}/queue/${fb.queuedTurn.id}`, "DELETE"))?.status,
          ).toBe(204);

          yield* api(`/api/threads/${tid}/queue/${q2.queuedTurn.id}/promote`, "POST");
          const listRes = yield* api(`/api/threads/${tid}/queue`);
          expect(
            ((yield* Effect.promise(() => listRes!.json())) as QueuedTurn[]).map((q) => q.prompt),
          ).toEqual(["QB", "QA2"]);

          acceptSteer = true;
          expect((yield* threads.promoteQueuedTurn(tid, q1.queuedTurn.id)).kind).toBe("steered");
          expect((yield* threads.listQueuedTurns(tid)).map((q) => q.prompt)).toEqual(["QB"]);

          t1Gate.resolve();
          yield* waitTurn(events, "QB");
          expect(prompts.some((p) => p.startsWith("codex:") && p.includes("QB"))).toBe(true);
          expect(yield* threads.listQueuedTurns(tid)).toHaveLength(0);

          const runAbort = (
            prompt: string,
            queued: string,
            act: Effect.Effect<void, unknown>,
            after: (getRan: () => boolean) => Effect.Effect<void, unknown>,
          ) =>
            Effect.gen(function* () {
              const started = deferred();
              let ran = false;
              const s = spyOn(codexAdapter, "runTurn").mockImplementation(async (input) => {
                if (input.prompt.includes(queued)) {
                  ran = true;
                  return { finalText: "Drained" };
                }
                started.resolve();
                await new Promise<void>((r) =>
                  input.signal.addEventListener("abort", () => r(), { once: true }),
                );
                return { interrupted: true };
              });
              try {
                yield* threads.dispatchTurn(tid, { prompt });
                yield* Effect.promise(() => started.promise);
                yield* threads.dispatchTurn(tid, { prompt: queued, mode: "queue" });
                yield* act;
                yield* after(() => ran);
              } finally {
                s.mockRestore();
              }
            });

          yield* runAbort("Hang 1", "After int", threads.interrupt(tid), () =>
            waitTurn(events, "After int"),
          );
          yield* runAbort("Hang 2", "Never", threads.remove(tid), (getRan) =>
            Effect.promise(() => Bun.sleep(40)).pipe(
              Effect.map(() => expect(getRan()).toBe(false)),
            ),
          );
        }),
      );
    } finally {
      claudeSpy.mockRestore();
      codexSpy.mockRestore();
    }
  });

  it("records perf telemetry on failed turns and persists visualizations via VisualizationStore + HTTP route", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);
    const spy = spyOn(claudeAdapter, "runTurn").mockImplementation(async () => {
      throw new Error("Simulated failure");
    });

    try {
      await runTest((events) =>
        Effect.gen(function* () {
          const bus = yield* EventBus.EventBus;
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const threads = yield* ThreadService.ThreadService;
          const perf = yield* ModelPerformanceService.ModelPerformanceService;

          const proj = yield* projects.create({ path: repo, name: "viz" });
          const created = yield* threads.create({
            projectId: proj.id,
            prompt: "Fail",
            runtime: "local",
            branch: "main",
            modelSelection: CLAUDE,
          });
          const tid = created.thread.id;
          const turnId = created.turns[0]!.id;
          yield* waitTurn(events, "Fail", "failed");

          expect(yield* perf.getRunByTurnOrDelegation({ turnId })).not.toBeNull();
          expect(events.some((e) => e.kind === "perf.recorded" && e.run.turnId === turnId)).toBe(
            true,
          );

          const vid = VisualizationId.make("viz-1");
          VisualizationStore.upsertVisualization(
            db,
            {
              id: vid,
              threadId: tid,
              turnId,
              spec: {
                mode: "structured",
                title: "Init",
                blocks: [{ kind: "kpis", items: [{ label: "N", value: 3 }] }],
              },
            },
            bus,
          );
          const up = VisualizationStore.upsertVisualization(
            db,
            {
              id: vid,
              threadId: tid,
              title: "Upd",
              spec: { mode: "sandbox", title: "Upd", html: "<div>ok</div>", height: 240 },
            },
            bus,
          );
          expect(up.title).toBe("Upd");
          expect(events.filter((e) => e.kind === "viz.upserted").length).toBe(2);

          const vizRes = yield* api(`/api/threads/${tid}/visualizations`);
          expect(vizRes?.status).toBe(200);
          const list = Schema.decodeUnknownSync(Schema.Array(ThreadVisualization))(
            yield* Effect.promise(() => vizRes!.json()),
          );
          expect(list.map((v) => v.title)).toEqual(["Upd"]);
          expect(VisualizationStore.deleteAfterTurn(db, tid, 0)).toBe(1);
          expect(VisualizationStore.listByThread(db, tid)).toHaveLength(0);
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});

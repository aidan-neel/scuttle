import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ServerPushEvent } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import { makeAppLayer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ProviderService from "../../src/services/ProviderService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";
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

describe("turn guards, deferred commit, and migration backfill", () => {
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

  it("backfills parent_notified_at on existing settled delegations only when migrating the column", () => {
    const db = new Database(":memory:");
    try {
      db.run(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT UNIQUE, is_git_repo INTEGER DEFAULT 0, default_branch TEXT DEFAULT 'main', last_message TEXT, last_activity_at TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, project_name TEXT, title TEXT, runtime TEXT, branch TEXT, worktree_path TEXT, cwd TEXT, provider_id TEXT, provider_kind TEXT, model TEXT, effort TEXT, runtime_mode TEXT DEFAULT 'auto', interaction_mode TEXT DEFAULT 'default', status_json TEXT, settled_at TEXT, provider_session_id TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE agents (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, purpose TEXT DEFAULT '', primary_thread_id TEXT, runtime TEXT DEFAULT 'local', model_selection_json TEXT, model_stack_json TEXT DEFAULT '{}', instructions_md TEXT DEFAULT '', check_in_interval_minutes INTEGER, last_check_in_at TEXT, last_summary TEXT, needs_attention INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
        CREATE TABLE agent_delegations (id TEXT PRIMARY KEY, agent_id TEXT, parent_thread_id TEXT, child_thread_id TEXT, role TEXT, kind TEXT, title TEXT, brief TEXT, model_selection_json TEXT, status TEXT, issue_id TEXT, pr_url TEXT, result_summary TEXT, created_at TEXT, completed_at TEXT);
      `);
      db.run(`
        INSERT INTO agent_delegations (id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, created_at, completed_at)
        VALUES
          ('d-done', 'a1', 't0', 't1', 'fast', 'task', 'Old done', 'b', '{}', 'completed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'),
          ('d-fail', 'a1', 't0', 't2', 'fast', 'task', 'Old fail', 'b', '{}', 'failed', '2026-01-01T00:00:00Z', NULL),
          ('d-run', 'a1', 't0', 't3', 'fast', 'task', 'Still running', 'b', '{}', 'running', '2026-01-01T00:00:00Z', NULL);
      `);

      applyScuttleMigrations(db);

      const rows = db
        .query<{ readonly id: string; readonly parent_notified_at: string | null }, []>(
          "SELECT id, parent_notified_at FROM agent_delegations ORDER BY id ASC",
        )
        .all();
      expect(rows).toEqual([
        { id: "d-done", parent_notified_at: "2026-01-01T01:00:00Z" },
        { id: "d-fail", parent_notified_at: "2026-01-01T00:00:00Z" },
        { id: "d-run", parent_notified_at: null },
      ]);

      db.run(`
        INSERT INTO agent_delegations (id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, created_at, completed_at, parent_notified_at)
        VALUES ('d-new', 'a1', 't0', 't4', 'fast', 'task', 'New settled', 'b', '{}', 'completed', '2026-02-01T00:00:00Z', '2026-02-01T01:00:00Z', NULL);
      `);
      applyScuttleMigrations(db);
      const afterSecondMigration = db
        .query<{ readonly parent_notified_at: string | null }, []>(
          "SELECT parent_notified_at FROM agent_delegations WHERE id = 'd-new'",
        )
        .get();
      expect(afterSecondMigration?.parent_notified_at).toBeNull();
    } finally {
      db.close();
    }
  });
});

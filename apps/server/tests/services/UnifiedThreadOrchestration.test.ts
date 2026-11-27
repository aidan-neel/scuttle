import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  Agent,
  AgentDelegation,
  AgentDelegationQuestion,
  DelegationLink,
  type ServerPushEvent,
  ThreadDetail,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";
import { claudeAdapter } from "../../src/providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../../src/providers/types.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import { makeAppLayer, startScuttleServer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as ModelTierService from "../../src/services/ModelTierService.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import * as ThreadService from "../../src/services/ThreadService.ts";
import {
  ensureDelegationSchema,
  insertDelegation,
  listDelegationsByParentThread,
  listUnnotifiedSettledDelegationsByParentThread,
  readDelegationByChildThreadId,
} from "../../src/services/agent/agentWorkStore.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-unified-orch-"));
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

const jsonReq = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined
    ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {}),
});

describe("Unified thread orchestration", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      NodeFS.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("migrates legacy NOT NULL agent_id delegation tables cleanly while preserving rows", () => {
    const db = new Database(":memory:");
    try {
      db.run("PRAGMA foreign_keys = ON;");
      applyScuttleMigrations(db);
      const now = "2026-11-26T00:00:00Z";
      db.prepare(
        "INSERT INTO projects (id, name, path, is_git_repo, default_branch, created_at, updated_at) VALUES ('p1', 'p1', '/tmp/p1', 0, 'main', ?, ?)",
      ).run(now, now);
      db.prepare(
        "INSERT INTO threads (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, created_at, updated_at) VALUES (?, 'p1', 'p1', 't', 'local', 'main', '/tmp/p1', 'claude', 'claude', 'claude-opus-5-5', '{\"kind\":\"idle\"}', ?, ?)",
      ).run("t-parent", now, now);
      db.prepare(
        "INSERT INTO threads (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, created_at, updated_at) VALUES (?, 'p1', 'p1', 'c', 'local', 'main', '/tmp/p1', 'claude', 'claude', 'claude-opus-5-5', '{\"kind\":\"idle\"}', ?, ?)",
      ).run("t-child", now, now);
      db.prepare(
        'INSERT INTO agents (id, project_id, name, primary_thread_id, model_selection_json, created_at, updated_at) VALUES (\'a1\', \'p1\', \'Agent\', \'t-parent\', \'{"providerId":"claude","providerKind":"claude","model":"claude-opus-5-5"}\', ?, ?)',
      ).run(now, now);
      db.prepare(
        "INSERT INTO agent_delegations (id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, created_at) VALUES ('d1', 'a1', 't-parent', 't-child', 'workhorse', 'task', 'Legacy', 'Keep me', '{\"providerId\":\"claude\",\"providerKind\":\"claude\",\"model\":\"claude-opus-5-5\"}', 'completed', ?)",
      ).run(now);
      db.prepare(
        "INSERT INTO agent_delegation_questions (id, delegation_id, agent_id, child_thread_id, parent_thread_id, kind, question, status, bounce_number, created_at) VALUES ('q1', 'd1', 'a1', 't-child', 't-parent', 'other', 'Legacy q', 'answered', 1, ?)",
      ).run(now);

      ensureDelegationSchema(db);
      ensureDelegationSchema(db);

      const cols = db
        .query<{ readonly name: string; readonly notnull: number }, []>(
          "PRAGMA table_info(agent_delegations)",
        )
        .all();
      expect(cols.find((c) => c.name === "agent_id")?.notnull).toBe(0);
      expect(listDelegationsByParentThread(db, "t-parent").map((d) => String(d.id))).toEqual([
        "d1",
      ]);

      insertDelegation(db, {
        id: "d2" as AgentDelegation["id"],
        parentThreadId: "t-parent" as AgentDelegation["parentThreadId"],
        childThreadId: "t-child" as AgentDelegation["childThreadId"],
        role: "fast",
        kind: "task",
        title: "Thread-owned",
        brief: "No agent",
        modelSelection: {
          providerId: ProviderId.make("claude"),
          providerKind: "claude",
          model: "claude-opus-5-5",
        },
        status: "running",
        bounceCount: 0,
        maxBounces: 3,
        createdAt: "2026-11-26T00:00:01Z",
      });
      expect(String(readDelegationByChildThreadId(db, "t-child")?.id)).toBe("d2");
    } finally {
      db.close();
    }
  });

  it("lets a regular thread delegate, handles askParent bounce-back, injects <scuttle_thread_delta>, and preserves agent delegations", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const recordedTurns: HarnessTurnInput[] = [];
    let sessionSeq = 0;
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        recordedTurns.push(input);
        if (
          input.prompt.includes("You are a delegated") &&
          input.prompt.includes("Ask regular parent")
        ) {
          const apiUrl = input.extraEnv!.SCUTTLE_API_URL!;
          const delegationId = input.extraEnv!.SCUTTLE_DELEGATION_ID!;
          expect(input.extraEnv?.SCUTTLE_AGENT_ID).toBeUndefined();
          expect(input.prompt).toContain(
            "POST $SCUTTLE_API_URL/api/delegations/$SCUTTLE_DELEGATION_ID/ask",
          );
          expect(input.prompt).toContain("scuttle_delegate_task");

          const askRes = await fetch(`${apiUrl}/api/delegations/${delegationId}/ask`, {
            ...jsonReq("POST", {
              kind: "missing_context",
              question: "Which env key should regular child use?",
              attempted: "Checked README.md",
            }),
          });
          expect(askRes.status).toBe(200);
          const q = Schema.decodeUnknownSync(AgentDelegationQuestion)(await askRes.json());
          expect(q.status).toBe("answered");
          expect(q.answer).toBe("Use PORT_REGULAR.");
          return { finalText: `Thread child done with ${q.answer}` };
        }
        if (input.prompt.includes("Worker question from")) {
          await Bun.sleep(15);
          return { finalText: "Use PORT_REGULAR." };
        }
        if (input.prompt.includes("You are a delegated")) {
          return { finalText: "Agent child finished." };
        }
        const sid = input.providerSessionId ?? `reg-sess-${++sessionSeq}`;
        if (!input.providerSessionId) {
          input.emit({ kind: "session", providerSessionId: sid });
        }
        return { finalText: "Parent acknowledged.", providerSessionId: sid };
      },
    );

    const server = await startScuttleServer({ port: 0, dbPath: ":memory:" });
    try {
      const projRes = await fetch(
        `${server.url}/api/projects`,
        jsonReq("POST", { path: repo, name: "unified" }),
      );
      expect(projRes.status).toBe(201);
      const proj = (await projRes.json()) as { id: string };

      await fetch(
        `${server.url}/api/model-tiers`,
        jsonReq("PUT", {
          scope: { kind: "project", projectId: proj.id },
          config: {
            small: {
              providerId: "claude",
              providerKind: "claude",
              model: "claude-sonnet-5-5",
              effort: "medium",
            },
          },
        }),
      );

      const threadRes = await fetch(
        `${server.url}/api/threads`,
        jsonReq("POST", {
          projectId: proj.id,
          prompt: "Start regular parent thread",
          title: "Regular Parent",
          runtime: "local",
          branch: "main",
          modelSelection: {
            providerId: "claude",
            providerKind: "claude",
            model: "claude-opus-5-5",
            effort: "high",
          },
        }),
      );
      expect(threadRes.status).toBe(201);
      const parentThread = Schema.decodeUnknownSync(ThreadDetail)(await threadRes.json()).thread;

      await waitUntil(async () => {
        const res = await fetch(`${server.url}/api/threads/${parentThread.id}`);
        const detail = Schema.decodeUnknownSync(ThreadDetail)(await res.json());
        return detail.thread.status.kind === "idle";
      });

      const delRes = await fetch(
        `${server.url}/api/threads/${parentThread.id}/delegations`,
        jsonReq("POST", {
          role: "small",
          kind: "task",
          title: "Ask regular parent",
          brief: "Ask parent thread for PORT key",
          runtime: "local",
          maxBounces: 2,
        }),
      );
      expect(delRes.status).toBe(201);
      const delegation = Schema.decodeUnknownSync(AgentDelegation)(await delRes.json());
      expect(delegation.agentId).toBeUndefined();
      expect(delegation.parentThreadId).toBe(parentThread.id);
      expect(delegation.modelSelection.model).toBe("claude-sonnet-5-5");

      await waitUntil(async () => {
        const res = await fetch(`${server.url}/api/delegations/${delegation.id}`);
        const current = Schema.decodeUnknownSync(AgentDelegation)(await res.json());
        return current.status === "completed";
      });

      const listRes = await fetch(`${server.url}/api/threads/${parentThread.id}/delegations`);
      const threadDels = Schema.decodeUnknownSync(Schema.Array(AgentDelegation))(
        await listRes.json(),
      );
      expect(threadDels.map((d) => d.id)).toEqual([delegation.id]);

      const linksRes = await fetch(`${server.url}/api/delegations`);
      const links = Schema.decodeUnknownSync(Schema.Array(DelegationLink))(await linksRes.json());
      expect(
        links.some((l) => l.delegationId === delegation.id && l.parentThreadId === parentThread.id),
      ).toBe(true);

      const qRes = await fetch(`${server.url}/api/delegations/${delegation.id}/questions`);
      const questions = Schema.decodeUnknownSync(Schema.Array(AgentDelegationQuestion))(
        await qRes.json(),
      );
      expect(questions).toHaveLength(1);
      expect(questions[0]?.agentId).toBeUndefined();
      expect(questions[0]?.answer).toBe("Use PORT_REGULAR.");

      const followUpRes = await fetch(
        `${server.url}/api/threads/${parentThread.id}/turns`,
        jsonReq("POST", { prompt: "Summarize child result" }),
      );
      expect(followUpRes.status).toBe(201);
      await waitUntil(() =>
        recordedTurns.some(
          (t) =>
            t.prompt.includes("Summarize child result") &&
            t.prompt.includes("<scuttle_thread_delta"),
        ),
      );
      const deltaTurn = recordedTurns.find((t) => t.prompt.includes("Summarize child result"))!;
      expect(deltaTurn.prompt).toContain("Ask regular parent");
      expect(deltaTurn.prompt).toContain("Thread child done with Use PORT_REGULAR.");

      await waitUntil(async () => {
        const res = await fetch(`${server.url}/api/delegations/${delegation.id}`);
        const d = Schema.decodeUnknownSync(AgentDelegation)(await res.json());
        return d.parentNotifiedAt !== undefined;
      });

      const cleanFollowUp = await fetch(
        `${server.url}/api/threads/${parentThread.id}/turns`,
        jsonReq("POST", { prompt: "Clean follow-up turn" }),
      );
      expect(cleanFollowUp.status).toBe(201);
      await waitUntil(() => recordedTurns.some((t) => t.prompt.includes("Clean follow-up turn")));
      const cleanTurn = recordedTurns.find((t) => t.prompt.includes("Clean follow-up turn"))!;
      expect(cleanTurn.prompt).not.toContain("<scuttle_thread_delta");

      const agentsRes = await fetch(`${server.url}/api/agents`);
      const agents = Schema.decodeUnknownSync(Schema.Array(Agent))(await agentsRes.json());
      const projectAgent = agents.find((a) => a.projectId === proj.id)!;
      const agentDelRes = await fetch(
        `${server.url}/api/agents/${projectAgent.id}/delegations`,
        jsonReq("POST", {
          role: "fast",
          kind: "task",
          title: "Persistent agent worker",
          brief: "Verify agent delegation still works",
          runtime: "local",
        }),
      );
      expect(agentDelRes.status).toBe(201);
      const agentDel = Schema.decodeUnknownSync(AgentDelegation)(await agentDelRes.json());
      expect(agentDel.agentId).toBe(projectAgent.id);

      await waitUntil(async () => {
        const res = await fetch(`${server.url}/api/delegations/${agentDel.id}`);
        return Schema.decodeUnknownSync(AgentDelegation)(await res.json()).status === "completed";
      });
    } finally {
      runSpy.mockRestore();
      await server.stop();
    }
  });

  it("supports service-level thread delegation, cancelDelegationById, and model tier resolution", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        if (input.prompt.includes("Cancelable thread worker")) {
          await Bun.sleep(400);
          if (input.signal.aborted) return { interrupted: true };
        }
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
          const threads = yield* ThreadService.ThreadService;
          const agents = yield* AgentService.AgentService;
          const tiers = yield* ModelTierService.ModelTierService;

          const proj = yield* projects.create({ path: repo, name: "svc-orch" });
          yield* tiers.setScope(
            { kind: "global" },
            {
              nano: {
                providerId: ProviderId.make("claude"),
                providerKind: "claude",
                model: "claude-haiku-4-5",
              },
            },
          );
          const parent = yield* threads.createIdle({
            projectId: proj.id,
            title: "Direct Thread",
            runtime: "local",
            branch: "main",
            modelSelection: {
              providerId: ProviderId.make("claude"),
              providerKind: "claude",
              model: "claude-opus-5-5",
            },
          });

          const del = yield* agents.delegateFromThread(parent.id, {
            role: "nano",
            title: "Cancelable thread worker",
            brief: "Long task",
            runtime: "local",
          });
          expect(del.modelSelection.model).toBe("claude-haiku-4-5");
          expect(del.agentId).toBeUndefined();

          const canceled = yield* agents.cancelDelegationById(del.id);
          expect(canceled.status).toBe("canceled");
          expect(
            listUnnotifiedSettledDelegationsByParentThread(db, parent.id).map((d) => d.id),
          ).toContain(del.id);
          unsub();
        }),
      );
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });
});

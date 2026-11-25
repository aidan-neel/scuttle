import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDetail,
  AgentIssue,
  AgentMemory,
  type ServerPushEvent,
  ThreadTurn,
  WorkspaceSnapshot,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { handleApiRequest } from "../httpRoutes.ts";
import { claudeAdapter } from "../providers/claudeAdapter.ts";
import type { HarnessTurnInput, HarnessTurnResult } from "../providers/types.ts";
import { makeAppLayer, startScuttleServer } from "../server.ts";
import * as AgentService from "./AgentService.ts";
import * as EventBus from "./EventBus.ts";
import type { GitForgeOptions } from "./GitForgeService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ThreadService from "./ThreadService.ts";

const gitSync = (cwd: string, ...args: string[]) => {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
};

const makeTempGitRepo = (rootDir: string, name: string, withCommit = true): string => {
  const repo = NodePath.join(rootDir, name);
  NodeFS.mkdirSync(repo, { recursive: true });
  gitSync(repo, "init", "-q", "-b", "main");
  gitSync(repo, "config", "user.email", "agent@example.com");
  gitSync(repo, "config", "user.name", "Agent");
  if (withCommit) {
    NodeFS.writeFileSync(NodePath.join(repo, "README.md"), `# ${name}\n`);
    gitSync(repo, "add", ".");
    gitSync(repo, "commit", "-qm", "init");
    gitSync(repo, "remote", "add", "origin", `https://github.com/acme/${name}.git`);
  }
  return repo;
};

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for condition.");
};

describe("AgentService", () => {
  let tempDir = "";
  let repoWithCommit = "";
  let emptyRepo = "";

  beforeAll(() => {
    tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-agent-test-"));
    repoWithCommit = makeTempGitRepo(tempDir, "widgets", true);
    emptyRepo = makeTempGitRepo(tempDir, "empty-repo", false);
  });

  afterAll(() => {
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  });

  it("auto-seeds a named Agent per project with empty purpose, updates modelStack/instructions, and searches memories with FTS5", async () => {
    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const proj = yield* projects.create({ path: repoWithCommit, name: "widgets" });
          const seeded = yield* agents.list();
          const agent = seeded.find((a) => a.projectId === proj.id);
          expect(agent).toBeDefined();
          expect(agent!.name).toBe("Widgets");
          expect(agent!.purpose).toBe("");
          expect(agent!.instructionsMd).toContain("# Widgets");

          const detail = yield* agents.getDetail(agent!.id);
          expect(detail.primaryThread.thread.id).toBe(agent!.primaryThreadId);
          expect(detail.primaryThread.thread.status.kind).toBe("idle");
          expect(detail.primaryThread.turns).toHaveLength(0);

          const workhorseModel = {
            providerId: ProviderId.make("claude"),
            providerKind: "claude" as const,
            model: "claude-sonnet-5-5",
            effort: "medium" as const,
          };
          const updated = yield* agents.update(agent!.id, {
            name: "Widgets Lead",
            purpose: "Own the widgets repository",
            instructionsMd: "# Custom Skill\nAlways run bun test.",
            modelStack: {
              agent: agent!.modelSelection,
              workhorse: workhorseModel,
            },
            checkInIntervalMinutes: 30,
            pinned: true,
          });
          expect(updated.name).toBe("Widgets Lead");
          expect(updated.purpose).toBe("Own the widgets repository");
          expect(updated.modelStack.workhorse?.model).toBe("claude-sonnet-5-5");
          expect(updated.checkInIntervalMinutes).toBe(30);
          expect(updated.pinned).toBe(true);

          const m1 = yield* agents.createMemory(agent!.id, {
            category: "convention",
            title: "SQLite WAL mode",
            content: "Always open SQLite in WAL mode with foreign_keys ON.",
            pinned: true,
          });
          const m2 = yield* agents.createMemory(agent!.id, {
            category: "decision",
            title: "Router choice",
            content: "Use TanStack Router in apps/web.",
            pinned: false,
          });
          const m3 = yield* agents.createMemory(agent!.id, {
            category: "fact",
            title: "Verify command",
            content: "Run bun run check before commit.",
            pinned: false,
          });

          const ftsMatches = yield* agents.searchMemories(agent!.id, "SQLite WAL");
          expect(ftsMatches[0]?.id).toBe(m1.id);

          // Special characters must fall back safely without throwing an FTS5 syntax error.
          const specialMatches = yield* agents.searchMemories(agent!.id, "apps/web @foo:bar*");
          expect(specialMatches.some((m) => m.id === m2.id)).toBe(true);

          const updatedMem = yield* agents.updateMemory(agent!.id, m3.id, { pinned: true });
          expect(updatedMem.pinned).toBe(true);
          yield* agents.deleteMemory(agent!.id, m2.id);
          const remaining = yield* agents.listMemories(agent!.id);
          expect(remaining.map((m) => m.id)).not.toContain(m2.id);

          const ctx = yield* agents.buildAgentContext(agent!.id, "SQLite");
          expect(ctx).toContain("<scuttle_agent_context>");
          expect(ctx).toContain("Always run bun test.");
          expect(ctx).toContain("workhorse: claude/claude-sonnet-5-5");
          expect(ctx).toContain("SQLite WAL mode");
          expect(ctx).toContain(`/api/agents/${agent!.id}/memories`);

          return { updated };
        }),
      );
      expect(result.updated.instructionsMd).toContain("Always run bun test.");
    } finally {
      await runtime.dispose();
    }
  });

  it("delegates PR work, falls back to local on commitless repos, runs completion hook, and syncs forge issues", async () => {
    const forgeState = {
      requests: [] as string[],
    };
    const forgeOptions: GitForgeOptions = {
      githubOAuthClientId: null,
      now: () => Date.now(),
      runner: () =>
        Effect.succeed({ exitCode: 1, stdout: "", stderr: "not installed", timedOut: false }),
      fetch: async (input) => {
        forgeState.requests.push(input);
        if (input.includes("/repos/acme/widgets/issues")) {
          return Response.json([
            {
              number: 17,
              title: "Fix flaky sync",
              body: "Reproduce and stabilize sync.",
              html_url: "https://github.com/acme/widgets/issues/17",
              labels: [{ name: "bug" }],
            },
            {
              number: 18,
              title: "PR disguised as issue",
              body: "Should be skipped",
              html_url: "https://github.com/acme/widgets/pull/18",
              labels: [],
              pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/18" },
            },
          ]);
        }
        if (input.includes("/repos/acme/widgets/pulls")) {
          return Response.json([
            {
              number: 42,
              title: "Fix flaky sync",
              html_url: "https://github.com/acme/widgets/pull/42",
              state: "open",
              draft: false,
              merged_at: null,
              user: { login: "octo" },
              head: { ref: "fix/sync" },
              base: { ref: "main" },
              updated_at: "2026-11-25T00:00:00Z",
            },
          ]);
        }
        if (input === "https://api.github.com/user") {
          return Response.json({ login: "octo" });
        }
        return Response.json({}, { status: 404 });
      },
    };

    const recordedTurns: HarnessTurnInput[] = [];
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(
      async (input: HarnessTurnInput): Promise<HarnessTurnResult> => {
        recordedTurns.push(input);
        await Bun.sleep(15);
        return {
          finalText: "Implemented fix, tests pass. Opened https://github.com/acme/widgets/pull/42",
          costUsd: 1.25,
        };
      },
    );

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }, forgeOptions));
    const events: ServerPushEvent[] = [];

    try {
      const outcome = await runtime.runPromise(
        Effect.gen(function* () {
          const eventBus = yield* EventBus.EventBus;
          const unsub = eventBus.subscribe((event) => events.push(event));
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const threads = yield* ThreadService.ThreadService;

          // Seed forge token via HTTP handler so syncIssues & checkIn PR count work offline.
          const tokenReq = new Request("http://127.0.0.1/api/git/forges/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              forge: "github",
              token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            }),
          });
          const tokenRes = yield* handleApiRequest(tokenReq, new URL(tokenReq.url));
          expect(tokenRes?.status).toBe(200);

          const proj = yield* projects.create({ path: repoWithCommit, name: "widgets" });
          const emptyProj = yield* projects.create({ path: emptyRepo, name: "empty-repo" });
          const allAgents = yield* agents.list();
          const primaryAgent = allAgents.find((a) => a.projectId === proj.id)!;
          const emptyAgent = allAgents.find((a) => a.projectId === emptyProj.id)!;

          // Verify worktree fallback to local on commitless repo.
          const localFallbackDelegation = yield* agents.delegateTask(emptyAgent.id, {
            role: "fast",
            kind: "task",
            title: "Bootstrap empty repo",
            brief: "Check initial files",
            runtime: "worktree",
          });
          const fallbackThread = yield* threads.getDetail(localFallbackDelegation.childThreadId);
          expect(fallbackThread.thread.runtime).toBe("local");

          // Sync forge issues (skips PR #18, keeps issue #17).
          const synced = yield* agents.syncIssues(primaryAgent.id);
          expect(synced).toHaveLength(1);
          expect(synced[0]!.key).toBe("GH-17");
          expect(synced[0]!.labels).toEqual(["bug"]);

          // Create local issue with auto-generated key.
          const localIssue = yield* agents.createIssue(primaryAgent.id, {
            title: "Add telemetry check",
            description: "Verify check-in counters",
          });
          expect(localIssue.key).toBe("WIDG-1");

          // Assign synced issue to E2E PR worker.
          const assigned = yield* agents.assignIssue(primaryAgent.id, synced[0]!.id, {
            mode: "pr",
            role: "workhorse",
          });
          expect(assigned.mode).toBe("pr");
          if (assigned.mode !== "pr") throw new Error("unexpected mode");
          expect(assigned.issue.state).toBe("in_progress");
          expect(assigned.issue.assignedThreadId).toBe(assigned.delegation.childThreadId);
          expect(assigned.delegation.status).toBe("running");

          // Wait for turnRunner + EventBus completion hook to settle the delegation.
          yield* Effect.promise(() =>
            waitUntil(() =>
              events.some(
                (e) =>
                  e.kind === "agent.delegation.upserted" &&
                  e.delegation.id === assigned.delegation.id &&
                  e.delegation.status === "completed",
              ),
            ),
          );

          const detailAfter = yield* agents.getDetail(primaryAgent.id);
          const delegatedThread = yield* threads.getDetail(assigned.delegation.childThreadId);
          expect(delegatedThread.thread.costUsd).toBe(1.25);
          expect(delegatedThread.turns[0]?.costUsd).toBe(1.25);
          const settledDelegation = detailAfter.delegations.find(
            (d) => d.id === assigned.delegation.id,
          );
          const settledIssue = detailAfter.issues.find((i) => i.id === synced[0]!.id);
          expect(settledDelegation?.status).toBe("completed");
          expect(settledDelegation?.prUrl).toBe("https://github.com/acme/widgets/pull/42");
          expect(settledIssue?.state).toBe("in_review");
          expect(settledIssue?.prNumber).toBe(42);
          expect(detailAfter.agent.needsAttention).toBe(true);
          expect(detailAfter.agent.lastSummary).toContain("GH-17");

          const checkIn = yield* agents.runCheckIn(primaryAgent.id, { focus: "PR readiness" });
          expect(checkIn.openPrs).toBe(1);
          expect(checkIn.openIssues).toBe(2);
          expect(checkIn.summary).toContain("PR readiness");

          // Verify Agent turn receives <scuttle_agent_context> + SCUTTLE_API_URL / SCUTTLE_AGENT_ID.
          const agentTurn = yield* agents.sendTurn(primaryAgent.id, {
            prompt: "Summarize open issues",
          });
          expect(agentTurn.userMessage).toBe("Summarize open issues");

          // Clean up worktree created for assigned.delegation.childThreadId.
          yield* threads.remove(assigned.delegation.childThreadId);
          unsub();
          return { agentId: primaryAgent.id };
        }),
      );

      const agentCall = recordedTurns.find(
        (t) =>
          t.extraEnv?.SCUTTLE_AGENT_ID === outcome.agentId &&
          t.prompt.includes("<scuttle_agent_context>"),
      );
      expect(agentCall).toBeDefined();
      expect(agentCall!.extraEnv?.SCUTTLE_API_URL).toContain("http://");
      expect(agentCall!.prompt).toContain("Summarize open issues");
    } finally {
      runSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("serves all Agent HTTP endpoints cleanly", async () => {
    const runSpy = spyOn(claudeAdapter, "runTurn").mockImplementation(async (input) => {
      const waitMs = input.prompt.includes("Quick check") ? 400 : 30;
      await Bun.sleep(waitMs);
      if (input.signal.aborted) return { interrupted: true };
      return { finalText: "Setup complete." };
    });

    const server = await startScuttleServer({ port: 0, dbPath: ":memory:" });
    const req = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${server.url}${path}`, {
        method,
        ...(body !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const text = await res.text();
      const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
      return { status: res.status, raw: parsed };
    };

    try {
      const wsRes = await req("GET", "/api/workspace");
      expect(wsRes.status).toBe(200);
      const ws = Schema.decodeUnknownSync(WorkspaceSnapshot)(wsRes.raw);
      expect(ws.agents.length).toBeGreaterThanOrEqual(1);

      const createdRes = await req("POST", "/api/agents", {
        path: repoWithCommit,
        name: "Atlas",
        startOnboarding: true,
      });
      expect(createdRes.status).toBe(201);
      const created = Schema.decodeUnknownSync(Agent)(createdRes.raw);
      expect(created.name).toBe("Atlas");
      expect(created.purpose).toBe("");

      const detailRes = await req("GET", `/api/agents/${created.id}`);
      expect(detailRes.status).toBe(200);
      const createdDetail = Schema.decodeUnknownSync(AgentDetail)(detailRes.raw);
      expect(createdDetail.agent.id).toBe(created.id);
      expect(createdDetail.primaryThread.turns).toHaveLength(1);
      expect(createdDetail.primaryThread.turns[0]?.origin).toBe("system");

      // Wait for onboarding turn to settle before running a second setup turn below.
      await waitUntil(async () => {
        const res = await req("GET", `/api/agents/${created.id}`);
        const detail = Schema.decodeUnknownSync(AgentDetail)(res.raw);
        return detail.primaryThread.thread.status.kind === "idle";
      });

      const patchedRes = await req("PATCH", `/api/agents/${created.id}`, {
        instructionsMd: "# HTTP Skill\nVerify all endpoints.",
      });
      expect(patchedRes.status).toBe(200);
      expect(Schema.decodeUnknownSync(Agent)(patchedRes.raw).instructionsMd).toContain(
        "HTTP Skill",
      );

      const memRes = await req("POST", `/api/agents/${created.id}/memories`, {
        category: "fact",
        title: "API port",
        content: "Runs on ephemeral port in tests",
        pinned: true,
      });
      expect(memRes.status).toBe(201);
      const mem = Schema.decodeUnknownSync(AgentMemory)(memRes.raw);
      const memSearchRes = await req("GET", `/api/agents/${created.id}/memories?q=ephemeral`);
      const memSearch = Schema.decodeUnknownSync(Schema.Array(AgentMemory))(memSearchRes.raw);
      expect(memSearch.map((m) => m.id)).toContain(mem.id);

      const issueRes = await req("POST", `/api/agents/${created.id}/issues`, {
        title: "Verify HTTP routes",
        labels: ["api"],
      });
      expect(issueRes.status).toBe(201);
      const issue = Schema.decodeUnknownSync(AgentIssue)(issueRes.raw);
      const updatedIssueRes = await req("PATCH", `/api/agents/${created.id}/issues/${issue.id}`, {
        state: "in_progress",
      });
      expect(Schema.decodeUnknownSync(AgentIssue)(updatedIssueRes.raw).state).toBe("in_progress");

      const delegationRes = await req("POST", `/api/agents/${created.id}/delegations`, {
        role: "fast",
        kind: "task",
        title: "Quick check",
        brief: "Inspect status",
        runtime: "local",
      });
      expect(delegationRes.status).toBe(201);
      const delegation = Schema.decodeUnknownSync(AgentDelegation)(delegationRes.raw);
      const canceledRes = await req(
        "POST",
        `/api/agents/${created.id}/delegations/${delegation.id}/cancel`,
      );
      expect(canceledRes.status).toBe(200);
      expect(Schema.decodeUnknownSync(AgentDelegation)(canceledRes.raw).status).toBe("canceled");

      const checkInRes = await req("POST", `/api/agents/${created.id}/checkins`, {
        focus: "API health",
      });
      expect(checkInRes.status).toBe(201);
      expect(Schema.decodeUnknownSync(AgentCheckIn)(checkInRes.raw).agentId).toBe(created.id);

      const setupTurnRes = await req("POST", `/api/agents/${created.id}/setup/start`, {
        instructions: "Focus on tests",
      });
      expect(setupTurnRes.status).toBe(201);
      const setupTurn = Schema.decodeUnknownSync(ThreadTurn)(setupTurnRes.raw);
      expect(setupTurn.origin).toBe("system");
      expect(setupTurn.userMessage).toContain("Focus on tests");

      expect((await req("DELETE", `/api/agents/${created.id}/issues/${issue.id}`)).status).toBe(
        204,
      );
      expect((await req("DELETE", `/api/agents/${created.id}/memories/${mem.id}`)).status).toBe(
        204,
      );
      expect((await req("DELETE", `/api/agents/${created.id}`)).status).toBe(204);
      expect((await req("GET", `/api/agents/${created.id}`)).status).toBe(404);
    } finally {
      runSpy.mockRestore();
      await server.stop();
    }
  });
});

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { Agent, AgentCheckIn, ServerPushEvent } from "@scuttle/contracts";
import { AgentCheckInId, AgentId, ProjectId, ProviderId, ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { makeAppLayer } from "../../src/server.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as EventBus from "../../src/services/EventBus.ts";
import * as GitForgeService from "../../src/services/GitForgeService.ts";
import * as GitService from "../../src/services/GitService.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import {
  forkCheckInScheduler,
  runDueCheckIns,
} from "../../src/services/agent/agentCheckInScheduler.ts";

const makeGitRepo = (): { root: string; repo: string } => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-checkin-test-"));
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

describe("check-in concurrency, profile preservation, and scheduler resilience", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves concurrent profile edits during check-in and rejects overlapping check-ins", async () => {
    const { root, repo } = makeGitRepo();
    tempRoots.push(root);

    let releaseGitStatus!: () => void;
    const gitStatusGate = new Promise<void>((resolve) => {
      releaseGitStatus = resolve;
    });
    let markGitStatusEntered!: () => void;
    const gitStatusEntered = new Promise<void>((resolve) => {
      markGitStatusEntered = resolve;
    });

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    const events: ServerPushEvent[] = [];

    try {
      const setup = await runtime.runPromise(
        Effect.gen(function* () {
          const eventBus = yield* EventBus.EventBus;
          const unsub = eventBus.subscribe((e) => events.push(e));
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;
          const git = yield* GitService.GitService;
          const gitForge = yield* GitForgeService.GitForgeService;

          const proj = yield* projects.create({ path: repo, name: "checkin-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          const gitSpy = spyOn(git, "status").mockImplementation(() =>
            Effect.promise(async () => {
              markGitStatusEntered();
              await gitStatusGate;
              return {
                kind: "repo",
                branch: "main",
                upstream: null,
                ahead: 0,
                behind: 0,
                hasCommits: true,
                remote: null,
                forge: "none",
                files: [],
                summary: {
                  changed: 0,
                  staged: 0,
                  untracked: 0,
                  conflicted: 0,
                  additions: 0,
                  deletions: 0,
                },
              };
            }),
          );
          const forgeSpy = spyOn(gitForge, "listPullRequests").mockImplementation(() =>
            Effect.succeed({ forge: "github", authSource: "none", items: [] }),
          );

          return { unsub, agent, gitSpy, forgeSpy };
        }),
      );

      try {
        const firstCheckInPromise = runtime.runPromise(
          Effect.gen(function* () {
            const agents = yield* AgentService.AgentService;
            return yield* agents.runCheckIn(setup.agent.id);
          }),
        );

        await gitStatusEntered;

        await runtime.runPromise(
          Effect.gen(function* () {
            const agents = yield* AgentService.AgentService;
            const overlappingErr = yield* agents.runCheckIn(setup.agent.id).pipe(Effect.flip);
            expect(overlappingErr.reason).toBe("rejected");

            yield* agents.update(setup.agent.id, {
              name: "Renamed Captain",
              purpose: "Keep concurrent edits safe",
              checkInIntervalMinutes: 15,
              instructionsMd: "Updated instructions during check-in",
            });
          }),
        );

        releaseGitStatus();
        const checkIn = await firstCheckInPromise;
        expect(checkIn.agentId).toBe(setup.agent.id);

        await runtime.runPromise(
          Effect.gen(function* () {
            const agents = yield* AgentService.AgentService;
            const detail = yield* agents.getDetail(setup.agent.id);
            expect(detail.agent.name).toBe("Renamed Captain");
            expect(detail.agent.purpose).toBe("Keep concurrent edits safe");
            expect(detail.agent.checkInIntervalMinutes).toBe(15);
            expect(detail.agent.instructionsMd).toBe("Updated instructions during check-in");
            expect(detail.agent.lastCheckInAt).toBe(checkIn.createdAt);
            expect(detail.checkIns).toHaveLength(1);
          }),
        );

        const lastUpserted = [...events]
          .reverse()
          .find((e) => e.kind === "agent.upserted" && e.agent.id === setup.agent.id);
        expect(lastUpserted?.kind === "agent.upserted" ? lastUpserted.agent.purpose : "").toBe(
          "Keep concurrent edits safe",
        );
      } finally {
        setup.gitSpy.mockRestore();
        setup.forgeSpy.mockRestore();
        setup.unsub();
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("isolates defects per due agent and fires check-in scheduler at 1x interval", async () => {
    const baseAgent: Agent = {
      id: AgentId.make("a-1"),
      projectId: ProjectId.make("p-1"),
      projectName: "r",
      projectPath: "/tmp/r",
      name: "A1",
      purpose: "",
      primaryThreadId: ThreadId.make("t-1"),
      runtime: "local",
      modelSelection: {
        providerId: ProviderId.make("claude"),
        providerKind: "claude",
        model: "claude-opus-5-5",
      },
      modelStack: {},
      instructionsMd: "",
      checkInIntervalMinutes: 5,
      pinned: false,
      needsAttention: false,
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    };
    const a2: Agent = { ...baseAgent, id: AgentId.make("a-2"), name: "A2" };
    const ran: string[] = [];
    const count = await Effect.runPromise(
      runDueCheckIns({
        listAgents: () => [baseAgent, a2],
        runCheckIn: (id) => {
          if (id === "a-1") return Effect.die(new Error("boom defect"));
          ran.push(id);
          return Effect.succeed({
            id: AgentCheckInId.make("chk-a2"),
            agentId: id,
            summary: "ok",
            activeDelegations: 0,
            openPrs: 0,
            openIssues: 0,
            createdAt: "2026-11-25T00:00:00Z",
          } satisfies AgentCheckIn);
        },
      }),
    );
    expect(count).toBe(1);
    expect(ran).toEqual(["a-2"]);

    const ticks: number[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* forkCheckInScheduler({
            listAgents: () => [a2],
            interval: "35 millis",
            runCheckIn: (id) => {
              ticks.push(Date.now());
              if (ticks.length === 1) return Effect.die(new Error("transient defect"));
              return Effect.succeed({
                id: AgentCheckInId.make(`chk-${ticks.length}`),
                agentId: id,
                summary: "ok",
                activeDelegations: 0,
                openPrs: 0,
                openIssues: 0,
                createdAt: new Date().toISOString(),
              });
            },
          });
          yield* Effect.promise(() => waitUntil(() => ticks.length >= 3, 400));
        }),
      ),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[2]! - ticks[0]!).toBeLessThan(200);
  });
});

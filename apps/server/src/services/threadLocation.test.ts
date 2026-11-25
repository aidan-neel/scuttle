import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { Project, Thread } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { handleApiRequest } from "../httpRoutes.ts";
import { makeAppLayer } from "../server.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ThreadService from "./ThreadService.ts";

const runGitSync = (cwd: string, args: ReadonlyArray<string>) => {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
};

const makeTestRuntime = () => ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
type AppRuntime = ReturnType<typeof makeTestRuntime>;

describe("Thread runtime and branch switching", () => {
  let tmpDir: string;
  let repoDir: string;
  let appRuntime: AppRuntime;
  let project: Project;
  let createdWorktreePath: string | undefined;

  const callApi = async (path: string, init?: RequestInit) => {
    const req = new Request(`http://localhost${path}`, init);
    return appRuntime.runPromise(handleApiRequest(req, new URL(req.url)));
  };

  beforeAll(async () => {
    tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-thread-loc-"));
    repoDir = NodePath.join(tmpDir, "repo");
    NodeFS.mkdirSync(repoDir, { recursive: true });
    runGitSync(repoDir, ["init", "-b", "main"]);
    runGitSync(repoDir, ["config", "user.email", "test@scuttle.dev"]);
    runGitSync(repoDir, ["config", "user.name", "Scuttle Test"]);
    NodeFS.writeFileSync(NodePath.join(repoDir, "README.md"), "# Test\n");
    runGitSync(repoDir, ["add", "."]);
    runGitSync(repoDir, ["commit", "-m", "initial"]);
    runGitSync(repoDir, ["branch", "feature/ui"]);

    appRuntime = makeTestRuntime();
    project = await appRuntime.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService.ProjectService;
        return yield* projects.create({ path: repoDir, name: "loc-repo" });
      }),
    );
  });

  afterAll(async () => {
    if (createdWorktreePath) {
      try {
        runGitSync(repoDir, ["worktree", "remove", "--force", createdWorktreePath]);
      } catch {
        // worktree already removed
      }
    }
    await appRuntime.dispose();
    NodeFS.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("switches a thread between local and worktree and persists branch checkouts", async () => {
    const thread: Thread = await appRuntime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService.ThreadService;
        return yield* threads.createIdle({
          projectId: project.id,
          title: "Location Test",
          runtime: "local",
          branch: "main",
          modelSelection: {
            providerId: ProviderId.make("claude-default"),
            providerKind: "claude",
            model: "claude-sonnet-4-6",
          },
        });
      }),
    );

    const checkoutRes = await callApi(
      `/api/projects/${encodeURIComponent(project.id)}/git/checkout?threadId=${encodeURIComponent(thread.id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch: "feature/ui" }),
      },
    );
    expect(checkoutRes?.status).toBe(200);

    const afterCheckout = await appRuntime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService.ThreadService;
        return yield* threads.getDetail(thread.id);
      }),
    );
    expect(afterCheckout.thread.branch).toBe("feature/ui");

    const toWorktree = await appRuntime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService.ThreadService;
        return yield* threads.update(thread.id, { runtime: "worktree" });
      }),
    );
    createdWorktreePath = toWorktree.worktreePath;
    expect(toWorktree.runtime).toBe("worktree");
    expect(toWorktree.worktreePath).toBeTruthy();
    expect(toWorktree.cwd).toBe(toWorktree.worktreePath!);
    expect(toWorktree.branch).toStartWith("scuttle/");

    const backToLocal = await appRuntime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService.ThreadService;
        return yield* threads.update(thread.id, { runtime: "local" });
      }),
    );
    expect(backToLocal.runtime).toBe("local");
    expect(backToLocal.cwd).toBe(project.path);
    expect(backToLocal.branch).toBe("feature/ui");

    const reuseWorktree = await appRuntime.runPromise(
      Effect.gen(function* () {
        const threads = yield* ThreadService.ThreadService;
        return yield* threads.update(thread.id, { runtime: "worktree" });
      }),
    );
    expect(reuseWorktree.runtime).toBe("worktree");
    expect(reuseWorktree.worktreePath).toBe(toWorktree.worktreePath);
    expect(reuseWorktree.branch).toBe(toWorktree.branch);
  });
});

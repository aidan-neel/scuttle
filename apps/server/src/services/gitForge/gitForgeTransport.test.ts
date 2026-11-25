import { afterAll, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { handleApiRequest } from "../../httpRoutes.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import { makeAppLayer } from "../../server.ts";
import { runCommand } from "./processRunner.ts";
import {
  cliApiArgs,
  type ForgeTransport,
  listOpenPullRequests,
  openPullRequest,
} from "./pullRequests.ts";

const mergeRequest = (overrides: Record<string, unknown>) => ({
  iid: 12,
  title: "Draft: Add SSO",
  web_url: "https://gitlab.example.com/group/sub/app/-/merge_requests/12",
  state: "opened",
  draft: true,
  author: { username: "tanuki" },
  source_branch: "feature/sso",
  target_branch: "main",
  updated_at: "2026-11-25T00:00:00Z",
  ...overrides,
});

describe("GitLab merge requests over HTTP", () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const transport: ForgeTransport = {
    kind: "http",
    forge: "gitlab",
    host: "gitlab.example.com",
    token: "glpat-abcdefghijklmnopqrstuv",
    authSource: "token",
    fetch: async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return init?.method === "POST"
        ? Response.json(mergeRequest({}), { status: 201 })
        : Response.json([
            mergeRequest({}),
            mergeRequest({ iid: 3, state: "merged", draft: false }),
          ]);
    },
  };

  it("lists merge requests for a nested group with an encoded project path", async () => {
    const items = await Effect.runPromise(listOpenPullRequests(transport, "group/sub", "app"));
    expect(requests.at(-1)?.url).toBe(
      "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fapp/merge_requests?state=opened&per_page=30&order_by=updated_at",
    );
    expect(items.map((item) => [item.number, item.state, item.isDraft, item.author])).toEqual([
      [12, "open", true, "tanuki"],
      [3, "merged", false, "tanuki"],
    ]);
  });

  it("opens a draft merge request by prefixing the title", async () => {
    const created = await Effect.runPromise(
      openPullRequest(transport, "group/sub", "app", {
        title: "Add SSO",
        body: "Adds SAML.",
        head: "feature/sso",
        base: "main",
        draft: true,
      }),
    );
    expect(requests.at(-1)).toEqual({
      url: "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fapp/merge_requests",
      method: "POST",
      body: {
        title: "Draft: Add SSO",
        description: "Adds SAML.",
        source_branch: "feature/sso",
        target_branch: "main",
      },
    });
    expect(created).toMatchObject({ number: 12, headBranch: "feature/sso", baseBranch: "main" });
  });
});

describe("forge CLI arguments", () => {
  it("builds glab api calls against the remote host", () => {
    expect(
      cliApiArgs("gitlab", "gitlab.example.com", "POST", "projects/a%2Fb/merge_requests", {
        title: "Draft: x",
        source_branch: "feat",
      }),
    ).toEqual([
      "glab",
      "api",
      "--hostname",
      "gitlab.example.com",
      "-X",
      "POST",
      "projects/a%2Fb/merge_requests",
      "-f",
      "title=Draft: x",
      "-f",
      "source_branch=feat",
    ]);
  });

  it("sends gh booleans as typed fields and strings as raw fields", () => {
    expect(
      cliApiArgs("github", "github.com", "POST", "repos/a/b/pulls", {
        title: "@file",
        draft: true,
      }),
    ).toEqual([
      "gh",
      "api",
      "--hostname",
      "github.com",
      "-X",
      "POST",
      "repos/a/b/pulls",
      "-f",
      "title=@file",
      "-F",
      "draft=true",
    ]);
  });
});

describe("runCommand", () => {
  it("returns at the deadline even when a child process keeps the pipe open", async () => {
    const started = Date.now();
    const result = await Effect.runPromise(
      runCommand(["sh", "-c", "sleep 5; true"], { timeoutMs: 200 }),
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

describe("thread-scoped git targets", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-git-target-"));
  const runtime = ManagedRuntime.make(
    makeAppLayer(
      { dbPath: ":memory:" },
      {
        githubOAuthClientId: null,
        runner: () => Effect.succeed({ exitCode: 127, stdout: "", stderr: "", timedOut: false }),
        fetch: async () => Response.json({}, { status: 404 }),
        now: () => 0,
      },
    ),
  );
  afterAll(async () => {
    await runtime.dispose();
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  });

  const getJson = async (path: string, init?: RequestInit) => {
    const request = new Request(`http://scuttle.test${path}`, init);
    const response = await runtime.runPromise(handleApiRequest(request, new URL(request.url)));
    return { status: response?.status ?? 0, json: await response?.json() };
  };

  const insertThread = (id: string, projectId: string, cwd: string) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Sqlite.SqliteDatabase;
        const now = new Date().toISOString();
        db.query(
          `INSERT INTO threads (id, project_id, project_name, title, runtime, branch, worktree_path, cwd,
             provider_id, provider_kind, model, status_json, created_at, updated_at)
           VALUES (?, ?, 'repo', 'Worktree thread', 'worktree', 'feature/wt', ?, ?, 'claude', 'claude',
             'claude-opus-5-5', '{"kind":"idle"}', ?, ?)`,
        ).run(id, projectId, cwd, cwd, now, now);
      }),
    );

  it("reads status from the thread worktree and rejects threads from other projects", async () => {
    const repo = NodePath.join(tempDir, "repo");
    const worktree = NodePath.join(tempDir, "repo-wt");
    NodeFS.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(
      repo,
      "-c",
      "user.email=d@e.com",
      "-c",
      "user.name=D",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    );
    git(repo, "worktree", "add", "-q", "-b", "feature/wt", worktree);
    NodeFS.writeFileSync(NodePath.join(worktree, "only-in-worktree.txt"), "x\n");

    const project = await getJson("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path: repo }),
      headers: { "Content-Type": "application/json" },
    });
    const projectId: string = project.json.id;
    const workspace = await getJson("/api/projects");
    const other = workspace.json.find((item: { id: string }) => item.id !== projectId);
    await insertThread("thread-wt", projectId, worktree);

    const main = await getJson(`/api/projects/${projectId}/git/status`);
    expect(main.json).toMatchObject({ kind: "repo", branch: "main", files: [] });

    const scoped = await getJson(`/api/projects/${projectId}/git/status?threadId=thread-wt`);
    expect(scoped.json).toMatchObject({ kind: "repo", branch: "feature/wt" });
    expect(scoped.json.files.map((file: { path: string }) => file.path)).toEqual([
      "only-in-worktree.txt",
    ]);

    expect(other).toBeDefined();
    const mismatched = await getJson(`/api/projects/${other.id}/git/status?threadId=thread-wt`);
    expect(mismatched.status).toBe(404);
  });
});

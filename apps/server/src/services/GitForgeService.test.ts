import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { handleApiRequest } from "../httpRoutes.ts";
import { makeAppLayer } from "../server.ts";
import { parseCliAuthStatus, parseCliVersion } from "./gitForge/forgeCli.ts";
import {
  applyLineDeltas,
  describeRemote,
  detectForge,
  isSafeRepoPath,
  parseNumstatZ,
  parsePorcelainV2,
  parseRemoteUrl,
} from "./gitForge/gitParse.ts";
import type { CommandRunner } from "./gitForge/processRunner.ts";
import { redactSecrets, redactUrlCredentials } from "./gitForge/redact.ts";
import { toForgeStatus } from "./GitForgeService.ts";

const NO_HOSTS = { github: [], gitlab: [] };
const GITHUB_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const GITLAB_TOKEN = "glpat-abcdefghijklmnopqrstuv";

describe("parseRemoteUrl", () => {
  it.each([
    ["git@github.com:acme/widgets.git", "github.com", "acme", "widgets"],
    ["https://github.com/acme/widgets", "github.com", "acme", "widgets"],
    ["https://github.com/acme/widgets.git/", "github.com", "acme", "widgets"],
    ["ssh://git@github.com/acme/widgets.git", "github.com", "acme", "widgets"],
    ["git@gitlab.com:group/sub/project.git", "gitlab.com", "group/sub", "project"],
    ["https://gitlab.com/group/sub/project.git", "gitlab.com", "group/sub", "project"],
    ["ssh://git@code.acme.io:2222/team/app.git", "code.acme.io", "team", "app"],
    ["https://code.acme.io:8443/team/app.git", "code.acme.io:8443", "team", "app"],
  ])("parses %s", (url, host, owner, repo) => {
    expect(parseRemoteUrl(url)).toEqual({ host, owner, repo });
  });

  it("returns null for local paths and single-segment URLs", () => {
    expect(parseRemoteUrl("/srv/git/repo.git")).toBeNull();
    expect(parseRemoteUrl("https://github.com/acme")).toBeNull();
    expect(parseRemoteUrl("")).toBeNull();
  });
});

describe("detectForge", () => {
  it("detects github and gitlab hosts, including self-hosted names", () => {
    expect(detectForge("github.com", NO_HOSTS)).toBe("github");
    expect(detectForge("github.acme.com", NO_HOSTS)).toBe("github");
    expect(detectForge("gitlab.com", NO_HOSTS)).toBe("gitlab");
    expect(detectForge("gitlab.internal.io:8443", NO_HOSTS)).toBe("gitlab");
    expect(detectForge("bitbucket.org", NO_HOSTS)).toBe("other");
  });

  it("uses saved account hosts for self-hosted forges without a telltale name", () => {
    expect(detectForge("code.acme.io", { github: [], gitlab: ["code.acme.io"] })).toBe("gitlab");
  });

  it("describes a remote with a web URL and strips embedded credentials", () => {
    const remote = describeRemote(
      "origin",
      `https://x-access-token:${GITHUB_TOKEN}@github.com/acme/widgets.git`,
      NO_HOSTS,
    );
    expect(remote.url).toBe("https://github.com/acme/widgets.git");
    expect(remote.webUrl).toBe("https://github.com/acme/widgets");
    expect(JSON.stringify(remote)).not.toContain(GITHUB_TOKEN);
  });
});

describe("git status parsing", () => {
  it("parses branch headers, renames, deletions and untracked files", () => {
    const output = [
      "# branch.oid 0b56dcd6fd7909ac93b8f013fa8ae1d0ee32c8a4",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 MM N... 100644 100644 100644 422c2b7 be292e3 a.txt",
      "2 R. N... 100644 100644 100644 587be6b 587be6b R100 new name.txt",
      "old.txt",
      "1 .D N... 100644 100644 000000 db7c3ca db7c3ca z.txt",
      "u UU N... 100644 100644 100644 100644 df967b9 ba2906d c774709 f",
      "? untracked.txt",
      "",
    ].join("\0");
    const parsed = parsePorcelainV2(output);
    expect(parsed).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      hasCommits: true,
    });
    expect(
      parsed.files.map((file) => [file.path, file.status, file.staged, file.unstaged]),
    ).toEqual([
      ["a.txt", "modified", true, true],
      ["new name.txt", "renamed", true, false],
      ["z.txt", "deleted", false, true],
      ["f", "conflicted", true, true],
      ["untracked.txt", "untracked", false, true],
    ]);
    expect(parsed.files[1]!.originalPath).toBe("old.txt");
  });

  it("reports detached heads and repositories without commits", () => {
    const parsed = parsePorcelainV2("# branch.oid (initial)\0# branch.head (detached)\0");
    expect(parsed.branch).toBeNull();
    expect(parsed.hasCommits).toBe(false);
  });

  it("sums staged and unstaged numstat, including renames and binary files", () => {
    const unstaged = parseNumstatZ("1\t0\ta.txt\0-\t-\tlogo.png\0");
    const staged = parseNumstatZ("3\t2\ta.txt\x000\t0\t\0old.txt\0new name.txt\0");
    expect(staged.get("new name.txt")).toEqual({ additions: 0, deletions: 0 });
    const parsed = parsePorcelainV2("1 MM N... 100644 100644 100644 a b a.txt\0");
    expect(applyLineDeltas(parsed.files, [unstaged, staged])[0]).toMatchObject({
      additions: 4,
      deletions: 2,
    });
    expect(unstaged.get("logo.png")).toEqual({ additions: 0, deletions: 0 });
  });

  it("rejects absolute, parent-escaping and option-like commit paths", () => {
    expect(isSafeRepoPath("src/app.ts")).toBe(true);
    expect(isSafeRepoPath("/etc/passwd")).toBe(false);
    expect(isSafeRepoPath("../secret")).toBe(false);
    expect(isSafeRepoPath("--amend")).toBe(false);
  });
});

describe("secret redaction", () => {
  it("redacts known token formats, URL credentials and explicit secrets", () => {
    const text = `push https://oauth2:${GITLAB_TOKEN}@gitlab.com/a/b failed with ${GITHUB_TOKEN} and s3cret-value-1`;
    const redacted = redactSecrets(text, ["s3cret-value-1"]);
    expect(redacted).not.toContain(GITLAB_TOKEN);
    expect(redacted).not.toContain(GITHUB_TOKEN);
    expect(redacted).not.toContain("s3cret-value-1");
    expect(redacted).toContain("https://gitlab.com/a/b");
  });

  it("keeps ssh usernames, which are not secrets", () => {
    expect(redactUrlCredentials("ssh://git@github.com/a/b.git")).toBe(
      "ssh://git@github.com/a/b.git",
    );
  });
});

describe("forge CLI detection", () => {
  it("parses gh and glab auth status output across versions", () => {
    expect(
      parseCliAuthStatus(
        "github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Active account: true",
      ),
    ).toEqual([{ host: "github.com", username: "octo" }]);
    expect(
      parseCliAuthStatus("github.com\n  ✓ Logged in to github.com as octo (oauth_token)"),
    ).toEqual([{ host: "github.com", username: "octo" }]);
    expect(
      parseCliAuthStatus(
        "gitlab.example.com\n  ✓ Logged in to gitlab.example.com as tanuki (/home/u/.config/glab-cli/config.yml)",
      ),
    ).toEqual([{ host: "gitlab.example.com", username: "tanuki" }]);
    expect(parseCliAuthStatus("You are not logged into any GitHub hosts.")).toEqual([]);
    expect(parseCliVersion("gh version 2.45.0 (2025-07-18)")).toBe("2.45.0");
  });

  it("prefers a logged-in CLI over a stored credential", () => {
    const status = toForgeStatus(
      "github",
      { installed: true, version: "2.45.0", logins: [{ host: "github.com", username: "octo" }] },
      {
        forge: "github",
        host: "github.com",
        authSource: "token",
        token: GITHUB_TOKEN,
        username: "x",
      },
      false,
    );
    expect(status).toMatchObject({
      authSource: "gh-cli",
      username: "octo",
      hasStoredCredential: true,
    });
  });
});

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
  readonly auth: string | null;
}

const fakeForge = () => {
  const requests: RecordedRequest[] = [];
  const replies: Array<(request: RecordedRequest) => Response | null> = [];
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const request: RecordedRequest = {
      url: input,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
      auth: headers.get("Authorization"),
    };
    requests.push(request);
    for (const reply of replies) {
      const response = reply(request);
      if (response !== null) return response;
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  };
  return { requests, replies, fetchFn };
};

const cliCalls: Array<ReadonlyArray<string>> = [];
let ghLoggedIn = false;
const fakeCli: CommandRunner = (argv) => {
  cliCalls.push(argv);
  const reply = (exitCode: number, stdout: string, stderr = "") =>
    Effect.succeed({ exitCode, stdout, stderr, timedOut: false });
  if (!ghLoggedIn || argv[0] !== "gh") return reply(127, "", "not found");
  if (argv[1] === "--version") return reply(0, "gh version 2.45.0 (2025-07-18)");
  if (argv[1] === "auth") return reply(0, "", "  ✓ Logged in to github.com account octo (keyring)");
  return reply(1, '{"message":"Not Found"}', "gh: Not Found (HTTP 404)");
};

const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

describe("git forge HTTP routes", () => {
  const forge = fakeForge();
  let now = 1_000_000;
  const runtime = ManagedRuntime.make(
    makeAppLayer(
      { dbPath: ":memory:" },
      {
        githubOAuthClientId: "test-client",
        runner: fakeCli,
        fetch: forge.fetchFn,
        now: () => now,
      },
    ),
  );
  let tempDir = "";
  let projectGitBase = "";

  beforeAll(() => {
    tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-git-forge-"));
  });
  afterAll(async () => {
    await runtime.dispose();
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const request = new Request(`http://scuttle.test${path}`, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
        : {}),
    });
    const response = await runtime.runPromise(handleApiRequest(request, new URL(request.url)));
    if (response === null) throw new Error(`No route for ${method} ${path}`);
    const text = await response.text();
    return { status: response.status, text, json: text.length > 0 ? JSON.parse(text) : null };
  };

  it("rejects request bodies that do not match the contract", async () => {
    expect(
      (await call("POST", "/api/git/forges/token", { forge: "bitbucket", token: "x" })).status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/git/forges/token", { forge: "github", token: "  " })).status,
    ).toBe(400);
    expect((await call("POST", "/api/projects/p/git/checkout", { branch: "" })).status).toBe(400);
    expect((await call("POST", "/api/projects/p/git/commit", { message: "" })).status).toBe(400);
    expect((await call("GET", "/api/projects/missing/git/status")).status).toBe(404);
    expect((await call("DELETE", "/api/git/forges/bitbucket")).status).toBe(404);
  });

  it("saves a self-hosted GitLab token and never returns it", async () => {
    forge.replies.push((request) =>
      request.url === "https://code.acme.io/api/v4/user"
        ? Response.json({ username: "tanuki", private_token: GITLAB_TOKEN })
        : null,
    );
    const saved = await call("POST", "/api/git/forges/token", {
      forge: "gitlab",
      token: GITLAB_TOKEN,
      host: "https://code.acme.io/",
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      forge: "gitlab",
      connected: true,
      authSource: "token",
      host: "code.acme.io",
      username: "tanuki",
      cliInstalled: false,
    });
    expect(forge.requests.at(-1)?.auth).toBe(`Bearer ${GITLAB_TOKEN}`);
    const listed = await call("GET", "/api/git/forges");
    expect(saved.text + listed.text).not.toContain(GITLAB_TOKEN);

    const removed = await call("DELETE", "/api/git/forges/gitlab");
    expect(removed.json).toMatchObject({
      connected: false,
      authSource: "none",
      hasStoredCredential: false,
    });
  });

  it("reports a rejected token as unauthorized without echoing it", async () => {
    forge.replies.unshift((request) =>
      request.url === "https://api.github.com/user" &&
      request.auth === "Bearer ghp_badbadbadbadbadbadbadbad"
        ? Response.json({ message: "Bad credentials" }, { status: 401 })
        : null,
    );
    const result = await call("POST", "/api/git/forges/token", {
      forge: "github",
      token: "ghp_badbadbadbadbadbadbadbad",
    });
    expect(result.status).toBe(401);
    expect(result.text).not.toContain("ghp_badbadbadbadbadbadbadbad");
  });

  it("completes the GitHub device flow without exposing the device code", async () => {
    let polls = 0;
    forge.replies.push((request) => {
      if (request.url === "https://github.com/login/device/code") {
        return Response.json({
          device_code: "device-secret-123",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (request.url === "https://github.com/login/oauth/access_token") {
        polls += 1;
        return polls === 1
          ? Response.json({ error: "authorization_pending" })
          : Response.json({ access_token: "gho_oauthtokenoauthtokenoauth", token_type: "bearer" });
      }
      if (request.url === "https://api.github.com/user") return Response.json({ login: "octo" });
      return null;
    });
    const started = await call("POST", "/api/git/forges/github/device/start");
    expect(started.json).toMatchObject({ userCode: "ABCD-1234", intervalSeconds: 5 });
    expect(started.text).not.toContain("device-secret-123");
    const flowId: string = started.json.flowId;

    expect((await call("POST", "/api/git/forges/github/device/poll", { flowId })).json).toEqual({
      kind: "pending",
      intervalSeconds: 5,
    });
    const done = await call("POST", "/api/git/forges/github/device/poll", { flowId });
    expect(done.json).toMatchObject({
      kind: "complete",
      status: { authSource: "oauth", username: "octo", connected: true },
    });
    expect(done.text).not.toContain("gho_oauthtokenoauthtokenoauth");
    expect((await call("POST", "/api/git/forges/github/device/poll", { flowId })).status).toBe(404);

    const expired = await call("POST", "/api/git/forges/github/device/start");
    now += 901_000;
    expect(
      (await call("POST", "/api/git/forges/github/device/poll", { flowId: expired.json.flowId }))
        .json,
    ).toEqual({ kind: "expired" });
  });

  it("commits, pushes and opens a pull request through the saved token", async () => {
    const bare = NodePath.join(tempDir, "remote.git");
    const repo = NodePath.join(tempDir, "widgets");
    git(tempDir, "init", "-q", "--bare", "-b", "main", bare);
    NodeFS.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "dev@example.com");
    git(repo, "config", "user.name", "Dev");
    NodeFS.writeFileSync(NodePath.join(repo, "a.txt"), "one\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    git(repo, "remote", "add", "origin", "https://github.com/acme/widgets.git");
    git(repo, "config", "remote.origin.pushurl", bare);
    git(repo, "push", "-q", "-u", "origin", "main");

    const project = await call("POST", "/api/projects", { path: repo });
    const base = `/api/projects/${project.json.id}/git`;
    projectGitBase = base;

    const checkout = await call("POST", `${base}/checkout`, {
      branch: "feature/login",
      create: true,
    });
    expect(checkout.json.status).toMatchObject({ kind: "repo", branch: "feature/login" });

    NodeFS.writeFileSync(NodePath.join(repo, "a.txt"), "one\ntwo\n");
    NodeFS.writeFileSync(NodePath.join(repo, "b.txt"), "new\n");
    const status = await call("GET", `${base}/status`);
    expect(status.json).toMatchObject({
      forge: "github",
      upstream: null,
      summary: { changed: 2, untracked: 1, additions: 1, deletions: 0 },
    });

    const unsafe = await call("POST", `${base}/commit`, { message: "x", paths: ["../etc"] });
    expect(unsafe.status).toBe(422);
    const committed = await call("POST", `${base}/commit`, { message: "Add b", paths: ["b.txt"] });
    expect(committed.json.message).toMatch(/^Committed [0-9a-f]+$/);
    expect(committed.json.status.files.map((file: { path: string }) => file.path)).toEqual([
      "a.txt",
    ]);

    await call("DELETE", "/api/git/forges/github");
    const unauthenticated = await call("GET", `${base}/pull-requests`);
    expect(unauthenticated.status).toBe(401);

    forge.replies.unshift((request) => {
      if (request.url === "https://api.github.com/user") return Response.json({ login: "octo" });
      if (request.url === "https://api.github.com/repos/acme/widgets") {
        return Response.json({ default_branch: "main" });
      }
      if (
        request.url === "https://api.github.com/repos/acme/widgets/pulls" &&
        request.method === "POST"
      ) {
        return Response.json({
          number: 7,
          title: "Login",
          html_url: "https://github.com/acme/widgets/pull/7",
          state: "open",
          draft: true,
          merged_at: null,
          user: { login: "octo" },
          head: { ref: "feature/login" },
          base: { ref: "main" },
          updated_at: "2026-11-25T00:00:00Z",
        });
      }
      return null;
    });
    await call("POST", "/api/git/forges/token", { forge: "github", token: GITHUB_TOKEN });

    const created = await call("POST", `${base}/pull-requests`, { title: "Login", draft: true });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ number: 7, isDraft: true, headBranch: "feature/login" });
    const sent = forge.requests.findLast((request) => request.url.endsWith("/pulls"));
    expect(JSON.parse(sent?.body ?? "{}")).toEqual({
      title: "Login",
      body: "",
      head: "feature/login",
      base: "main",
      draft: true,
    });
    expect(git(bare, "branch", "--list", "feature/login")).toContain("feature/login");
  });

  it("prefers a logged-in gh CLI and explains a missing repository", async () => {
    ghLoggedIn = true;
    now += 60_000;
    const result = await call("GET", `${projectGitBase}/pull-requests`);
    expect(result.status).toBe(404);
    expect(result.json.error).toContain("acme/widgets was not found on github.com");
    expect(cliCalls.at(-1)).toEqual([
      "gh",
      "api",
      "--hostname",
      "github.com",
      "-X",
      "GET",
      "repos/acme/widgets/pulls?state=open&per_page=30",
    ]);
  });
});

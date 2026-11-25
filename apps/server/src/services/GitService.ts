import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type {
  GitBranchInfo,
  GitCheckoutInput,
  GitCommitInput,
  GitRemote,
  GitStatus,
} from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  applyLineDeltas,
  describeRemote,
  isSafeRepoPath,
  type KnownForgeHosts,
  parseNumstatZ,
  parsePorcelainV2,
  summarizeFiles,
} from "./gitForge/gitParse.ts";
import { commandFailure, runCommand } from "./gitForge/processRunner.ts";
import { redactSecrets } from "./gitForge/redact.ts";

export class GitServiceError extends Schema.TaggedError<GitServiceError>()("GitServiceError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Git ${this.operation} failed: ${this.detail}`;
  }
}

export interface RepoInspection {
  readonly isGitRepo: boolean;
  readonly rootPath: string;
  readonly defaultBranch: string;
  readonly currentBranch: string;
}

export interface CreatedWorktree {
  readonly worktreePath: string;
  readonly branch: string;
}

const runGit = (cwd: string, args: ReadonlyArray<string>, timeoutMs?: number) =>
  runCommand(["git", ...args], { cwd, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });

const NETWORK_TIMEOUT_MS = 120_000;

const sanitizeSlug = (raw: string): string => {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : "thread";
};

export class GitService extends Context.Service<
  GitService,
  {
    readonly inspectRepo: (dirPath: string) => Effect.Effect<RepoInspection>;
    readonly listBranches: (repoPath: string) => Effect.Effect<ReadonlyArray<GitBranchInfo>>;
    readonly createWorktree: (input: {
      readonly repoPath: string;
      readonly baseBranch: string;
      readonly titleHint: string;
      readonly threadId: string;
    }) => Effect.Effect<CreatedWorktree, GitServiceError>;
    readonly removeWorktree: (repoPath: string, worktreePath: string) => Effect.Effect<void>;
    readonly status: (cwd: string, known: KnownForgeHosts) => Effect.Effect<GitStatus>;
    readonly commit: (cwd: string, input: GitCommitInput) => Effect.Effect<string, GitServiceError>;
    readonly push: (cwd: string) => Effect.Effect<string, GitServiceError>;
    readonly pull: (cwd: string) => Effect.Effect<string, GitServiceError>;
    readonly checkout: (
      cwd: string,
      input: GitCheckoutInput,
    ) => Effect.Effect<string, GitServiceError>;
  }
>()("scuttle/server/GitService") {}

const make = Effect.sync(() => {
  const inspectRepo = Effect.fn("GitService.inspectRepo")(function* (dirPath: string) {
    const resolved = NodePath.resolve(dirPath);
    const rootRes = yield* runGit(resolved, ["rev-parse", "--show-toplevel"]);
    if (rootRes.exitCode !== 0) {
      return {
        isGitRepo: false,
        rootPath: resolved,
        defaultBranch: "main",
        currentBranch: "main",
      };
    }
    const rootPath = rootRes.stdout.trim() || resolved;
    const headRes = yield* runGit(rootPath, ["symbolic-ref", "--short", "HEAD"]);
    const currentBranch = headRes.exitCode === 0 ? headRes.stdout.trim() || "main" : "main";

    const originHead = yield* runGit(rootPath, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    let defaultBranch = currentBranch;
    if (originHead.exitCode === 0) {
      const ref = originHead.stdout.trim();
      const slash = ref.indexOf("/");
      if (slash >= 0 && ref.slice(slash + 1).length > 0) {
        defaultBranch = ref.slice(slash + 1);
      }
    } else {
      const branches = yield* runGit(rootPath, ["branch", "--format=%(refname:short)"]);
      const names = branches.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (names.includes("main")) defaultBranch = "main";
      else if (names.includes("master")) defaultBranch = "master";
    }

    return {
      isGitRepo: true,
      rootPath,
      defaultBranch,
      currentBranch,
    };
  });

  const listBranches = Effect.fn("GitService.listBranches")(function* (repoPath: string) {
    const inspection = yield* inspectRepo(repoPath);
    if (!inspection.isGitRepo) {
      return [{ name: "main", isCurrent: true, isDefault: true, isWorktree: false }];
    }

    const res = yield* runGit(inspection.rootPath, [
      "branch",
      "--format=%(HEAD)\t%(refname:short)\t%(worktreepath)",
    ]);
    if (res.exitCode !== 0) {
      return [
        {
          name: inspection.currentBranch,
          isCurrent: true,
          isDefault: inspection.currentBranch === inspection.defaultBranch,
          isWorktree: false,
        },
      ];
    }

    const branches: GitBranchInfo[] = [];
    for (const line of res.stdout.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      const [headMarker, name, wtPath] = line.split("\t");
      const trimmed = name?.trim() ?? "";
      if (trimmed.length === 0) continue;
      branches.push({
        name: trimmed,
        isCurrent: headMarker?.trim() === "*",
        isDefault: trimmed === inspection.defaultBranch,
        isWorktree: (wtPath?.trim().length ?? 0) > 0,
      });
    }

    if (branches.length === 0) {
      return [
        {
          name: inspection.currentBranch,
          isCurrent: true,
          isDefault: true,
          isWorktree: false,
        },
      ];
    }

    branches.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return branches;
  });

  const createWorktree = Effect.fn("GitService.createWorktree")(function* (input: {
    readonly repoPath: string;
    readonly baseBranch: string;
    readonly titleHint: string;
    readonly threadId: string;
  }) {
    const inspection = yield* inspectRepo(input.repoPath);
    if (!inspection.isGitRepo) {
      return yield* new GitServiceError({
        operation: "createWorktree",
        detail: `${input.repoPath} is not a Git repository.`,
      });
    }

    const hasCommit = yield* runGit(inspection.rootPath, ["rev-parse", "--verify", "HEAD"]);
    if (hasCommit.exitCode !== 0) {
      return yield* new GitServiceError({
        operation: "createWorktree",
        detail: "Repository has no commits yet. Make an initial commit or run locally.",
      });
    }

    const repoName = sanitizeSlug(NodePath.basename(inspection.rootPath));
    const slug = sanitizeSlug(input.titleHint);
    const shortId = input.threadId.slice(0, 6).toLowerCase();
    const branch = `scuttle/${slug}-${shortId}`;
    const worktreesRoot = NodePath.join(NodeOS.homedir(), ".scuttle", "worktrees", repoName);
    NodeFS.mkdirSync(worktreesRoot, { recursive: true });
    const worktreePath = NodePath.join(worktreesRoot, `${slug}-${shortId}`);

    const baseCheck = yield* runGit(inspection.rootPath, [
      "rev-parse",
      "--verify",
      input.baseBranch,
    ]);
    const baseRef = baseCheck.exitCode === 0 ? input.baseBranch : "HEAD";

    const addRes = yield* runGit(inspection.rootPath, [
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      baseRef,
    ]);
    if (addRes.exitCode !== 0) {
      return yield* new GitServiceError({
        operation: "createWorktree",
        detail: addRes.stderr.trim() || addRes.stdout.trim() || "git worktree add failed",
      });
    }

    return { worktreePath, branch };
  });

  const removeWorktree = Effect.fn("GitService.removeWorktree")(function* (
    repoPath: string,
    worktreePath: string,
  ) {
    yield* runGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
    yield* runGit(repoPath, ["worktree", "prune"]);
  });

  const requireRoot = Effect.fn("GitService.requireRoot")(function* (
    cwd: string,
    operation: string,
  ) {
    const res = yield* runGit(NodePath.resolve(cwd), ["rev-parse", "--show-toplevel"]);
    if (res.exitCode !== 0) {
      return yield* new GitServiceError({ operation, detail: `${cwd} is not a Git repository.` });
    }
    return res.stdout.trim();
  });

  const fail = (operation: string, result: Parameters<typeof commandFailure>[0]) =>
    new GitServiceError({
      operation,
      detail: redactSecrets(commandFailure(result, `git ${operation} failed`)),
    });

  const listRemotes = Effect.fn("GitService.listRemotes")(function* (root: string) {
    const res = yield* runGit(root, ["config", "--get-regexp", "^remote\\..*\\.url$"]);
    const remotes = new Map<string, string>();
    for (const line of res.stdout.split(/\r?\n/)) {
      const match = /^remote\.(.+)\.url (.+)$/.exec(line.trim());
      if (match !== null) remotes.set(match[1]!, match[2]!);
    }
    return remotes;
  });

  const pickRemoteName = (remotes: ReadonlyMap<string, string>, upstream: string | null) => {
    const upstreamRemote = upstream?.split("/")[0];
    if (upstreamRemote !== undefined && remotes.has(upstreamRemote)) return upstreamRemote;
    if (remotes.has("origin")) return "origin";
    return remotes.keys().next().value ?? null;
  };

  const status = Effect.fn("GitService.status")(function* (cwd: string, known: KnownForgeHosts) {
    const rootRes = yield* runGit(NodePath.resolve(cwd), ["rev-parse", "--show-toplevel"]);
    if (rootRes.exitCode !== 0) return { kind: "not-a-repo" as const, path: cwd };
    const root = rootRes.stdout.trim();
    const [porcelain, unstaged, staged, remotes] = yield* Effect.all(
      [
        runGit(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]),
        runGit(root, ["diff", "--numstat", "-z"]),
        runGit(root, ["diff", "--cached", "--numstat", "-z"]),
        listRemotes(root),
      ],
      { concurrency: "unbounded" },
    );
    const parsed = parsePorcelainV2(porcelain.stdout);
    const files = applyLineDeltas(parsed.files, [
      parseNumstatZ(unstaged.stdout),
      parseNumstatZ(staged.stdout),
    ]);
    const remoteName = pickRemoteName(remotes, parsed.upstream);
    const remote: GitRemote | null =
      remoteName === null ? null : describeRemote(remoteName, remotes.get(remoteName)!, known);
    return {
      kind: "repo" as const,
      branch: parsed.branch,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      hasCommits: parsed.hasCommits,
      remote,
      forge: remote?.forge ?? "none",
      files,
      summary: summarizeFiles(files),
    };
  });

  const commit = Effect.fn("GitService.commit")(function* (cwd: string, input: GitCommitInput) {
    const root = yield* requireRoot(cwd, "commit");
    const paths = input.paths ?? [];
    const unsafe = paths.find((path) => !isSafeRepoPath(path));
    if (unsafe !== undefined) {
      return yield* new GitServiceError({
        operation: "commit",
        detail: `Path "${unsafe}" must be relative to the repository root.`,
      });
    }
    const addRes = yield* runGit(
      root,
      paths.length > 0 ? ["add", "-A", "--", ...paths] : ["add", "-A"],
    );
    if (addRes.exitCode !== 0) return yield* fail("add", addRes);
    const commitArgs = ["commit", "-m", input.message];
    const commitRes = yield* runGit(
      root,
      paths.length > 0 ? [...commitArgs, "--", ...paths] : commitArgs,
    );
    if (commitRes.exitCode !== 0) return yield* fail("commit", commitRes);
    const sha = yield* runGit(root, ["rev-parse", "--short", "HEAD"]);
    return `Committed ${sha.stdout.trim()}`;
  });

  const push = Effect.fn("GitService.push")(function* (cwd: string) {
    const root = yield* requireRoot(cwd, "push");
    const parsed = parsePorcelainV2(
      (yield* runGit(root, ["status", "--porcelain=v2", "--branch", "-z"])).stdout,
    );
    if (parsed.branch === null) {
      return yield* new GitServiceError({
        operation: "push",
        detail: "HEAD is detached. Switch to a branch before pushing.",
      });
    }
    let args: ReadonlyArray<string> = ["push"];
    if (parsed.upstream === null) {
      const remoteName = pickRemoteName(yield* listRemotes(root), null);
      if (remoteName === null) {
        return yield* new GitServiceError({
          operation: "push",
          detail: "No remote is configured. Add one with `git remote add origin <url>`.",
        });
      }
      args = ["push", "--set-upstream", remoteName, "HEAD"];
    }
    const res = yield* runGit(root, args, NETWORK_TIMEOUT_MS);
    if (res.exitCode !== 0) return yield* fail("push", res);
    return parsed.upstream === null
      ? `Pushed ${parsed.branch} and set upstream`
      : `Pushed ${parsed.branch}`;
  });

  const pull = Effect.fn("GitService.pull")(function* (cwd: string) {
    const root = yield* requireRoot(cwd, "pull");
    const res = yield* runGit(root, ["pull", "--ff-only"], NETWORK_TIMEOUT_MS);
    if (res.exitCode !== 0) return yield* fail("pull", res);
    return /up to date/i.test(res.stdout) ? "Already up to date" : "Pulled latest changes";
  });

  const checkout = Effect.fn("GitService.checkout")(function* (
    cwd: string,
    input: GitCheckoutInput,
  ) {
    const root = yield* requireRoot(cwd, "checkout");
    const valid = yield* runGit(root, ["check-ref-format", "--branch", input.branch]);
    if (valid.exitCode !== 0 || input.branch.startsWith("-")) {
      return yield* new GitServiceError({
        operation: "checkout",
        detail: `"${input.branch}" is not a valid branch name.`,
      });
    }
    const create = input.create === true;
    const res = yield* runGit(
      root,
      create ? ["switch", "-c", input.branch] : ["switch", input.branch],
    );
    if (res.exitCode !== 0) return yield* fail("checkout", res);
    return create ? `Created and switched to ${input.branch}` : `Switched to ${input.branch}`;
  });

  return GitService.of({
    inspectRepo,
    listBranches,
    createWorktree,
    removeWorktree,
    status,
    commit,
    push,
    pull,
    checkout,
  });
});

export const layer = Layer.effect(GitService, make);

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { GitBranchInfo } from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

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

const runGit = (
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> =>
  Effect.promise(async () => {
    try {
      const proc = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    } catch (error) {
      return {
        exitCode: 127,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  });

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

  return GitService.of({
    inspectRepo,
    listBranches,
    createWorktree,
    removeWorktree,
  });
});

export const layer = Layer.effect(GitService, make);

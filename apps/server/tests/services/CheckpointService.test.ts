import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import {
  buildCheckpointRef,
  CheckpointError,
  CheckpointService,
  Live,
  sanitizeThreadId,
} from "../../src/services/CheckpointService.ts";

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]): string => {
  const res = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C" },
  });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
};

const initRepo = (options?: { readonly withCommit?: boolean }): string => {
  const repo = makeTempDir("scuttle-ckpt-");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test User");
  git(repo, "config", "user.email", "test@example.com");
  if (options?.withCommit !== false) {
    NodeFS.writeFileSync(NodePath.join(repo, "tracked.txt"), "line1\nline2\n");
    NodeFS.writeFileSync(NodePath.join(repo, ".gitignore"), "ignored.log\nbuild/\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "initial commit");
  }
  return repo;
};

const runWithService = <A, E>(eff: Effect.Effect<A, E, CheckpointService>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(Live)));

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CheckpointService", () => {
  it("validates and sanitizes threadId and ordinal into checkpoint refs", async () => {
    expect(await Effect.runPromise(sanitizeThreadId("thr_123-abc"))).toBe("thr_123-abc");
    expect(await Effect.runPromise(sanitizeThreadId("thr:123"))).toBe("thr-123");
    expect(await Effect.runPromise(buildCheckpointRef("thr_123", 0))).toBe(
      "refs/scuttle/checkpoints/thr_123/0",
    );

    const badThread = await Effect.runPromiseExit(buildCheckpointRef("../evil", 0));
    expect(badThread._tag).toBe("Failure");

    const badOrdinal = await Effect.runPromiseExit(buildCheckpointRef("thr_123", -1));
    expect(badOrdinal._tag).toBe("Failure");
  });

  it("(a) captures a checkpoint on clean HEAD via fast path", async () => {
    const repo = initRepo();
    const headBefore = git(repo, "rev-parse", "HEAD");
    // Remove local identity to verify commit-tree succeeds via CheckpointService identity env.
    git(repo, "config", "--unset", "user.name");
    git(repo, "config", "--unset", "user.email");

    const captured = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-clean", ordinal: 1 });
      }),
    );

    expect(captured).not.toBeNull();
    expect(captured!.ref).toBe("refs/scuttle/checkpoints/thread-clean/1");
    expect(captured!.headOid).toBe(headBefore);
    expect(git(repo, "rev-parse", `${captured!.ref}^{tree}`)).toBe(
      git(repo, "rev-parse", `${headBefore}^{tree}`),
    );
    expect(git(repo, "rev-parse", `${captured!.ref}^1`)).toBe(headBefore);
    expect(git(repo, "log", "-1", "--format=%s", captured!.ref)).toBe("scuttle checkpoint");
    expect(git(repo, "rev-parse", "HEAD")).toBe(headBefore);
  });

  it("(b) captures dirty + untracked files without touching the user's staged index or HEAD", async () => {
    const repo = initRepo();
    const headBefore = git(repo, "rev-parse", "HEAD");

    NodeFS.writeFileSync(NodePath.join(repo, "staged.txt"), "staged-v1\n");
    git(repo, "add", "staged.txt");
    // Modify staged.txt again in worktree so index != worktree.
    NodeFS.writeFileSync(NodePath.join(repo, "staged.txt"), "worktree-v2\n");
    NodeFS.writeFileSync(NodePath.join(repo, "tracked.txt"), "line1\nmodified\n");
    NodeFS.writeFileSync(NodePath.join(repo, "untracked.txt"), "hello\n");
    NodeFS.writeFileSync(NodePath.join(repo, "ignored.log"), "keep-ignored\n");
    NodeFS.mkdirSync(NodePath.join(repo, "excluded-dir"));
    NodeFS.writeFileSync(NodePath.join(repo, "excluded-dir", "secret.txt"), "skip\n");

    const indexStatBefore = NodeFS.statSync(NodePath.join(repo, ".git", "index"));

    const captured = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({
          cwd: repo,
          threadId: "thread-dirty",
          ordinal: 2,
          excludePaths: ["excluded-dir", "build"],
        });
      }),
    );

    expect(captured).not.toBeNull();
    expect(captured!.headOid).toBe(headBefore);
    expect(git(repo, "rev-parse", "HEAD")).toBe(headBefore);

    // Real index must be completely untouched.
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("staged.txt");
    expect(git(repo, "show", ":staged.txt")).toBe("staged-v1");
    const indexStatAfter = NodeFS.statSync(NodePath.join(repo, ".git", "index"));
    expect(indexStatAfter.mtimeMs).toBe(indexStatBefore.mtimeMs);
    expect(indexStatAfter.size).toBe(indexStatBefore.size);

    // Checkpoint tree reflects full worktree (including untracked) while respecting .gitignore and excludePaths.
    const ckptFiles = git(repo, "ls-tree", "-r", "--name-only", captured!.commitOid).split("\n");
    expect(ckptFiles).toContain("tracked.txt");
    expect(ckptFiles).toContain("staged.txt");
    expect(ckptFiles).toContain("untracked.txt");
    expect(ckptFiles).not.toContain("ignored.log");
    expect(ckptFiles).not.toContain("excluded-dir/secret.txt");
    expect(git(repo, "show", `${captured!.commitOid}:staged.txt`)).toBe("worktree-v2");

    // Scratch index and private object dirs must be cleaned up.
    const gitEntries = NodeFS.readdirSync(NodePath.join(repo, ".git"));
    expect(gitEntries.some((name) => name.startsWith("scuttle-ckpt-idx-"))).toBe(false);
    const objEntries = NodeFS.readdirSync(NodePath.join(repo, ".git", "objects"));
    expect(objEntries.some((name) => name.startsWith("tmp_scuttle_ckpt_"))).toBe(false);
  });

  it("(c) restores modified files, removes post-checkpoint untracked files, and preserves ignored files", async () => {
    const repo = initRepo();
    NodeFS.writeFileSync(NodePath.join(repo, "tracked.txt"), "checkpoint-state\n");
    NodeFS.writeFileSync(NodePath.join(repo, "kept-untracked.txt"), "keep-me\n");
    NodeFS.writeFileSync(NodePath.join(repo, "ignored.log"), "important-log\n");

    const ckpt = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-restore", ordinal: 0 });
      }),
    );
    expect(ckpt).not.toBeNull();

    // Mutate worktree post-checkpoint, add untracked files, and add a nested .gitignore hiding another file.
    NodeFS.writeFileSync(NodePath.join(repo, "tracked.txt"), "mutated-after\n");
    NodeFS.unlinkSync(NodePath.join(repo, "kept-untracked.txt"));
    NodeFS.writeFileSync(NodePath.join(repo, "post-untracked.txt"), "remove-me\n");
    NodeFS.mkdirSync(NodePath.join(repo, "sub"));
    NodeFS.writeFileSync(NodePath.join(repo, "sub", ".gitignore"), "hidden.txt\n");
    NodeFS.writeFileSync(NodePath.join(repo, "sub", "hidden.txt"), "remove-me-too\n");
    NodeFS.writeFileSync(NodePath.join(repo, "ignored.log"), "updated-log\n");

    await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.restoreCheckpoint({ cwd: repo, ref: ckpt!.ref });
      }),
    );

    expect(NodeFS.readFileSync(NodePath.join(repo, "tracked.txt"), "utf8")).toBe(
      "checkpoint-state\n",
    );
    expect(NodeFS.readFileSync(NodePath.join(repo, "kept-untracked.txt"), "utf8")).toBe(
      "keep-me\n",
    );
    expect(NodeFS.existsSync(NodePath.join(repo, "post-untracked.txt"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(repo, "sub"))).toBe(false);
    expect(NodeFS.readFileSync(NodePath.join(repo, "ignored.log"), "utf8")).toBe("updated-log\n");
    // Index should be reset to HEAD (no staged changes left behind by restore).
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
  });

  it("(d) computes accurate diffCheckpointSummary stats across checkpoints", async () => {
    const repo = initRepo();
    const ckpt0 = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-diff", ordinal: 0 });
      }),
    );

    NodeFS.writeFileSync(NodePath.join(repo, "tracked.txt"), "line1\nchanged\nadded\n");
    NodeFS.writeFileSync(NodePath.join(repo, "new-file.txt"), "one\ntwo\nthree\n");
    NodeFS.writeFileSync(NodePath.join(repo, "image.bin"), Buffer.from([0, 1, 2, 3, 255]));

    const ckpt1 = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-diff", ordinal: 1 });
      }),
    );

    const summary = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.diffCheckpointSummary({
          cwd: repo,
          fromRef: ckpt0!.ref,
          toRef: ckpt1!.ref,
        });
      }),
    );

    expect(summary.filesChanged).toBe(3);
    expect(summary.insertions).toBe(5);
    expect(summary.deletions).toBe(1);
    expect(summary.files).toEqual([
      { path: "image.bin", insertions: 0, deletions: 0 },
      { path: "new-file.txt", insertions: 3, deletions: 0 },
      { path: "tracked.txt", insertions: 2, deletions: 1 },
    ]);
  });

  it("(e) deletes all checkpoint refs for a thread without touching other threads", async () => {
    const repo = initRepo();

    await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-1", ordinal: 0 });
        yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-1", ordinal: 1 });
        yield* svc.captureCheckpoint({ cwd: repo, threadId: "thread-10", ordinal: 0 });
      }),
    );

    const deleted = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.deleteThreadCheckpoints({ cwd: repo, threadId: "thread-1" });
      }),
    );

    expect(deleted.deletedCount).toBe(2);
    expect(deleted.deletedRefs).toEqual([
      "refs/scuttle/checkpoints/thread-1/0",
      "refs/scuttle/checkpoints/thread-1/1",
    ]);
    expect(git(repo, "for-each-ref", "--format=%(refname)", "refs/scuttle/checkpoints/")).toBe(
      "refs/scuttle/checkpoints/thread-10/0",
    );
  });

  it("(f) returns null gracefully on non-git directories and handles unborn repos", async () => {
    const nonGit = makeTempDir("scuttle-nongit-");
    NodeFS.writeFileSync(NodePath.join(nonGit, "file.txt"), "plain\n");

    const nonGitResult = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({ cwd: nonGit, threadId: "thread-none", ordinal: 0 });
      }),
    );
    expect(nonGitResult).toBeNull();

    const unbornRepo = initRepo({ withCommit: false });
    NodeFS.writeFileSync(NodePath.join(unbornRepo, "first.txt"), "hello\n");

    const unbornCkpt = await runWithService(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.captureCheckpoint({
          cwd: unbornRepo,
          threadId: "thread-unborn",
          ordinal: 0,
        });
      }),
    );
    expect(unbornCkpt).not.toBeNull();
    expect(unbornCkpt!.headOid).toBeNull();
    expect(git(unbornRepo, "show", `${unbornCkpt!.ref}:first.txt`)).toBe("hello");

    const missingRestore = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        return yield* svc.restoreCheckpoint({
          cwd: unbornRepo,
          ref: "refs/scuttle/checkpoints/thread-unborn/99",
        });
      }).pipe(Effect.provide(Live), Effect.flip),
    );
    expect(missingRestore).toBeInstanceOf(CheckpointError);
  });
});

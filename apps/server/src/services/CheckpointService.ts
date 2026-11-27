import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { isSafeRepoPath } from "./gitForge/gitParse.ts";

export class CheckpointError extends Schema.TaggedError<CheckpointError>()("CheckpointError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Checkpoint ${this.operation} failed: ${this.detail}`;
  }
}

export interface CheckpointDiffFile {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}
export interface CheckpointDiffSummary {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly files: ReadonlyArray<CheckpointDiffFile>;
}

const REF_ROOT = "refs/scuttle/checkpoints";
const COMMIT_MSG = "scuttle checkpoint";
const w = (s: string) => s.split(" ");
const INDEX_CFG = w(
  "-c core.fsmonitor=false -c core.splitIndex=false -c splitIndex.sharedIndexExpire=never",
);
const REV_ARGS = w(
  "rev-parse --path-format=absolute --is-inside-work-tree --show-toplevel --git-common-dir --git-path index --verify --quiet HEAD",
);
const STATUS_ARGS = w(
  "-c core.fsmonitor=false status --porcelain=v2 --branch --untracked-files=normal",
);
const RESTORE_ARGS = w("restore --worktree --staged --ignore-skip-worktree-bits");
const DIFF_ARGS = w("-c diff.relative=false diff --numstat -z --no-color --no-ext-diff");
const STRIPPED_ENV = new Set(
  w(
    "GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_QUARANTINE_PATH",
  ),
);
const IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "Scuttle",
  GIT_AUTHOR_EMAIL: "scuttle@users.noreply.github.com",
  GIT_COMMITTER_NAME: "Scuttle",
  GIT_COMMITTER_EMAIL: "scuttle@users.noreply.github.com",
};
const BASE_ENV = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", LC_ALL: "C", NO_COLOR: "1" };
const fail = (operation: string, detail: string) =>
  Effect.fail(new CheckpointError({ operation, detail }));

const runGit = (
  op: string,
  cwd: string,
  args: ReadonlyArray<string>,
  opts?: {
    readonly env?: Record<string, string | undefined>;
    readonly stdin?: string;
    readonly allowNonZero?: boolean;
  },
) =>
  Effect.tryPromise({
    try: async () => {
      const env: Record<string, string> = { ...BASE_ENV };
      for (const [k, v] of Object.entries(process.env))
        if (v !== undefined && !STRIPPED_ENV.has(k)) env[k] = v;
      for (const [k, v] of Object.entries(opts?.env ?? {})) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
      const proc = Bun.spawn(["git", ...args], {
        cwd,
        stdin: opts?.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const timer = setTimeout(() => proc.kill(), 30_000);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]).finally(() => clearTimeout(timer));
      return { exitCode, stdout, stderr };
    },
    catch: (err) =>
      new CheckpointError({
        operation: op,
        detail: err instanceof Error ? err.message : String(err),
      }),
  }).pipe(
    Effect.flatMap((res) =>
      res.exitCode === 0 || opts?.allowNonZero
        ? Effect.succeed(res)
        : fail(op, res.stderr.trim() || res.stdout.trim() || `git ${args[0] ?? ""} failed`),
    ),
  );

export const sanitizeThreadId = (threadId: string): Effect.Effect<string, CheckpointError> => {
  const trimmed = threadId.trim();
  const bad = !trimmed || trimmed !== threadId || /[\0/\\]/.test(trimmed) || trimmed.includes("..");
  const sanitized = bad ? "" : trimmed.replace(/[^A-Za-z0-9_-]/g, "-");
  return !bad && /^[A-Za-z0-9_-]+$/.test(sanitized) && /[A-Za-z0-9]/.test(sanitized)
    ? Effect.succeed(sanitized)
    : fail("validateThreadId", `Invalid threadId "${threadId}".`);
};

export const validateOrdinal = (ordinal: number): Effect.Effect<number, CheckpointError> =>
  Number.isInteger(ordinal) && ordinal >= 0
    ? Effect.succeed(ordinal)
    : fail("validateOrdinal", `Invalid checkpoint ordinal "${String(ordinal)}".`);

export const buildCheckpointRefPrefix = (threadId: string) =>
  sanitizeThreadId(threadId).pipe(Effect.map((id) => `${REF_ROOT}/${id}/`));
export const buildCheckpointRef = (threadId: string, ordinal: number) =>
  Effect.all([sanitizeThreadId(threadId), validateOrdinal(ordinal)]).pipe(
    Effect.map(([id, ord]) => `${REF_ROOT}/${id}/${ord}`),
  );

const validateGitRef = (ref: string, op: string): Effect.Effect<string, CheckpointError> =>
  !ref || ref.trim() !== ref || ref.startsWith("-") || /[\s\0~^:?*[\\]|\.\.|\.lock$|\/$/.test(ref)
    ? fail(op, `Invalid git ref "${ref}".`)
    : Effect.succeed(ref);

export const buildExcludePathspecs = (
  excludePaths?: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, CheckpointError> => {
  if (!excludePaths?.length) return Effect.succeed([]);
  const out: string[] = [];
  for (const raw of excludePaths) {
    const cleaned = raw.replace(/\/+$/, "");
    if (!isSafeRepoPath(cleaned))
      return fail("validateExcludePaths", `Unsafe exclude path "${raw}".`);
    out.push(`:(exclude,literal)${cleaned}`);
  }
  return Effect.succeed(out);
};

export const parsePorcelainStatus = (
  output: string,
): { readonly isClean: boolean; readonly headOid: string | null } => {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const oid = lines
    .find((l) => l.startsWith("# branch.oid "))
    ?.slice(13)
    .trim();
  return {
    isClean: !lines.some((l) => !l.startsWith("# ")),
    headOid: oid && /^[0-9a-f]{40,64}$/.test(oid) ? oid : null,
  };
};

export const parseNumstatZ = (output: string): CheckpointDiffSummary => {
  const records = output.split("\0");
  const files: CheckpointDiffFile[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(records[i] ?? "");
    if (!m) continue;
    let filePath = m[3] ?? "";
    if (!filePath) {
      filePath = records[i + 2] ?? "";
      i += 2;
    }
    if (!filePath) continue;
    const ins = Number.parseInt(m[1] ?? "0", 10);
    const del = Number.parseInt(m[2] ?? "0", 10);
    files.push({
      path: filePath,
      insertions: Number.isFinite(ins) ? ins : 0,
      deletions: Number.isFinite(del) ? del : 0,
    });
  }
  return {
    filesChanged: files.length,
    insertions: files.reduce((s, f) => s + f.insertions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    files,
  };
};

const inspectWorktree = (cwd: string) =>
  Effect.gen(function* () {
    const resolved = NodePath.resolve(cwd);
    if (!NodeFS.existsSync(resolved)) return null;
    const res = yield* runGit("inspectWorktree", resolved, REV_ARGS, { allowNonZero: true });
    // Exit 1 occurs when HEAD is unborn while the preceding worktree paths still print.
    if (res.exitCode !== 0 && res.exitCode !== 1) {
      const nonGit =
        res.stdout.startsWith("false") ||
        /not a git repository|must be run in a work tree|cannot use bare repository/.test(
          res.stderr,
        );
      return nonGit
        ? null
        : yield* fail("inspectWorktree", res.stderr.trim() || "git rev-parse failed");
    }
    const lines = res.stdout.replace(/\n$/, "").split("\n");
    if (lines[0]?.trim() !== "true") return null;
    const [, topLevel, gitCommonDir, , rawHead] = lines;
    if (!topLevel || !gitCommonDir)
      return yield* fail("inspectWorktree", "Unexpected rev-parse output.");
    const head = res.exitCode === 0 ? rawHead?.trim() : undefined;
    return {
      topLevel,
      gitCommonDir,
      headOid: head && /^[0-9a-f]{40,64}$/.test(head) ? head : null,
    };
  });

const requireWorktree = (op: string, cwd: string) =>
  inspectWorktree(cwd).pipe(
    Effect.flatMap((repo) =>
      repo ? Effect.succeed(repo) : fail(op, `"${cwd}" is not a Git worktree.`),
    ),
  );

const resolveCommitOid = (op: string, cwd: string, ref: string) =>
  validateGitRef(ref, op).pipe(
    Effect.flatMap((safe) =>
      runGit(op, cwd, ["rev-parse", "--verify", "--quiet", `${safe}^{commit}`], {
        allowNonZero: true,
      }),
    ),
    Effect.flatMap((res) =>
      res.exitCode === 0 && res.stdout.trim()
        ? Effect.succeed(res.stdout.trim())
        : fail(op, res.stderr.trim() || `Checkpoint ref "${ref}" could not be resolved.`),
    ),
  );

// git add rejects pathspecs naming ignored folders, so drop already-ignored exclusions first.
const filterExcludePathspecs = (cwd: string, excludePaths?: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const pathspecs = yield* buildExcludePathspecs(excludePaths);
    if (pathspecs.length === 0) return pathspecs;
    const raw = pathspecs.map((s) => s.slice(18));
    const check = yield* runGit("captureCheckpoint", cwd, ["check-ignore", "-z", "--stdin"], {
      stdin: `${raw.join("\0")}\0`,
      allowNonZero: true,
    });
    if (check.exitCode !== 0 && check.exitCode !== 1) return pathspecs;
    const ignored = new Set(check.stdout.split("\0").filter(Boolean));
    return pathspecs.filter((s) => !ignored.has(s.slice(18)));
  });

const publishPrivateObjects = (privateDir: string, sharedDir: string) =>
  Effect.try({
    try: () => {
      const linkOrMove = (from: string, to: string) => {
        try {
          NodeFS.linkSync(from, to);
        } catch (err) {
          if (err instanceof Error && "code" in err && err.code === "EEXIST") return;
          if (!NodeFS.existsSync(to)) NodeFS.renameSync(from, to);
        }
      };
      for (const dir of NodeFS.readdirSync(privateDir)) {
        if (dir !== "pack" && !/^[0-9a-f]{2}$/.test(dir)) continue;
        const src = NodePath.join(privateDir, dir);
        const dst = NodePath.join(sharedDir, dir);
        NodeFS.mkdirSync(dst, { recursive: true });
        const names = NodeFS.readdirSync(src);
        if (dir !== "pack") {
          for (const n of names)
            if (/^(?:[0-9a-f]{38}|[0-9a-f]{62})$/.test(n))
              linkOrMove(NodePath.join(src, n), NodePath.join(dst, n));
          continue;
        }
        const set = new Set(names);
        for (const n of names) {
          const base = /^pack-(?:[0-9a-f]{40}|[0-9a-f]{64})\.pack$/.test(n) ? n.slice(0, -5) : null;
          if (!base || !set.has(`${base}.idx`)) continue;
          for (const ext of w(".keep .promisor .rev .idx .pack"))
            if (set.has(`${base}${ext}`))
              linkOrMove(NodePath.join(src, `${base}${ext}`), NodePath.join(dst, `${base}${ext}`));
        }
      }
    },
    catch: (err) =>
      new CheckpointError({
        operation: "publishObjects",
        detail: err instanceof Error ? err.message : String(err),
      }),
  });

export const captureCheckpoint = Effect.fn("CheckpointService.captureCheckpoint")(
  function* (input: {
    readonly cwd: string;
    readonly threadId: string;
    readonly ordinal: number;
    readonly excludePaths?: ReadonlyArray<string>;
  }) {
    const ref = yield* buildCheckpointRef(input.threadId, input.ordinal);
    const repo = yield* inspectWorktree(input.cwd);
    if (!repo) return null;

    const run = (args: ReadonlyArray<string>, env?: Record<string, string>) =>
      runGit("captureCheckpoint", repo.topLevel, args, env ? { env } : undefined);
    const parsed = parsePorcelainStatus(
      (yield* run(STATUS_ARGS, { GIT_OPTIONAL_LOCKS: "0" })).stdout,
    );

    let commitOid: string;
    if (repo.headOid && parsed.isClean && parsed.headOid === repo.headOid) {
      commitOid = (yield* run(
        ["commit-tree", `${repo.headOid}^{tree}`, "-p", repo.headOid, "-m", COMMIT_MSG],
        IDENTITY_ENV,
      )).stdout.trim();
    } else {
      const excludePathspecs = yield* filterExcludePathspecs(repo.topLevel, input.excludePaths);
      const id = NodeCrypto.randomUUID();
      const scratchIndex = NodePath.join(repo.gitCommonDir, `scuttle-ckpt-idx-${id}`);
      const sharedObjects = NodePath.join(repo.gitCommonDir, "objects");
      const privateObjects = NodePath.join(sharedObjects, `tmp_scuttle_ckpt_${id}`);
      commitOid = yield* Effect.gen(function* () {
        NodeFS.mkdirSync(privateObjects, { recursive: true });
        const env: Record<string, string> = {
          GIT_INDEX_FILE: scratchIndex,
          GIT_OBJECT_DIRECTORY: privateObjects,
          GIT_QUARANTINE_PATH: privateObjects,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${sharedObjects.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
          ...IDENTITY_ENV,
        };
        if (repo.headOid) yield* run([...INDEX_CFG, "read-tree", repo.headOid], env);
        yield* run(
          [...INDEX_CFG, ...w("-c core.safecrlf=false add -A -- ."), ...excludePathspecs],
          env,
        );
        const treeOid = (yield* run([...INDEX_CFG, "write-tree"], env)).stdout.trim();
        const oid = (yield* run(
          ["commit-tree", treeOid, ...(repo.headOid ? ["-p", repo.headOid] : []), "-m", COMMIT_MSG],
          env,
        )).stdout.trim();
        yield* publishPrivateObjects(privateObjects, sharedObjects);
        return oid;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            NodeFS.rmSync(scratchIndex, { force: true });
            NodeFS.rmSync(`${scratchIndex}.lock`, { force: true });
            NodeFS.rmSync(privateObjects, { recursive: true, force: true });
          }),
        ),
      );
    }

    yield* run(["update-ref", ref, commitOid]);
    return { ref, commitOid, headOid: repo.headOid, capturedAt: new Date().toISOString() };
  },
);

export const restoreCheckpoint = Effect.fn("CheckpointService.restoreCheckpoint")(
  function* (input: {
    readonly cwd: string;
    readonly ref: string;
    readonly excludePaths?: ReadonlyArray<string>;
  }) {
    const repo = yield* requireWorktree("restoreCheckpoint", input.cwd);
    const commitOid = yield* resolveCommitOid("restoreCheckpoint", repo.topLevel, input.ref);
    const scope = [".", ...(yield* buildExcludePathspecs(input.excludePaths))];
    const run = (args: ReadonlyArray<string>) => runGit("restoreCheckpoint", repo.topLevel, args);

    const tracked = yield* run([
      "ls-files",
      "--cached",
      `--with-tree=${commitOid}`,
      "-z",
      "--",
      ...scope,
    ]);
    if (tracked.stdout.length > 0)
      yield* run([...RESTORE_ARGS, "--source", commitOid, "--", ...scope]);
    for (let pass = 0; pass < 4; pass += 1)
      if (!/^Removing /m.test((yield* run(["clean", "-fd", "--", ...scope])).stdout)) break;
    yield* run([
      ...w(repo.headOid ? "reset --quiet --" : "rm -r --cached --quiet --ignore-unmatch --"),
      ...scope,
    ]);
    return { ref: input.ref, commitOid, restoredAt: new Date().toISOString() };
  },
);

export const diffCheckpointSummary = Effect.fn("CheckpointService.diffCheckpointSummary")(
  function* (input: { readonly cwd: string; readonly fromRef: string; readonly toRef: string }) {
    const repo = yield* requireWorktree("diffCheckpointSummary", input.cwd);
    const fromOid = yield* resolveCommitOid("diffCheckpointSummary", repo.topLevel, input.fromRef);
    const toOid = yield* resolveCommitOid("diffCheckpointSummary", repo.topLevel, input.toRef);
    return parseNumstatZ(
      (yield* runGit("diffCheckpointSummary", repo.topLevel, [...DIFF_ARGS, fromOid, toOid]))
        .stdout,
    );
  },
);

export const deleteThreadCheckpoints = Effect.fn("CheckpointService.deleteThreadCheckpoints")(
  function* (input: { readonly cwd: string; readonly threadId: string }) {
    const prefix = yield* buildCheckpointRefPrefix(input.threadId);
    const repo = yield* inspectWorktree(input.cwd);
    if (!repo) return { deletedCount: 0, deletedRefs: [] as ReadonlyArray<string> };

    const run = (args: ReadonlyArray<string>) =>
      runGit("deleteThreadCheckpoints", repo.topLevel, args);
    const refs = (yield* run(["for-each-ref", "--format=%(refname)", prefix])).stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const ref of refs) yield* run(["update-ref", "-d", ref]);
    return { deletedCount: refs.length, deletedRefs: refs };
  },
);

export class CheckpointService extends Context.Service<
  CheckpointService,
  {
    readonly captureCheckpoint: typeof captureCheckpoint;
    readonly restoreCheckpoint: typeof restoreCheckpoint;
    readonly diffCheckpointSummary: typeof diffCheckpointSummary;
    readonly deleteThreadCheckpoints: typeof deleteThreadCheckpoints;
  }
>()("scuttle/server/CheckpointService") {}

export const layer = Layer.effect(
  CheckpointService,
  Effect.sync(() =>
    CheckpointService.of({
      captureCheckpoint,
      restoreCheckpoint,
      diffCheckpointSummary,
      deleteThreadCheckpoints,
    }),
  ),
);
export const Live = layer;

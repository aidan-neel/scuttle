import * as NodeFS from "node:fs";
import type { Project, Thread, ThreadRuntime } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import type * as GitService from "./GitService.ts";

export interface ThreadLocationUpdate {
  readonly runtime: ThreadRuntime;
  readonly branch: string;
  readonly worktreePath: string | null;
  readonly cwd: string;
  readonly resetSession: boolean;
}

export const resolveThreadLocation = (input: {
  readonly existing: Thread;
  readonly project: Project;
  readonly nextRuntime: ThreadRuntime;
  readonly requestedBranch: string | undefined;
  readonly git: GitService.GitService["Service"];
}): Effect.Effect<ThreadLocationUpdate, string> =>
  Effect.gen(function* () {
    const { existing, project, nextRuntime, requestedBranch, git } = input;
    if (nextRuntime === existing.runtime) {
      return {
        runtime: existing.runtime,
        branch: requestedBranch?.trim() || existing.branch,
        worktreePath: existing.worktreePath ?? null,
        cwd: existing.cwd,
        resetSession: false,
      };
    }

    if (nextRuntime === "worktree") {
      if (existing.worktreePath && NodeFS.existsSync(existing.worktreePath)) {
        const inspected = yield* git.inspectRepo(existing.worktreePath);
        return {
          runtime: "worktree",
          branch: requestedBranch?.trim() || inspected.currentBranch,
          worktreePath: existing.worktreePath,
          cwd: existing.worktreePath,
          resetSession: true,
        };
      }
      const created = yield* git
        .createWorktree({
          repoPath: project.path,
          baseBranch: requestedBranch?.trim() || existing.branch,
          titleHint: existing.title,
          threadId: existing.id,
        })
        .pipe(Effect.mapError((err) => err.message));
      return {
        runtime: "worktree",
        branch: created.branch,
        worktreePath: created.worktreePath,
        cwd: created.worktreePath,
        resetSession: true,
      };
    }

    const inspected = yield* git.inspectRepo(project.path);
    return {
      runtime: "local",
      branch: requestedBranch?.trim() || inspected.currentBranch,
      worktreePath: existing.worktreePath ?? null,
      cwd: project.path,
      resetSession: true,
    };
  });

import type { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import type {
  CreateThreadInput,
  Project,
  Thread,
  ThreadRuntime,
  ThreadStatus,
} from "@scuttle/contracts";
import { ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "./EventBus.ts";
import type * as GitService from "./GitService.ts";
import { insertThreadRow, TITLE_LIMIT } from "./threadStore.ts";

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

export const createThreadWithLocation = (input: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly git: GitService.GitService["Service"];
  readonly project: Project;
  readonly title: string;
  readonly runtime: CreateThreadInput["runtime"];
  readonly branch: string;
  readonly modelSelection: CreateThreadInput["modelSelection"];
  readonly runtimeMode?: CreateThreadInput["runtimeMode"];
  readonly interactionMode?: CreateThreadInput["interactionMode"];
  readonly setupWorktree?: boolean;
  readonly initialStatus: ThreadStatus;
}): Effect.Effect<Thread, string> =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(crypto.randomUUID());
    let cwd = input.project.path;
    let branch = input.branch;
    let worktreePath: string | undefined;

    if (input.setupWorktree && input.runtime === "worktree") {
      const created = yield* input.git
        .createWorktree({
          repoPath: input.project.path,
          baseBranch: input.branch,
          titleHint: input.title,
          threadId,
        })
        .pipe(Effect.mapError((err) => err.message));
      cwd = created.worktreePath;
      worktreePath = created.worktreePath;
      branch = created.branch;
    }

    const now = new Date().toISOString();
    const thread = insertThreadRow(input.db, {
      id: threadId,
      projectId: input.project.id,
      projectName: input.project.name,
      title: input.title.trim().slice(0, TITLE_LIMIT) || input.project.name,
      runtime: input.runtime,
      branch,
      ...(worktreePath ? { worktreePath } : {}),
      cwd,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode ?? "auto",
      interactionMode: input.interactionMode ?? "default",
      status: input.initialStatus,
      now,
    });
    if (!thread) {
      return yield* Effect.fail("Failed to persist thread.");
    }
    input.eventBus.publishSync({ kind: "thread.upserted", thread });
    return thread;
  });

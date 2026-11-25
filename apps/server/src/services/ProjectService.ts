import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type {
  CreateProjectInput,
  DirectoryEntry,
  DirectoryListing,
  GitBranchInfo,
  Project,
} from "@scuttle/contracts";
import { ProjectId } from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sqlite from "../persistence/Sqlite.ts";
import { expandHome } from "../providers/catalog.ts";
import * as EventBus from "./EventBus.ts";
import * as GitService from "./GitService.ts";

export class ProjectServiceError extends Schema.TaggedError<ProjectServiceError>()(
  "ProjectServiceError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly is_git_repo: number;
  readonly default_branch: string;
  readonly last_message: string | null;
  readonly last_activity_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const rowToProject = (row: ProjectRow): Project => ({
  id: ProjectId.make(row.id),
  name: row.name,
  path: row.path,
  isGitRepo: row.is_git_repo === 1,
  defaultBranch: row.default_branch,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.last_message ? { lastMessage: row.last_message } : {}),
  ...(row.last_activity_at ? { lastActivityAt: row.last_activity_at } : {}),
});

export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
    readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectServiceError>;
    readonly create: (input: CreateProjectInput) => Effect.Effect<Project, ProjectServiceError>;
    readonly remove: (id: ProjectId) => Effect.Effect<void, ProjectServiceError>;
    readonly listBranches: (
      id: ProjectId,
    ) => Effect.Effect<ReadonlyArray<GitBranchInfo>, ProjectServiceError>;
    readonly touchActivity: (id: ProjectId, lastMessage: string) => Effect.Effect<void>;
    readonly listDirectory: (
      rawPath?: string,
    ) => Effect.Effect<DirectoryListing, ProjectServiceError>;
  }
>()("scuttle/server/ProjectService") {}

const make = Effect.gen(function* () {
  const { db } = yield* Sqlite.SqliteDatabase;
  const git = yield* GitService.GitService;
  const eventBus = yield* EventBus.EventBus;

  const list = () =>
    Effect.sync(() => {
      const rows = db
        .query<ProjectRow, []>(
          `SELECT id, name, path, is_git_repo, default_branch, last_message, last_activity_at, created_at, updated_at
           FROM projects
           ORDER BY COALESCE(last_activity_at, updated_at) DESC`,
        )
        .all();
      return rows.map(rowToProject);
    });

  const get = Effect.fn("ProjectService.get")(function* (id: ProjectId) {
    const row = db
      .query<ProjectRow, [string]>(
        `SELECT id, name, path, is_git_repo, default_branch, last_message, last_activity_at, created_at, updated_at
         FROM projects WHERE id = ?`,
      )
      .get(id);
    if (!row) {
      return yield* new ProjectServiceError({ detail: `Project "${id}" was not found.` });
    }
    return rowToProject(row);
  });

  const create = Effect.fn("ProjectService.create")(function* (input: CreateProjectInput) {
    const expanded = expandHome(input.path);
    const resolved = NodePath.resolve(expanded);
    if (!NodeFS.existsSync(resolved)) {
      return yield* new ProjectServiceError({ detail: `Directory does not exist: ${resolved}` });
    }
    if (!NodeFS.statSync(resolved).isDirectory()) {
      return yield* new ProjectServiceError({ detail: `Path is not a directory: ${resolved}` });
    }

    const inspection = yield* git.inspectRepo(resolved);
    const canonicalPath = inspection.isGitRepo ? inspection.rootPath : resolved;
    const existing = db
      .query<ProjectRow, [string]>(
        `SELECT id, name, path, is_git_repo, default_branch, last_message, last_activity_at, created_at, updated_at
         FROM projects WHERE path = ?`,
      )
      .get(canonicalPath);
    if (existing) {
      return rowToProject(existing);
    }

    const id = ProjectId.make(crypto.randomUUID());
    const name = input.name?.trim() || NodePath.basename(canonicalPath) || "project";
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO projects
         (id, name, path, is_git_repo, default_branch, last_message, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      id,
      name,
      canonicalPath,
      inspection.isGitRepo ? 1 : 0,
      inspection.defaultBranch,
      now,
      now,
    );

    const created: Project = {
      id,
      name,
      path: canonicalPath,
      isGitRepo: inspection.isGitRepo,
      defaultBranch: inspection.defaultBranch,
      createdAt: now,
      updatedAt: now,
    };
    yield* eventBus.publish({ kind: "project.upserted", project: created });
    return created;
  });

  const remove = Effect.fn("ProjectService.remove")(function* (id: ProjectId) {
    const existing = yield* get(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(existing.id);
    yield* eventBus.publish({ kind: "project.deleted", projectId: existing.id });
  });

  const listBranches = Effect.fn("ProjectService.listBranches")(function* (id: ProjectId) {
    const project = yield* get(id);
    return yield* git.listBranches(project.path);
  });

  const touchActivity = Effect.fn("ProjectService.touchActivity")(function* (
    id: ProjectId,
    lastMessage: string,
  ) {
    const now = new Date().toISOString();
    const snippet = lastMessage.trim().split(/\r?\n/)[0]?.slice(0, 120) ?? "";
    db.prepare(
      "UPDATE projects SET last_message = ?, last_activity_at = ?, updated_at = ? WHERE id = ?",
    ).run(snippet, now, now, id);
    const updated = yield* get(id).pipe(Effect.option);
    if (updated._tag === "Some") {
      yield* eventBus.publish({ kind: "project.upserted", project: updated.value });
    }
  });

  const listDirectory = Effect.fn("ProjectService.listDirectory")(function* (rawPath?: string) {
    const target =
      rawPath && rawPath.trim().length > 0
        ? NodePath.resolve(expandHome(rawPath))
        : NodeOS.homedir();
    if (!NodeFS.existsSync(target) || !NodeFS.statSync(target).isDirectory()) {
      return yield* new ProjectServiceError({ detail: `Directory not found: ${target}` });
    }

    const rawEntries = yield* Effect.try({
      try: () => NodeFS.readdirSync(target, { withFileTypes: true }),
      catch: () => new ProjectServiceError({ detail: `Cannot read directory: ${target}` }),
    });

    const entries: DirectoryEntry[] = [];
    for (const dirent of rawEntries) {
      if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
      const fullPath = NodePath.join(target, dirent.name);
      const isGitRepo = NodeFS.existsSync(NodePath.join(fullPath, ".git"));
      entries.push({ name: dirent.name, path: fullPath, isGitRepo });
    }
    entries.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parent = NodePath.dirname(target);
    return {
      path: target,
      parentPath: parent !== target ? parent : null,
      entries: entries.slice(0, 100),
    };
  });

  // Seed the current workspace directory if no projects exist yet so Scuttle is immediately usable.
  const existingCount = db
    .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM projects")
    .get();
  if ((existingCount?.count ?? 0) === 0) {
    const cwd = process.cwd();
    const initialPath =
      NodePath.basename(cwd) === "server" && NodePath.basename(NodePath.dirname(cwd)) === "apps"
        ? NodePath.resolve(cwd, "../..")
        : cwd;
    yield* create({ path: initialPath }).pipe(Effect.ignore);
  }

  return ProjectService.of({
    list,
    get,
    create,
    remove,
    listBranches,
    touchActivity,
    listDirectory,
  });
});

export const layer = Layer.effect(ProjectService, make);

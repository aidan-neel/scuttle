import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { presentToolActivity } from "../providers/toolLabel.ts";
import { startScuttleServer } from "../server.ts";
import * as EventBus from "./EventBus.ts";
import * as GitService from "./GitService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProviderService from "./ProviderService.ts";

const makeTestLayer = () => {
  const configLayer = ServerConfig.layer({ dbPath: ":memory:" });
  const sqliteLayer = Sqlite.layer.pipe(Layer.provide(configLayer));
  const eventBusLayer = EventBus.layer;
  const gitLayer = GitService.layer;
  const projectLayer = ProjectService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(gitLayer),
    Layer.provide(eventBusLayer),
  );
  const providerLayer = ProviderService.layer.pipe(
    Layer.provide(sqliteLayer),
    Layer.provide(eventBusLayer),
  );
  return Layer.mergeAll(
    configLayer,
    sqliteLayer,
    eventBusLayer,
    gitLayer,
    projectLayer,
    providerLayer,
  );
};

describe("Workspace server services", () => {
  it("seeds the current workspace project and lists its branches", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* ProjectService.ProjectService;
        const list = yield* projects.list();
        expect(list.length).toBeGreaterThanOrEqual(1);
        const first = list[0]!;
        const branches = yield* projects.listBranches(first.id);
        return { first, branches };
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(result.first.name.length).toBeGreaterThan(0);
    expect(result.branches.length).toBeGreaterThanOrEqual(1);
  });

  it("seeds all built-in multi-harness providers", async () => {
    const snapshots = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ProviderService.ProviderService;
        return yield* providers.listSnapshots();
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const kinds = snapshots.map((item) => item.kind);
    expect(kinds).toContain("claude");
    expect(kinds).toContain("codex");
    expect(kinds).toContain("antigravity");
    expect(kinds).toContain("opencode");
    expect(kinds).toContain("copilot");
  });

  it("formats Capy-style present and past tense tool labels", () => {
    const bash = presentToolActivity("Bash", { command: "git status" });
    expect(bash.activeLabel).toBe("Running a script");
    expect(bash.label).toBe("Ran a script");
    expect(bash.detail).toBe("git status");

    const read = presentToolActivity("Read", { file_path: "/repo/apps/server/src/server.ts" });
    expect(read.activeLabel).toBe("Reading src/server.ts");
    expect(read.label).toBe("Read src/server.ts");

    const search = presentToolActivity("Grep", { pattern: "ThreadService" });
    expect(search.activeLabel).toBe('Searching "ThreadService"');
    expect(search.label).toBe('Searched "ThreadService"');
  });

  it("serves /api/workspace and /api/providers over live HTTP", async () => {
    const server = await startScuttleServer({ port: 0, dbPath: ":memory:" });
    try {
      const wsRes = await fetch(`${server.url}/api/workspace`);
      expect(wsRes.status).toBe(200);
      const workspace = (await wsRes.json()) as {
        projects: unknown[];
        threads: unknown[];
        providers: { kind: string }[];
      };
      expect(workspace.projects.length).toBeGreaterThanOrEqual(1);
      expect(workspace.providers.length).toBe(5);

      const dirRes = await fetch(`${server.url}/api/fs/list`);
      expect(dirRes.status).toBe(200);
    } finally {
      await server.stop();
    }
  });
});

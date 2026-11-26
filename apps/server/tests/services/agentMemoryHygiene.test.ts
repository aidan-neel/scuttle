import { afterEach, describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { makeAppLayer } from "../../src/server.ts";
import * as Sqlite from "../../src/persistence/Sqlite.ts";
import * as AgentService from "../../src/services/AgentService.ts";
import * as ProjectService from "../../src/services/ProjectService.ts";
import {
  deleteMemoryRow,
  insertMemory,
  listMemories,
  searchMemories,
  toFtsMatchQuery,
  updateMemoryRow,
} from "../../src/services/agent/agentMemoryStore.ts";

describe("agent memory hygiene & FTS5", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()!;
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters stopwords and <2 char tokens, deduplicates, and caps at 12 high-signal tokens", () => {
    const q = toFtsMatchQuery(
      "the quick brown fox and the lazy dog with a x y z in sqlite fts5 sqlite cache token budget rollover epoch compaction delta header extra",
    );
    expect(q).not.toBeNull();
    const parts = q!.split(" OR ");
    expect(parts.length).toBe(12);
    expect(parts).not.toContain("the*");
    expect(parts).not.toContain("and*");
    expect(parts).not.toContain("a*");
    expect(parts).not.toContain("x*");
    expect(parts.filter((p) => p === "sqlite*")).toHaveLength(1);
    expect(parts).toContain("epoch*");
  });

  it("deduplicates creates by normalized title, excludes superseded/pinned rows on demand, keeps FTS5 atomic, and tracks hits", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-mem-test-"));
    tempRoots.push(root);
    const repo = NodePath.join(root, "repo");
    NodeFS.mkdirSync(repo, { recursive: true });

    const runtime = ManagedRuntime.make(makeAppLayer({ dbPath: ":memory:" }));
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { db } = yield* Sqlite.SqliteDatabase;
          const projects = yield* ProjectService.ProjectService;
          const agents = yield* AgentService.AgentService;

          const proj = yield* projects.create({ path: repo, name: "mem-repo" });
          const agent = (yield* agents.list()).find((a) => a.projectId === proj.id)!;

          // Write dedup on same (agentId, category) + normalized title.
          const first = yield* agents.createMemory(agent.id, {
            category: "fact",
            title: "  API   Port ",
            content: "Runs on port 4310",
            pinned: true,
          });
          const merged = yield* agents.createMemory(agent.id, {
            category: "fact",
            title: "api port",
            content: "Runs on port 4320",
            pinned: false,
          });
          expect(merged.id).toBe(first.id);
          expect(merged.content).toBe("Runs on port 4320");
          expect(merged.pinned).toBe(true);
          expect(yield* agents.listMemories(agent.id)).toHaveLength(1);

          // Same title in a different category creates a separate memory.
          const decisionMem = yield* agents.createMemory(agent.id, {
            category: "decision",
            title: "api port",
            content: "Keep ephemeral port in tests",
            pinned: false,
          });
          expect(decisionMem.id).not.toBe(first.id);

          // Pin crowding: excludePinned omits pinned rows so unpinned matches surface.
          const unpinnedMatches = searchMemories(db, agent.id, "port", 10, {
            excludePinned: true,
          });
          expect(unpinnedMatches.map((m) => m.id)).toEqual([decisionMem.id]);

          // Superseded rows are excluded from list and search.
          const supersededAt = new Date().toISOString();
          updateMemoryRow(db, { ...decisionMem, supersededAt, updatedAt: supersededAt });
          expect(listMemories(db, agent.id).map((m) => m.id)).toEqual([first.id]);
          expect(searchMemories(db, agent.id, "ephemeral", 10)).toHaveLength(0);

          // Context retrieval increments hitCount and sets lastAccessedAt.
          expect(first.hitCount).toBe(0);
          const ctx = yield* agents.buildAgentContext(agent.id, "port");
          expect(ctx).toContain("api port");
          const afterHit = (yield* agents.listMemories(agent.id)).find((m) => m.id === first.id)!;
          expect(afterHit.hitCount).toBe(1);
          expect(afterHit.lastAccessedAt).toBeDefined();

          // Transaction atomicity: insert + update + delete keep FTS5 in sync.
          const now = new Date().toISOString();
          const txMem = {
            ...first,
            id: "mem-tx-1" as never,
            title: "Atomic FTS check",
            content: "UniqueTokenAlpha",
            pinned: false,
            hitCount: 0,
            createdAt: now,
            updatedAt: now,
          };
          insertMemory(db, txMem);
          expect(searchMemories(db, agent.id, "UniqueTokenAlpha").map((m) => m.id)).toContain(
            txMem.id,
          );
          updateMemoryRow(db, { ...txMem, content: "UniqueTokenBeta", updatedAt: now });
          expect(searchMemories(db, agent.id, "UniqueTokenAlpha")).toHaveLength(0);
          expect(searchMemories(db, agent.id, "UniqueTokenBeta").map((m) => m.id)).toContain(
            txMem.id,
          );
          deleteMemoryRow(db, agent.id, txMem.id);
          expect(searchMemories(db, agent.id, "UniqueTokenBeta")).toHaveLength(0);
        }),
      );
    } finally {
      await runtime.dispose();
    }
  });
});

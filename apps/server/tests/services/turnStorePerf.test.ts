import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ActivityItem, ModelSelection, PendingApproval, ThreadTurn } from "@scuttle/contracts";
import {
  ActivityId,
  ApprovalId,
  ProjectId,
  ProviderId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";
import { startScuttleServer } from "../../src/server.ts";
import { LiveTurnBuffer } from "../../src/services/liveTurnBuffer.ts";
import {
  insertTurnRow,
  listAllThreads,
  readThreadById,
  readTurnsForThread,
  updateTurnOutcomeRow,
} from "../../src/services/threadStore.ts";
import {
  readApprovalById,
  readCompletedTurnCount,
  readRecentCompletedTitleTurns,
  readTurnById,
  readTurnChildren,
  readTurnStartedAt,
} from "../../src/services/turnQueries.ts";

const MODEL_SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude-default"),
  providerKind: "claude",
  model: "sonnet",
};

const seedDb = (): Database => {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON;");
  applyScuttleMigrations(db);
  const now = "2026-11-26T00:00:00.000Z";
  db.query(
    "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("project-1", "Scuttle", "/tmp/scuttle", now, now);
  db.query(
    `INSERT INTO threads
       (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', 'main', '/tmp/scuttle', 'claude-default', 'claude', 'sonnet', ?, ?, ?)`,
  ).run("thread-1", "project-1", "Scuttle", "Thread 1", JSON.stringify({ kind: "idle" }), now, now);
  return db;
};

const makeTurn = (id: string, userMessage: string): ThreadTurn => ({
  id: TurnId.make(id),
  threadId: ThreadId.make("thread-1"),
  userMessage,
  assistantMessage: "",
  thinkingText: "",
  status: "running",
  startedAt: "2026-11-26T00:01:00.000Z",
  modelSelection: MODEL_SELECTION,
  activities: [],
  approvals: [],
});

describe("turnStore performance and query invariants", () => {
  it("uses covering/index lookups with no SCAN or TEMP B-TREE for activities and approvals", () => {
    const db = seedDb();
    try {
      const activityPlan = db
        .query<{ readonly detail: string }, [string]>(
          "EXPLAIN QUERY PLAN SELECT * FROM activities WHERE thread_id = ? ORDER BY seq ASC",
        )
        .all("thread-1");
      const approvalPlan = db
        .query<{ readonly detail: string }, [string]>(
          "EXPLAIN QUERY PLAN SELECT * FROM approvals WHERE thread_id = ? ORDER BY created_at ASC",
        )
        .all("thread-1");

      const activityDetails = activityPlan.map((row) => row.detail).join(" | ");
      const approvalDetails = approvalPlan.map((row) => row.detail).join(" | ");

      expect(activityDetails).toContain("idx_activities_thread_seq");
      expect(activityDetails).not.toContain("SCAN");
      expect(activityDetails).not.toContain("TEMP B-TREE");

      expect(approvalDetails).toContain("idx_approvals_thread_created");
      expect(approvalDetails).not.toContain("SCAN");
      expect(approvalDetails).not.toContain("TEMP B-TREE");
    } finally {
      db.close();
    }
  });

  it("overlays buffered deltas before timer flush, flushes to SQLite, and deletes on completion", async () => {
    const db = seedDb();
    const buffer = new LiveTurnBuffer(db, 1_000);
    try {
      const turn = makeTurn("turn-live", "Stream something");
      insertTurnRow(db, 1, turn);

      buffer.update(turn.id, "Hello ", "Thinking...");

      const beforeFlush = readTurnById(db, turn.id, MODEL_SELECTION);
      expect(beforeFlush?.assistantMessage).toBe("");
      expect(beforeFlush?.thinkingText).toBe("");

      const overlaid = buffer.overlayTurn(beforeFlush!);
      expect(overlaid.assistantMessage).toBe("Hello ");
      expect(overlaid.thinkingText).toBe("Thinking...");

      buffer.flush(turn.id);
      const afterFlush = readTurnById(db, turn.id, MODEL_SELECTION);
      expect(afterFlush?.assistantMessage).toBe("Hello ");
      expect(afterFlush?.thinkingText).toBe("Thinking...");

      const completed: ThreadTurn = {
        ...turn,
        assistantMessage: "Hello world",
        thinkingText: "Thinking... done",
        status: "completed",
        completedAt: "2026-11-26T00:02:00.000Z",
        durationMs: 60_000,
      };
      updateTurnOutcomeRow(db, "thread-1", 0, completed);
      buffer.delete(turn.id);

      const postDelete = readTurnById(db, turn.id, MODEL_SELECTION)!;
      expect(buffer.overlayTurn(postDelete)).toBe(postDelete);
      expect(postDelete.assistantMessage).toBe("Hello world");
    } finally {
      buffer.dispose();
      db.close();
    }
  });

  it("reads single turns, turn children, approvals, and recent title turns matching readTurnsForThread", () => {
    const db = seedDb();
    try {
      const thread = readThreadById(db, "thread-1")!;
      for (let seq = 1; seq <= 4; seq += 1) {
        const turn = makeTurn(`turn-${seq}`, `Prompt ${seq}`);
        insertTurnRow(db, seq, turn);
        updateTurnOutcomeRow(db, thread.id, 0, {
          ...turn,
          assistantMessage: `Reply ${seq}`,
          thinkingText: `Thought ${seq}`,
          status: seq === 4 ? "failed" : "completed",
          completedAt: `2026-11-26T00:0${seq}:30.000Z`,
          durationMs: 1_000 * seq,
          costUsd: 0.25 * seq,
        });
      }

      const activity: ActivityItem = {
        id: ActivityId.make("act-1"),
        turnId: TurnId.make("turn-2"),
        threadId: ThreadId.make("thread-1"),
        kind: "command",
        label: "Ran test",
        activeLabel: "Running test",
        status: "completed",
        startedAt: "2026-11-26T00:02:00.000Z",
        completedAt: "2026-11-26T00:02:05.000Z",
        durationMs: 5_000,
      };
      db.query(
        `INSERT INTO activities
           (id, turn_id, thread_id, seq, kind, label, active_label, detail, status, started_at, completed_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      ).run(
        activity.id,
        activity.turnId,
        activity.threadId,
        1,
        activity.kind,
        activity.label,
        activity.activeLabel,
        activity.status,
        activity.startedAt,
        activity.completedAt ?? null,
        activity.durationMs ?? null,
      );

      const approval: PendingApproval = {
        id: ApprovalId.make("app-1"),
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-2"),
        kind: "permission",
        title: "Allow write",
        options: [{ id: "allow", label: "Allow" }],
        status: "resolved",
        selectedOptionId: "allow",
        createdAt: "2026-11-26T00:02:01.000Z",
      };
      db.query(
        `INSERT INTO approvals
           (id, thread_id, turn_id, kind, title, description, command, options_json, status, selected_option_id, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      ).run(
        approval.id,
        approval.threadId,
        approval.turnId,
        approval.kind,
        approval.title,
        JSON.stringify(approval.options),
        approval.status,
        approval.selectedOptionId ?? null,
        approval.createdAt,
      );

      const allTurns = readTurnsForThread(db, thread);
      const turn2 = readTurnById(db, "turn-2", MODEL_SELECTION);
      expect(turn2).toEqual(allTurns.find((t) => t.id === "turn-2") ?? null);
      expect(readTurnById(db, "missing", MODEL_SELECTION)).toBeNull();
      expect(readTurnChildren(db, "turn-2")).toEqual({
        activities: [activity],
        approvals: [approval],
      });
      expect(readApprovalById(db, "app-1")).toEqual(approval);
      expect(readTurnStartedAt(db, "turn-2")).toBe("2026-11-26T00:01:00.000Z");

      expect(readCompletedTurnCount(db, "thread-1")).toBe(3);
      expect(readRecentCompletedTitleTurns(db, "thread-1", 2)).toEqual([
        { userMessage: "Prompt 2", assistantMessage: "Reply 2" },
        { userMessage: "Prompt 3", assistantMessage: "Reply 3" },
      ]);

      const listed = listAllThreads(db);
      const single = readThreadById(db, "thread-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(single!);
      expect(single?.costUsd).toBeCloseTo(2.5, 6);
    } finally {
      db.close();
    }
  });

  it("caches static assets and gzips large JSON responses while preserving Vary and small responses", async () => {
    const tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "scuttle-http-perf-"));
    const webDistDir = NodePath.join(tmpDir, "web-dist");
    const assetsDir = NodePath.join(webDistDir, "assets");
    NodeFS.mkdirSync(assetsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(webDistDir, "index.html"), "<!doctype html><html></html>");
    NodeFS.writeFileSync(NodePath.join(assetsDir, "main-abc123.js"), "console.log('ok');");

    const dbPath = NodePath.join(tmpDir, "scuttle.db");
    const db = new Database(dbPath, { create: true });
    applyScuttleMigrations(db);
    const now = "2026-11-26T00:00:00.000Z";
    db.query(
      "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(ProjectId.make("project-http"), "HttpProject", tmpDir, now, now);
    db.query(
      `INSERT INTO threads
         (id, project_id, project_name, title, runtime, branch, cwd, provider_id, provider_kind, model, status_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'local', 'main', ?, 'claude-default', 'claude', 'sonnet', ?, ?, ?)`,
    ).run(
      "thread-large",
      "project-http",
      "HttpProject",
      "Large thread",
      tmpDir,
      JSON.stringify({ kind: "idle" }),
      now,
      now,
    );
    const largeTurn = makeTurn("turn-large", "x".repeat(6_000));
    insertTurnRow(db, 1, { ...largeTurn, threadId: ThreadId.make("thread-large") });
    db.close();

    const server = await startScuttleServer({ port: 0, dbPath, webDistDir });
    try {
      const assetRes = await fetch(`${server.url}/assets/main-abc123.js`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

      const indexRes = await fetch(`${server.url}/index.html`);
      expect(indexRes.status).toBe(200);
      expect(indexRes.headers.get("cache-control")).toBe("no-cache");

      const spaFallbackRes = await fetch(`${server.url}/threads/thread-large`);
      expect(spaFallbackRes.status).toBe(200);
      expect(spaFallbackRes.headers.get("cache-control")).toBe("no-cache");

      const smallRes = await fetch(`${server.url}/api/health`, {
        headers: { "Accept-Encoding": "gzip" },
      });
      expect(smallRes.status).toBe(200);
      expect(smallRes.headers.get("content-encoding")).toBeNull();

      const loopbackLargeRes = await fetch(`${server.url}/api/threads/thread-large`, {
        headers: {
          "Accept-Encoding": "gzip",
          Origin: "http://localhost:5173",
        },
      });
      expect(loopbackLargeRes.status).toBe(200);
      expect(loopbackLargeRes.headers.get("content-encoding")).toBeNull();

      const remoteLargeRes = await fetch(`${server.url}/api/threads/thread-large`, {
        headers: {
          Host: "scuttle.lan:4310",
          "Accept-Encoding": "gzip",
          Origin: "http://localhost:5173",
        },
      });
      expect(remoteLargeRes.status).toBe(200);
      expect(remoteLargeRes.headers.get("content-encoding")).toBe("gzip");
      expect(remoteLargeRes.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:5173",
      );
      const vary = remoteLargeRes.headers.get("vary") ?? "";
      expect(vary).toContain("Accept-Encoding");
      expect(vary).toContain("Origin");
    } finally {
      await server.stop();
      NodeFS.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

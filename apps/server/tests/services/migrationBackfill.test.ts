import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";

describe("migration backfill", () => {
  it("backfills parent_notified_at on existing settled delegations only when migrating the column", () => {
    const db = new Database(":memory:");
    try {
      db.run(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT UNIQUE, is_git_repo INTEGER DEFAULT 0, default_branch TEXT DEFAULT 'main', last_message TEXT, last_activity_at TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, project_name TEXT, title TEXT, runtime TEXT, branch TEXT, worktree_path TEXT, cwd TEXT, provider_id TEXT, provider_kind TEXT, model TEXT, effort TEXT, runtime_mode TEXT DEFAULT 'auto', interaction_mode TEXT DEFAULT 'default', status_json TEXT, settled_at TEXT, provider_session_id TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE agents (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, purpose TEXT DEFAULT '', primary_thread_id TEXT, runtime TEXT DEFAULT 'local', model_selection_json TEXT, model_stack_json TEXT DEFAULT '{}', instructions_md TEXT DEFAULT '', check_in_interval_minutes INTEGER, last_check_in_at TEXT, last_summary TEXT, needs_attention INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
        CREATE TABLE agent_delegations (id TEXT PRIMARY KEY, agent_id TEXT, parent_thread_id TEXT, child_thread_id TEXT, role TEXT, kind TEXT, title TEXT, brief TEXT, model_selection_json TEXT, status TEXT, issue_id TEXT, pr_url TEXT, result_summary TEXT, created_at TEXT, completed_at TEXT);
      `);
      db.run(`
        INSERT INTO agent_delegations (id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, created_at, completed_at)
        VALUES
          ('d-done', 'a1', 't0', 't1', 'fast', 'task', 'Old done', 'b', '{}', 'completed', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'),
          ('d-fail', 'a1', 't0', 't2', 'fast', 'task', 'Old fail', 'b', '{}', 'failed', '2026-01-01T00:00:00Z', NULL),
          ('d-run', 'a1', 't0', 't3', 'fast', 'task', 'Still running', 'b', '{}', 'running', '2026-01-01T00:00:00Z', NULL);
      `);

      applyScuttleMigrations(db);

      const rows = db
        .query<{ readonly id: string; readonly parent_notified_at: string | null }, []>(
          "SELECT id, parent_notified_at FROM agent_delegations ORDER BY id ASC",
        )
        .all();
      expect(rows).toEqual([
        { id: "d-done", parent_notified_at: "2026-01-01T01:00:00Z" },
        { id: "d-fail", parent_notified_at: "2026-01-01T00:00:00Z" },
        { id: "d-run", parent_notified_at: null },
      ]);

      db.run(`
        INSERT INTO agent_delegations (id, agent_id, parent_thread_id, child_thread_id, role, kind, title, brief, model_selection_json, status, created_at, completed_at, parent_notified_at)
        VALUES ('d-new', 'a1', 't0', 't4', 'fast', 'task', 'New settled', 'b', '{}', 'completed', '2026-02-01T00:00:00Z', '2026-02-01T01:00:00Z', NULL);
      `);
      applyScuttleMigrations(db);
      const afterSecondMigration = db
        .query<{ readonly parent_notified_at: string | null }, []>(
          "SELECT parent_notified_at FROM agent_delegations WHERE id = 'd-new'",
        )
        .get();
      expect(afterSecondMigration?.parent_notified_at).toBeNull();
    } finally {
      db.close();
    }
  });
});

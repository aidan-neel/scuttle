import type { Database } from "bun:sqlite";

export const applyScuttleMigrations = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS scuttle_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      is_git_repo INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT NOT NULL DEFAULT 'main',
      last_message TEXT,
      last_activity_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      binary_path TEXT NOT NULL DEFAULT '',
      launch_args TEXT NOT NULL DEFAULT '',
      default_model TEXT,
      default_effort TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      project_name TEXT NOT NULL,
      title TEXT NOT NULL,
      runtime TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT,
      cwd TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      effort TEXT,
      runtime_mode TEXT NOT NULL DEFAULT 'auto',
      interaction_mode TEXT NOT NULL DEFAULT 'default',
      status_json TEXT NOT NULL,
      settled_at TEXT,
      provider_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at DESC);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      assistant_message TEXT NOT NULL DEFAULT '',
      thinking_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      error TEXT,
      model_selection_json TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_turns_thread_id ON turns(thread_id, seq);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY NOT NULL,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      active_label TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_activities_turn_id ON activities(turn_id, seq);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      command TEXT,
      options_json TEXT NOT NULL,
      status TEXT NOT NULL,
      selected_option_id TEXT,
      created_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_approvals_turn_id ON approvals(turn_id);
  `);
};

import type { Database } from "bun:sqlite";

const ensureColumn = (db: Database, table: string, column: string, definition: string): boolean => {
  const columns = db.query<{ readonly name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (!columns.some((col) => col.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    return true;
  }
  return false;
};

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

  ensureColumn(db, "threads", "session_epoch", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "threads", "active_summary", "TEXT");
  ensureColumn(db, "threads", "last_context_hash", "TEXT");
  ensureColumn(db, "threads", "last_usage_json", "TEXT");
  ensureColumn(db, "threads", "compact_at_tokens", "INTEGER");

  db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      origin TEXT NOT NULL DEFAULT 'user',
      user_message TEXT NOT NULL,
      assistant_message TEXT NOT NULL DEFAULT '',
      thinking_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      cost_usd REAL NOT NULL DEFAULT 0,
      error TEXT,
      model_selection_json TEXT NOT NULL
    );
  `);

  ensureColumn(db, "turns", "origin", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "turns", "cost_usd", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "turns", "session_epoch", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "turns", "usage_json", "TEXT");

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

  db.run(`
    CREATE TABLE IF NOT EXISTS git_forge_accounts (
      forge TEXT PRIMARY KEY NOT NULL,
      host TEXT NOT NULL,
      auth_source TEXT NOT NULL,
      token TEXT NOT NULL,
      username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      primary_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      runtime TEXT NOT NULL DEFAULT 'local',
      model_selection_json TEXT NOT NULL,
      model_stack_json TEXT NOT NULL DEFAULT '{}',
      instructions_md TEXT NOT NULL DEFAULT '',
      check_in_interval_minutes INTEGER,
      last_check_in_at TEXT,
      last_summary TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      needs_attention INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "agents", "pinned", "INTEGER NOT NULL DEFAULT 0");

  db.run(`
    UPDATE agents
    SET purpose = ''
    WHERE purpose LIKE 'Persistent Captain for %Maintains project memory, triages issues, and delegates focused tasks and PRs.%';
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agents_primary_thread_id ON agents(primary_thread_id);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_id
    ON agent_memories(agent_id, pinned DESC, updated_at DESC);
  `);

  ensureColumn(db, "agent_memories", "last_accessed_at", "TEXT");
  ensureColumn(db, "agent_memories", "hit_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "agent_memories", "supersedes_id", "TEXT");
  ensureColumn(db, "agent_memories", "superseded_at", "TEXT");

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(
      id UNINDEXED,
      agent_id UNINDEXED,
      title,
      content
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_issues (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'backlog',
      labels_json TEXT NOT NULL DEFAULT '[]',
      external_url TEXT,
      assigned_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
      pr_number INTEGER,
      pr_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(agent_id, key)
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_issues_agent_id
    ON agent_issues(agent_id, updated_at DESC);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_delegations (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      child_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      brief TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      status TEXT NOT NULL,
      issue_id TEXT REFERENCES agent_issues(id) ON DELETE SET NULL,
      pr_url TEXT,
      result_summary TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_delegations_agent_id
    ON agent_delegations(agent_id, created_at DESC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_delegations_child_thread_id
    ON agent_delegations(child_thread_id);
  `);

  if (ensureColumn(db, "agent_delegations", "parent_notified_at", "TEXT")) {
    db.run(`
      UPDATE agent_delegations
      SET parent_notified_at = COALESCE(completed_at, created_at)
      WHERE status != 'running' AND parent_notified_at IS NULL;
    `);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_checkins (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      active_delegations INTEGER NOT NULL DEFAULT 0,
      open_prs INTEGER NOT NULL DEFAULT 0,
      open_issues INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_checkins_agent_id
    ON agent_checkins(agent_id, created_at DESC);
  `);
};

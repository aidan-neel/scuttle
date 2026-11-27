import type { Database } from "bun:sqlite";
import { ensureThreadFeatureSchemas } from "./threadSchemas.ts";

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
  ensureColumn(db, "turns", "attachments_json", "TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      ext TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_turns_thread_id ON turns(thread_id, seq);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_turns_thread_cost ON turns(thread_id, cost_usd);
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
    CREATE INDEX IF NOT EXISTS idx_activities_thread_seq ON activities(thread_id, seq);
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
    CREATE INDEX IF NOT EXISTS idx_approvals_thread_created ON approvals(thread_id, created_at);
  `);

  ensureColumn(db, "approvals", "questions_json", "TEXT");
  ensureColumn(db, "approvals", "answers_json", "TEXT");
  ensureColumn(db, "approvals", "dismissed", "INTEGER NOT NULL DEFAULT 0");

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
  ensureColumn(db, "agents", "identicon_style", "TEXT");

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

  ensureColumn(db, "agent_issues", "priority", "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, "agent_issues", "assignee_kind", "TEXT NOT NULL DEFAULT 'unassigned'");
  ensureColumn(db, "agent_issues", "assignee_agent_id", "TEXT");
  ensureColumn(db, "agent_issues", "created_by", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "agent_issues", "due_date", "TEXT");
  ensureColumn(db, "agent_issues", "related_issue_id", "TEXT");
  ensureColumn(db, "agent_issues", "agent_notified_at", "TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_issue_activities (
      id TEXT PRIMARY KEY NOT NULL,
      issue_id TEXT NOT NULL REFERENCES agent_issues(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      actor_kind TEXT NOT NULL DEFAULT 'user',
      actor_agent_id TEXT,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_issue_activities_issue_id
    ON agent_issue_activities(issue_id, created_at ASC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_issue_activities_agent_created
    ON agent_issue_activities(agent_id, created_at DESC);
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
      WHERE status NOT IN ('running', 'waiting_parent') AND parent_notified_at IS NULL;
    `);
  }

  ensureColumn(db, "agent_delegations", "bounce_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "agent_delegations", "max_bounces", "INTEGER NOT NULL DEFAULT 3");

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_delegation_questions (
      id TEXT PRIMARY KEY NOT NULL,
      delegation_id TEXT NOT NULL REFERENCES agent_delegations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      child_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      parent_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      question TEXT NOT NULL,
      attempted TEXT,
      context TEXT,
      status TEXT NOT NULL,
      answer TEXT,
      error TEXT,
      bounce_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      answered_at TEXT
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_delegation_questions_delegation_id
    ON agent_delegation_questions(delegation_id, created_at ASC);
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_agent_delegation_questions_agent_status
    ON agent_delegation_questions(agent_id, status, created_at ASC);
  `);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS model_tier_configs (
      scope_key TEXT PRIMARY KEY NOT NULL,
      scope_kind TEXT NOT NULL,
      target_id TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_turns_started_at ON turns(started_at);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_source_files (
      source_key TEXT PRIMARY KEY NOT NULL,
      provider_kind TEXT NOT NULL,
      session_id TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_source_files_provider
    ON usage_source_files(provider_kind, session_id);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_buckets (
      source_key TEXT NOT NULL REFERENCES usage_source_files(source_key) ON DELETE CASCADE,
      provider_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      bucket_hour TEXT NOT NULL,
      session_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (source_key, model, bucket_hour)
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_usage_buckets_hour
    ON usage_buckets(bucket_hour, provider_kind);
  `);
  ensureThreadFeatureSchemas(db);
};

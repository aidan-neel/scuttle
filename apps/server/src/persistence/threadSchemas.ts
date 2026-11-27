import type { Database } from "bun:sqlite";

export const ensureThreadFeatureSchemas = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS thread_checkpoints (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      ordinal INTEGER NOT NULL,
      ref TEXT NOT NULL,
      commit_oid TEXT NOT NULL,
      files_changed INTEGER NOT NULL DEFAULT 0,
      insertions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_thread_checkpoints_thread_ordinal
    ON thread_checkpoints(thread_id, ordinal ASC);
    CREATE TABLE IF NOT EXISTS queued_turns (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      attachments_json TEXT,
      model_selection_json TEXT,
      runtime_mode TEXT,
      interaction_mode TEXT,
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queued_turns_thread_pos
    ON queued_turns(thread_id, status, position ASC);
    CREATE TABLE IF NOT EXISTS thread_visualizations (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thread_visualizations_thread
    ON thread_visualizations(thread_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_thread_visualizations_turn
    ON thread_visualizations(turn_id);
    CREATE TABLE IF NOT EXISTS model_performance_runs (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      effort TEXT,
      thread_id TEXT,
      turn_id TEXT,
      delegation_id TEXT,
      duration_ms REAL NOT NULL DEFAULT 0,
      first_token_ms REAL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      tokens_per_second REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      category TEXT,
      score REAL,
      outcome TEXT,
      rework TEXT,
      notes TEXT,
      rated_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_model_perf_model_category_created
    ON model_performance_runs(model, category, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_perf_turn_id ON model_performance_runs(turn_id);
    CREATE INDEX IF NOT EXISTS idx_model_perf_delegation_id ON model_performance_runs(delegation_id);
    CREATE INDEX IF NOT EXISTS idx_model_perf_thread_id ON model_performance_runs(thread_id);
  `);
};

import type { Database } from "bun:sqlite";
import { type AgentMemory, AgentMemoryCategory, AgentMemorySource } from "@scuttle/contracts";
import { AgentId, AgentMemoryId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

interface MemoryRow {
  readonly id: string;
  readonly agent_id: string;
  readonly category: string;
  readonly title: string;
  readonly content: string;
  readonly pinned: number;
  readonly source: string;
  readonly last_accessed_at: string | null;
  readonly hit_count: number;
  readonly supersedes_id: string | null;
  readonly superseded_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const decodeMemoryCategory = Schema.decodeUnknownOption(AgentMemoryCategory);
const decodeMemorySource = Schema.decodeUnknownOption(AgentMemorySource);

const FTS_STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "again",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "get",
  "got",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "let",
  "like",
  "make",
  "may",
  "me",
  "might",
  "more",
  "most",
  "my",
  "near",
  "need",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "please",
  "same",
  "see",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "use",
  "used",
  "using",
  "very",
  "want",
  "was",
  "way",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const rowToMemory = (row: MemoryRow): AgentMemory => {
  const categoryOpt = decodeMemoryCategory(row.category);
  const sourceOpt = decodeMemorySource(row.source);
  return {
    id: AgentMemoryId.make(row.id),
    agentId: AgentId.make(row.agent_id),
    category: categoryOpt._tag === "Some" ? categoryOpt.value : "fact",
    title: row.title,
    content: row.content,
    pinned: row.pinned === 1,
    source: sourceOpt._tag === "Some" ? sourceOpt.value : "user",
    ...(row.last_accessed_at !== null ? { lastAccessedAt: row.last_accessed_at } : {}),
    hitCount: row.hit_count,
    ...(row.supersedes_id !== null ? { supersedesId: AgentMemoryId.make(row.supersedes_id) } : {}),
    ...(row.superseded_at !== null ? { supersededAt: row.superseded_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const normalizeMemoryTitle = (title: string): string =>
  title.trim().toLowerCase().replace(/\s+/g, " ");

export const toFtsMatchQuery = (raw: string): string | null => {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawToken of raw.trim().split(/[^a-zA-Z0-9_]+/)) {
    if (rawToken.length < 2) continue;
    const lower = rawToken.toLowerCase();
    if (FTS_STOPWORDS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    tokens.push(rawToken);
    if (tokens.length >= 12) break;
  }
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}*`).join(" OR ");
};

export const listMemories = (
  db: Database,
  agentId: string,
  limit = 100,
  options?: { readonly excludePinned?: boolean },
): ReadonlyArray<AgentMemory> => {
  const pinClause = options?.excludePinned ? "AND pinned = 0" : "";
  return db
    .query<MemoryRow, [string, number]>(
      `SELECT * FROM agent_memories
       WHERE agent_id = ? AND superseded_at IS NULL ${pinClause}
       ORDER BY pinned DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map(rowToMemory);
};

export const searchMemories = (
  db: Database,
  agentId: string,
  query: string,
  limit = 20,
  options?: { readonly excludePinned?: boolean },
): ReadonlyArray<AgentMemory> => {
  const trimmed = query.trim();
  if (trimmed.length === 0) return listMemories(db, agentId, limit, options);

  const results: AgentMemory[] = [];
  const seen = new Set<string>();
  const ftsQuery = toFtsMatchQuery(trimmed);
  const ftsPinClause = options?.excludePinned ? "AND m.pinned = 0" : "";
  const likePinClause = options?.excludePinned ? "AND pinned = 0" : "";

  if (ftsQuery !== null) {
    try {
      const ftsRows = db
        .query<MemoryRow, [string, string, number]>(
          `SELECT m.*
           FROM agent_memories_fts f
           JOIN agent_memories m ON m.id = f.id
           WHERE f.agent_id = ? AND m.superseded_at IS NULL ${ftsPinClause}
             AND agent_memories_fts MATCH ?
           ORDER BY m.pinned DESC, bm25(agent_memories_fts) ASC, m.updated_at DESC
           LIMIT ?`,
        )
        .all(agentId, ftsQuery, limit);
      for (const row of ftsRows) {
        seen.add(row.id);
        results.push(rowToMemory(row));
      }
    } catch {
      // Fall back to LIKE search below if FTS5 rejects an edge-case query.
    }
  }

  if (results.length < limit) {
    const pattern = `%${trimmed.toLowerCase()}%`;
    const fallbackRows = db
      .query<MemoryRow, [string, string, string, number]>(
        `SELECT * FROM agent_memories
         WHERE agent_id = ? AND superseded_at IS NULL ${likePinClause}
           AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(agentId, pattern, pattern, limit);
    for (const row of fallbackRows) {
      if (!seen.has(row.id) && results.length < limit) {
        seen.add(row.id);
        results.push(rowToMemory(row));
      }
    }
  }

  return results;
};

export const readMemoryById = (
  db: Database,
  agentId: string,
  memoryId: string,
): AgentMemory | null => {
  const row = db
    .query<MemoryRow, [string, string]>(
      "SELECT * FROM agent_memories WHERE id = ? AND agent_id = ?",
    )
    .get(memoryId, agentId);
  return row ? rowToMemory(row) : null;
};

export const findActiveMemoryByNormalizedTitle = (
  db: Database,
  agentId: string,
  category: AgentMemory["category"],
  title: string,
): AgentMemory | null => {
  const target = normalizeMemoryTitle(title);
  const rows = db
    .query<MemoryRow, [string, string]>(
      `SELECT * FROM agent_memories
       WHERE agent_id = ? AND category = ? AND superseded_at IS NULL
       ORDER BY updated_at DESC`,
    )
    .all(agentId, category);
  for (const row of rows) {
    if (normalizeMemoryTitle(row.title) === target) {
      return rowToMemory(row);
    }
  }
  return null;
};

export const insertMemory = (db: Database, memory: AgentMemory): void => {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_memories
         (id, agent_id, category, title, content, pinned, source, last_accessed_at, hit_count, supersedes_id, superseded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      memory.id,
      memory.agentId,
      memory.category,
      memory.title,
      memory.content,
      memory.pinned ? 1 : 0,
      memory.source,
      memory.lastAccessedAt ?? null,
      memory.hitCount ?? 0,
      memory.supersedesId ?? null,
      memory.supersededAt ?? null,
      memory.createdAt,
      memory.updatedAt,
    );
    db.prepare(
      "INSERT INTO agent_memories_fts (id, agent_id, title, content) VALUES (?, ?, ?, ?)",
    ).run(memory.id, memory.agentId, memory.title, memory.content);
  })();
};

export const updateMemoryRow = (db: Database, memory: AgentMemory): void => {
  db.transaction(() => {
    db.prepare(
      `UPDATE agent_memories
       SET category = ?, title = ?, content = ?, pinned = ?, last_accessed_at = ?, hit_count = ?,
           supersedes_id = ?, superseded_at = ?, updated_at = ?
       WHERE id = ? AND agent_id = ?`,
    ).run(
      memory.category,
      memory.title,
      memory.content,
      memory.pinned ? 1 : 0,
      memory.lastAccessedAt ?? null,
      memory.hitCount ?? 0,
      memory.supersedesId ?? null,
      memory.supersededAt ?? null,
      memory.updatedAt,
      memory.id,
      memory.agentId,
    );
    db.prepare("DELETE FROM agent_memories_fts WHERE id = ?").run(memory.id);
    if (!memory.supersededAt) {
      db.prepare(
        "INSERT INTO agent_memories_fts (id, agent_id, title, content) VALUES (?, ?, ?, ?)",
      ).run(memory.id, memory.agentId, memory.title, memory.content);
    }
  })();
};

export const deleteMemoryRow = (db: Database, agentId: string, memoryId: string): void => {
  db.transaction(() => {
    db.prepare("DELETE FROM agent_memories_fts WHERE id = ?").run(memoryId);
    db.prepare("DELETE FROM agent_memories WHERE id = ? AND agent_id = ?").run(memoryId, agentId);
  })();
};

export const recordMemoryAccess = (
  db: Database,
  memoryIds: ReadonlyArray<string>,
  accessedAt: string,
): void => {
  if (memoryIds.length === 0) return;
  db.transaction(() => {
    const stmt = db.prepare(
      "UPDATE agent_memories SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE id = ?",
    );
    for (const id of memoryIds) {
      stmt.run(accessedAt, id);
    }
  })();
};

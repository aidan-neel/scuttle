import type { Database } from "bun:sqlite";
import type { Agent, AgentMemory, CreateMemoryInput, UpdateMemoryInput } from "@scuttle/contracts";
import { type AgentId, AgentMemoryId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import {
  deleteMemoryRow,
  insertMemory,
  listMemories,
  readMemoryById,
  searchMemories as searchMemoriesStore,
  updateMemoryRow,
} from "./agentStore.ts";
import { AgentServiceError } from "./errors.ts";

export const makeAgentMemoryOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
}) => {
  const { db, eventBus, requireAgent } = deps;

  const list = Effect.fn("AgentService.listMemories")(function* (agentId: AgentId, query?: string) {
    yield* requireAgent(agentId);
    return query && query.trim().length > 0
      ? searchMemoriesStore(db, agentId, query, 100)
      : listMemories(db, agentId, 100);
  });

  const search = Effect.fn("AgentService.searchMemories")(function* (
    agentId: AgentId,
    query: string,
    limit = 20,
  ) {
    yield* requireAgent(agentId);
    return searchMemoriesStore(db, agentId, query, limit);
  });

  const create = Effect.fn("AgentService.createMemory")(function* (
    agentId: AgentId,
    input: CreateMemoryInput,
  ) {
    yield* requireAgent(agentId);
    const now = new Date().toISOString();
    const memory: AgentMemory = {
      id: AgentMemoryId.make(crypto.randomUUID()),
      agentId,
      category: input.category,
      title: input.title.trim(),
      content: input.content.trim(),
      pinned: input.pinned ?? false,
      source: input.source ?? "user",
      createdAt: now,
      updatedAt: now,
    };
    insertMemory(db, memory);
    eventBus.publishSync({ kind: "agent.memory.upserted", memory });
    return memory;
  });

  const update = Effect.fn("AgentService.updateMemory")(function* (
    agentId: AgentId,
    memoryId: AgentMemoryId,
    input: UpdateMemoryInput,
  ) {
    yield* requireAgent(agentId);
    const existing = readMemoryById(db, agentId, memoryId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Memory "${memoryId}" was not found.`,
      });
    }
    const updated: AgentMemory = {
      ...existing,
      category: input.category ?? existing.category,
      title: input.title?.trim() || existing.title,
      content: input.content?.trim() || existing.content,
      pinned: input.pinned ?? existing.pinned,
      updatedAt: new Date().toISOString(),
    };
    updateMemoryRow(db, updated);
    eventBus.publishSync({ kind: "agent.memory.upserted", memory: updated });
    return updated;
  });

  const remove = Effect.fn("AgentService.deleteMemory")(function* (
    agentId: AgentId,
    memoryId: AgentMemoryId,
  ) {
    yield* requireAgent(agentId);
    const existing = readMemoryById(db, agentId, memoryId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Memory "${memoryId}" was not found.`,
      });
    }
    deleteMemoryRow(db, agentId, memoryId);
    eventBus.publishSync({ kind: "agent.memory.deleted", agentId, memoryId });
  });

  return { list, search, create, update, remove };
};

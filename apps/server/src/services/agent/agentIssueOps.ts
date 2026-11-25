import type { Database } from "bun:sqlite";
import type { Agent, AgentIssue, CreateIssueInput, UpdateIssueInput } from "@scuttle/contracts";
import { type AgentId, AgentIssueId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import type * as GitService from "../GitService.ts";
import type { FetchFn } from "../gitForge/forgeHttp.ts";
import type { CommandRunner } from "../gitForge/processRunner.ts";
import {
  deleteIssueRow,
  insertIssue,
  listIssues,
  nextIssueKey,
  readIssueById,
  readIssueByKey,
  updateIssueRow,
} from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";
import { syncForgeIssuesForAgent } from "./forgeIssues.ts";

export const makeAgentIssueOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly git: GitService.GitService["Service"];
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
}) => {
  const { db, eventBus, git, runner, fetch, requireAgent } = deps;

  const list = Effect.fn("AgentService.listIssues")(function* (agentId: AgentId) {
    yield* requireAgent(agentId);
    return listIssues(db, agentId);
  });

  const create = Effect.fn("AgentService.createIssue")(function* (
    agentId: AgentId,
    input: CreateIssueInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const key = input.key?.trim() || nextIssueKey(db, agent.id, agent.projectName);
    if (readIssueByKey(db, agent.id, key) !== null) {
      return yield* new AgentServiceError({
        reason: "invalid",
        detail: `Issue key "${key}" already exists for this agent.`,
      });
    }
    const now = new Date().toISOString();
    const issue: AgentIssue = {
      id: AgentIssueId.make(crypto.randomUUID()),
      agentId: agent.id,
      key,
      title: input.title.trim(),
      description: input.description ?? "",
      state: input.state ?? "backlog",
      labels: [...(input.labels ?? [])],
      ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
      ...(input.prUrl ? { prUrl: input.prUrl } : {}),
      createdAt: now,
      updatedAt: now,
    };
    insertIssue(db, issue);
    eventBus.publishSync({ kind: "agent.issue.upserted", issue });
    return issue;
  });

  const update = Effect.fn("AgentService.updateIssue")(function* (
    agentId: AgentId,
    issueId: AgentIssueId,
    input: UpdateIssueInput,
  ) {
    yield* requireAgent(agentId);
    const existing = readIssueById(db, agentId, issueId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Issue "${issueId}" was not found.`,
      });
    }
    const nextExternal =
      input.externalUrl === undefined
        ? existing.externalUrl
        : input.externalUrl === null
          ? undefined
          : input.externalUrl;
    const nextThread =
      input.assignedThreadId === undefined
        ? existing.assignedThreadId
        : input.assignedThreadId === null
          ? undefined
          : input.assignedThreadId;
    const nextPrNum =
      input.prNumber === undefined
        ? existing.prNumber
        : input.prNumber === null
          ? undefined
          : input.prNumber;
    const nextPrUrl =
      input.prUrl === undefined ? existing.prUrl : input.prUrl === null ? undefined : input.prUrl;

    const updated: AgentIssue = {
      id: existing.id,
      agentId: existing.agentId,
      key: existing.key,
      title: input.title?.trim() || existing.title,
      description: input.description !== undefined ? input.description : existing.description,
      state: input.state ?? existing.state,
      labels: input.labels ? [...input.labels] : existing.labels,
      ...(nextExternal !== undefined ? { externalUrl: nextExternal } : {}),
      ...(nextThread !== undefined ? { assignedThreadId: nextThread } : {}),
      ...(nextPrNum !== undefined ? { prNumber: nextPrNum } : {}),
      ...(nextPrUrl !== undefined ? { prUrl: nextPrUrl } : {}),
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    updateIssueRow(db, updated);
    eventBus.publishSync({ kind: "agent.issue.upserted", issue: updated });
    return updated;
  });

  const remove = Effect.fn("AgentService.deleteIssue")(function* (
    agentId: AgentId,
    issueId: AgentIssueId,
  ) {
    yield* requireAgent(agentId);
    const existing = readIssueById(db, agentId, issueId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Issue "${issueId}" was not found.`,
      });
    }
    deleteIssueRow(db, agentId, issueId);
    eventBus.publishSync({ kind: "agent.issue.deleted", agentId, issueId });
  });

  const sync = Effect.fn("AgentService.syncIssues")(function* (agentId: AgentId) {
    const agent = yield* requireAgent(agentId);
    const result = yield* syncForgeIssuesForAgent({
      db,
      git,
      runner,
      fetch,
      agent,
    });
    for (const issue of result.upserted) {
      eventBus.publishSync({ kind: "agent.issue.upserted", issue });
    }
    return result.all;
  });

  return { list, create, update, remove, sync };
};

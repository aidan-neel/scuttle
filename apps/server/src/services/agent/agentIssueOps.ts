import type { Database } from "bun:sqlite";
import type {
  Agent,
  AgentIssue,
  AgentIssueActivity,
  AgentIssueActivityKind,
  AgentIssueAssignee,
  AgentIssueState,
  CreateIssueCommentInput,
  CreateIssueInput,
  IssueActorKind,
  SendTurnInput,
  ThreadTurn,
  TurnOrigin,
  UpdateIssueInput,
} from "@scuttle/contracts";
import { type AgentId, AgentIssueActivityId, AgentIssueId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import type * as EventBus from "../EventBus.ts";
import type * as GitService from "../GitService.ts";
import type { FetchFn } from "../gitForge/forgeHttp.ts";
import type { CommandRunner } from "../gitForge/processRunner.ts";
import { readAgentById, updateAgentRow } from "./agentStore.ts";
import {
  deleteIssueRow,
  insertIssue,
  insertIssueActivity,
  listAllIssues,
  listIssueActivities,
  listIssues,
  nextIssueKey,
  readIssueById,
  readIssueByKey,
  updateIssueRow,
} from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";
import { syncForgeIssuesForAgent } from "./forgeIssues.ts";

const STATE_LABELS: Record<AgentIssueState, string> = {
  needs_you: "Needs you",
  in_review: "In review",
  in_progress: "In progress",
  waiting: "Waiting",
  todo: "Todo",
  backlog: "Backlog",
  done: "Done",
  canceled: "Canceled",
};

const assigneeEquals = (a: AgentIssueAssignee, b: AgentIssueAssignee): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "agent" && b.kind === "agent") return a.agentId === b.agentId;
  return true;
};

const describeAssignee = (db: Database, assignee: AgentIssueAssignee): string => {
  if (assignee.kind === "unassigned") return "Unassigned";
  if (assignee.kind === "user") return "User";
  const agent = readAgentById(db, assignee.agentId);
  return agent ? agent.name : assignee.agentId;
};

const buildIssueUpdatePrompt = (input: {
  readonly issue: AgentIssue;
  readonly summary: string;
  readonly detail?: string;
}): string => {
  const { issue, summary, detail } = input;
  return [
    `Issue update on **${issue.key}: ${issue.title}** (${issue.id}).`,
    `Status: ${STATE_LABELS[issue.state]} · Priority: ${issue.priority}.`,
    summary,
    ...(detail && detail.trim().length > 0 ? ["", detail.trim()] : []),
    "",
    `Update via REST with \`"actor":"agent"\`: PATCH \`$SCUTTLE_API_URL/api/agents/${issue.agentId}/issues/${issue.id}\` or comment via POST \`$SCUTTLE_API_URL/api/agents/${issue.agentId}/issues/${issue.id}/comments\`. Set \`"state":"needs_you"\` (and optionally \`"assignee":{"kind":"user"}\`) if you need user input.`,
  ].join("\n");
};

export const makeAgentIssueOps = (deps: {
  readonly db: Database;
  readonly eventBus: EventBus.EventBus["Service"];
  readonly git: GitService.GitService["Service"];
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
  readonly requireAgent: (agentId: AgentId) => Effect.Effect<Agent, AgentServiceError>;
  readonly sendAgentTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
}) => {
  const { db, eventBus, git, runner, fetch, requireAgent, sendAgentTurn } = deps;

  const recordActivity = (input: {
    readonly issueId: AgentIssueId;
    readonly agentId: AgentId;
    readonly actorKind: IssueActorKind;
    readonly actorAgentId?: AgentId;
    readonly kind: AgentIssueActivityKind;
    readonly body: string;
    readonly createdAt: string;
  }): AgentIssueActivity => {
    const activity: AgentIssueActivity = {
      id: AgentIssueActivityId.make(crypto.randomUUID()),
      issueId: input.issueId,
      agentId: input.agentId,
      actorKind: input.actorKind,
      ...(input.actorAgentId !== undefined ? { actorAgentId: input.actorAgentId } : {}),
      kind: input.kind,
      body: input.body,
      createdAt: input.createdAt,
    };
    insertIssueActivity(db, activity);
    eventBus.publishSync({ kind: "agent.issue.activity.created", activity });
    return activity;
  };

  const setAgentAttention = (agentId: AgentId, summary: string, now: string): void => {
    const agent = readAgentById(db, agentId);
    if (!agent) return;
    const next: Agent = {
      ...agent,
      needsAttention: true,
      lastSummary: summary.slice(0, 220),
      updatedAt: now,
    };
    updateAgentRow(db, next);
    eventBus.publishSync({ kind: "agent.upserted", agent: next });
  };

  const clearAttentionIfResolved = (agentId: AgentId, now: string): void => {
    const agent = readAgentById(db, agentId);
    if (!agent || !agent.needsAttention) return;
    const stillNeedsYou = listIssues(db, agentId).some((i) => i.state === "needs_you");
    if (stillNeedsYou) return;
    const next: Agent = { ...agent, needsAttention: false, updatedAt: now };
    updateAgentRow(db, next);
    eventBus.publishSync({ kind: "agent.upserted", agent: next });
  };

  const notifyAgent = (targetAgentId: AgentId, prompt: string) =>
    sendAgentTurn(targetAgentId, { prompt }, { origin: "system" }).pipe(Effect.ignore);

  const listAll = () => Effect.sync(() => listAllIssues(db));

  const list = Effect.fn("AgentService.listIssues")(function* (agentId: AgentId) {
    yield* requireAgent(agentId);
    return listIssues(db, agentId);
  });

  const listActivities = Effect.fn("AgentService.listIssueActivities")(function* (
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
    return listIssueActivities(db, issueId);
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
    const actor: IssueActorKind = input.actor ?? "user";
    const now = new Date().toISOString();
    const issue: AgentIssue = {
      id: AgentIssueId.make(crypto.randomUUID()),
      agentId: agent.id,
      key,
      title: input.title.trim(),
      description: input.description ?? "",
      state: input.state ?? "todo",
      priority: input.priority ?? "normal",
      assignee: input.assignee ?? { kind: "unassigned" },
      createdBy: input.createdBy ?? actor,
      labels: [...(input.labels ?? [])],
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.relatedIssueId ? { relatedIssueId: input.relatedIssueId } : {}),
      ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
      ...(input.prUrl ? { prUrl: input.prUrl } : {}),
      createdAt: now,
      updatedAt: now,
    };
    insertIssue(db, issue);
    recordActivity({
      issueId: issue.id,
      agentId: agent.id,
      actorKind: actor,
      ...(actor === "agent" ? { actorAgentId: agent.id } : {}),
      kind: "created",
      body: `Created issue in ${STATE_LABELS[issue.state]}.`,
      createdAt: now,
    });
    eventBus.publishSync({ kind: "agent.issue.upserted", issue });

    if (actor === "agent") {
      if (issue.state === "needs_you" || issue.assignee.kind === "user") {
        setAgentAttention(agent.id, `[${issue.key}] Needs you: ${issue.title}`, now);
      }
    } else if (input.notifyAgent !== false && issue.assignee.kind === "agent") {
      yield* notifyAgent(
        issue.assignee.agentId,
        buildIssueUpdatePrompt({
          issue,
          summary: "You were assigned this new issue.",
          detail: issue.description,
        }),
      );
    }

    return issue;
  });

  const update = Effect.fn("AgentService.updateIssue")(function* (
    agentId: AgentId,
    issueId: AgentIssueId,
    input: UpdateIssueInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const existing = readIssueById(db, agentId, issueId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Issue "${issueId}" was not found.`,
      });
    }
    const resolveOptional = <T>(incoming: T | null | undefined, current: T | undefined) =>
      incoming === undefined ? current : incoming === null ? undefined : incoming;

    const nextDueDate = resolveOptional(input.dueDate, existing.dueDate);
    const nextRelated = resolveOptional(input.relatedIssueId, existing.relatedIssueId);
    const nextExternal = resolveOptional(input.externalUrl, existing.externalUrl);
    const nextThread = resolveOptional(input.assignedThreadId, existing.assignedThreadId);
    const nextPrNum = resolveOptional(input.prNumber, existing.prNumber);
    const nextPrUrl = resolveOptional(input.prUrl, existing.prUrl);
    const nextState = input.state ?? existing.state;
    const nextPriority = input.priority ?? existing.priority;
    const nextAssignee = input.assignee ?? existing.assignee;
    const nextTitle = input.title?.trim() || existing.title;
    const nextDescription =
      input.description !== undefined ? input.description : existing.description;
    const now = new Date().toISOString();

    const updated: AgentIssue = {
      id: existing.id,
      agentId: existing.agentId,
      key: existing.key,
      title: nextTitle,
      description: nextDescription,
      state: nextState,
      priority: nextPriority,
      assignee: nextAssignee,
      createdBy: existing.createdBy,
      labels: input.labels ? [...input.labels] : existing.labels,
      ...(nextDueDate !== undefined ? { dueDate: nextDueDate } : {}),
      ...(nextRelated !== undefined ? { relatedIssueId: nextRelated } : {}),
      ...(existing.commentCount !== undefined ? { commentCount: existing.commentCount } : {}),
      ...(nextExternal !== undefined ? { externalUrl: nextExternal } : {}),
      ...(nextThread !== undefined ? { assignedThreadId: nextThread } : {}),
      ...(nextPrNum !== undefined ? { prNumber: nextPrNum } : {}),
      ...(nextPrUrl !== undefined ? { prUrl: nextPrUrl } : {}),
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    updateIssueRow(db, updated);

    const actor: IssueActorKind = input.actor ?? "user";
    const actorAgentId = actor === "agent" ? agent.id : undefined;
    const changes: string[] = [];

    if (nextState !== existing.state) {
      const msg = `Moved from ${STATE_LABELS[existing.state]} to ${STATE_LABELS[nextState]}.`;
      changes.push(msg);
      recordActivity({
        issueId: updated.id,
        agentId: agent.id,
        actorKind: actor,
        ...(actorAgentId !== undefined ? { actorAgentId } : {}),
        kind: "state_changed",
        body: msg,
        createdAt: now,
      });
    }
    if (!assigneeEquals(existing.assignee, nextAssignee)) {
      const msg = `Assigned to ${describeAssignee(db, nextAssignee)}.`;
      changes.push(msg);
      recordActivity({
        issueId: updated.id,
        agentId: agent.id,
        actorKind: actor,
        ...(actorAgentId !== undefined ? { actorAgentId } : {}),
        kind: "assignee_changed",
        body: msg,
        createdAt: now,
      });
    }
    if (nextPriority !== existing.priority) {
      const msg = `Changed priority from ${existing.priority} to ${nextPriority}.`;
      changes.push(msg);
      recordActivity({
        issueId: updated.id,
        agentId: agent.id,
        actorKind: actor,
        ...(actorAgentId !== undefined ? { actorAgentId } : {}),
        kind: "priority_changed",
        body: msg,
        createdAt: now,
      });
    }
    if (
      changes.length === 0 &&
      (nextTitle !== existing.title ||
        nextDescription !== existing.description ||
        nextDueDate !== existing.dueDate ||
        nextRelated !== existing.relatedIssueId ||
        input.labels !== undefined)
    ) {
      const msg = "Updated issue details.";
      changes.push(msg);
      recordActivity({
        issueId: updated.id,
        agentId: agent.id,
        actorKind: actor,
        ...(actorAgentId !== undefined ? { actorAgentId } : {}),
        kind: "updated",
        body: msg,
        createdAt: now,
      });
    }

    eventBus.publishSync({ kind: "agent.issue.upserted", issue: updated });

    if (actor === "agent") {
      const escalatedState = nextState === "needs_you" && existing.state !== "needs_you";
      const handedToUser =
        nextAssignee.kind === "user" && !assigneeEquals(existing.assignee, nextAssignee);
      if (escalatedState || handedToUser) {
        setAgentAttention(agent.id, `[${updated.key}] Needs you: ${updated.title}`, now);
      }
    } else {
      if (existing.state === "needs_you" && nextState !== "needs_you") {
        clearAttentionIfResolved(agent.id, now);
      }
      if (input.notifyAgent !== false && changes.length > 0) {
        const targetAgentId =
          nextAssignee.kind === "agent"
            ? nextAssignee.agentId
            : existing.state === "needs_you" && nextState !== "needs_you"
              ? existing.agentId
              : null;
        if (targetAgentId !== null) {
          yield* notifyAgent(
            targetAgentId,
            buildIssueUpdatePrompt({
              issue: updated,
              summary: `User update: ${changes.join(" ")}`,
              ...(nextDescription !== existing.description ? { detail: nextDescription } : {}),
            }),
          );
        }
      }
    }

    return updated;
  });

  const addComment = Effect.fn("AgentService.addIssueComment")(function* (
    agentId: AgentId,
    issueId: AgentIssueId,
    input: CreateIssueCommentInput,
  ) {
    const agent = yield* requireAgent(agentId);
    const existing = readIssueById(db, agentId, issueId);
    if (!existing) {
      return yield* new AgentServiceError({
        reason: "not-found",
        detail: `Issue "${issueId}" was not found.`,
      });
    }
    const actor: IssueActorKind = input.actor ?? "user";
    const actorAgentId = actor === "agent" ? (input.actorAgentId ?? agent.id) : undefined;
    const body = input.body.trim();
    const now = new Date().toISOString();

    const activity = recordActivity({
      issueId: existing.id,
      agentId: existing.agentId,
      actorKind: actor,
      ...(actorAgentId !== undefined ? { actorAgentId } : {}),
      kind: "comment",
      body,
      createdAt: now,
    });

    const refreshed: AgentIssue = {
      ...existing,
      commentCount: (existing.commentCount ?? 0) + 1,
      updatedAt: now,
    };
    updateIssueRow(db, refreshed);
    eventBus.publishSync({ kind: "agent.issue.upserted", issue: refreshed });

    if (actor === "agent") {
      if (existing.state === "needs_you" || existing.assignee.kind === "user") {
        setAgentAttention(
          agent.id,
          `[${existing.key}] ${body.length > 140 ? `${body.slice(0, 137)}...` : body}`,
          now,
        );
      }
    } else {
      const targetAgentId =
        existing.assignee.kind === "agent"
          ? existing.assignee.agentId
          : existing.state === "needs_you" || existing.createdBy === "agent"
            ? existing.agentId
            : null;
      if (targetAgentId !== null) {
        yield* notifyAgent(
          targetAgentId,
          buildIssueUpdatePrompt({
            issue: refreshed,
            summary: "New user comment on this issue:",
            detail: body,
          }),
        );
      }
    }

    return activity;
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

  return { listAll, list, listActivities, create, update, addComment, remove, sync };
};

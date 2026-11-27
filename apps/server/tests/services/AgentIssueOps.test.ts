import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import type {
  Agent,
  SendTurnInput,
  ServerPushEvent,
  ThreadTurn,
  TurnOrigin,
} from "@scuttle/contracts";
import { AgentId, ProjectId, ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import { applyScuttleMigrations } from "../../src/persistence/migrations.ts";
import { buildAgentDeltaHeader } from "../../src/services/agent/agentContext.ts";
import { makeAgentIssueOps } from "../../src/services/agent/agentIssueOps.ts";
import { insertAgent, readAgentById } from "../../src/services/agent/agentStore.ts";
import { AgentServiceError } from "../../src/services/agent/errors.ts";
import type * as EventBus from "../../src/services/EventBus.ts";
import type * as GitService from "../../src/services/GitService.ts";

const makeTestDb = (): { readonly db: Database; readonly agent: Agent } => {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON;");
  applyScuttleMigrations(db);
  const now = new Date().toISOString();
  const projectId = ProjectId.make("proj-1");
  const threadId = ThreadId.make("thread-1");
  const agentId = AgentId.make("agent-1");
  const modelSelection = {
    providerId: ProviderId.make("claude"),
    providerKind: "claude" as const,
    model: "claude-opus-5-5",
  };

  db.prepare(
    `INSERT INTO projects (id, name, path, is_git_repo, default_branch, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'main', ?, ?)`,
  ).run(projectId, "scuttle", "/tmp/scuttle", now, now);

  db.prepare(
    `INSERT INTO threads (id, project_id, project_name, title, runtime, branch, cwd, provider_id,
      provider_kind, model, status_json, created_at, updated_at)
     VALUES (?, ?, 'scuttle', 'Sivir', 'local', 'main', '/tmp/scuttle', 'claude', 'claude',
      'claude-opus-5-5', '{"kind":"idle"}', ?, ?)`,
  ).run(threadId, projectId, now, now);

  const agent: Agent = {
    id: agentId,
    projectId,
    projectName: "scuttle",
    projectPath: "/tmp/scuttle",
    name: "Sivir",
    purpose: "Maintains Scuttle",
    primaryThreadId: threadId,
    runtime: "local",
    modelSelection,
    modelStack: { agent: modelSelection },
    instructionsMd: "",
    pinned: false,
    needsAttention: false,
    createdAt: now,
    updatedAt: now,
  };
  insertAgent(db, agent);
  return { db, agent };
};

describe("AgentIssueOps bidirectional loop", () => {
  it("notifies assigned agent on create/update/comment, escalates needs_you to user, and avoids self-loops", async () => {
    const { db, agent } = makeTestDb();
    const events: ServerPushEvent[] = [];
    const sentTurns: Array<{
      readonly agentId: AgentId;
      readonly prompt: string;
      readonly origin: TurnOrigin | undefined;
    }> = [];

    const eventBus: EventBus.EventBus["Service"] = {
      publish: (event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      publishSync: (event) => {
        events.push(event);
      },
      subscribe: () => () => undefined,
    };

    const sendAgentTurn = (
      targetAgentId: AgentId,
      input: SendTurnInput,
      options?: { readonly origin?: TurnOrigin },
    ): Effect.Effect<ThreadTurn, AgentServiceError> =>
      Effect.sync(() => {
        sentTurns.push({ agentId: targetAgentId, prompt: input.prompt, origin: options?.origin });
        const now = new Date().toISOString();
        return {
          id: TurnId.make(crypto.randomUUID()),
          threadId: agent.primaryThreadId,
          seq: sentTurns.length,
          origin: options?.origin ?? "system",
          userMessage: input.prompt,
          assistantMessage: "",
          thinkingText: "",
          status: "completed",
          startedAt: now,
          completedAt: now,
          costUsd: 0,
          modelSelection: agent.modelSelection,
          activities: [],
          approvals: [],
        };
      });

    const requireAgent = (id: AgentId) =>
      Effect.sync(() => readAgentById(db, id)).pipe(
        Effect.flatMap((found) =>
          found
            ? Effect.succeed(found)
            : Effect.fail(new AgentServiceError({ reason: "not-found", detail: "Not found" })),
        ),
      );

    const ops = makeAgentIssueOps({
      db,
      eventBus,
      git: {} as GitService.GitService["Service"],
      runner: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      fetch: () => Promise.resolve(new Response("{}")),
      requireAgent,
      sendAgentTurn,
    });

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const created = yield* ops.create(agent.id, {
            title: "Fix prisma migrate deploy on theme_v2",
            description: "Fails from empty DB",
            state: "todo",
            priority: "high",
            assignee: { kind: "agent", agentId: agent.id },
            labels: ["db", "bug"],
            actor: "user",
          });

          expect(created.priority).toBe("high");
          expect(created.assignee).toEqual({ kind: "agent", agentId: agent.id });
          expect(created.createdBy).toBe("user");
          expect(created.state).toBe("todo");
          expect(sentTurns.length).toBe(1);
          expect(sentTurns[0]?.origin).toBe("system");
          expect(sentTurns[0]?.prompt).toContain(created.key);
          expect(sentTurns[0]?.prompt).toContain("You were assigned this new issue.");

          const escalated = yield* ops.update(agent.id, created.id, {
            state: "needs_you",
            assignee: { kind: "user" },
            actor: "agent",
          });
          expect(escalated.state).toBe("needs_you");
          expect(escalated.assignee).toEqual({ kind: "user" });
          expect(sentTurns.length).toBe(1);

          const afterEscalate = readAgentById(db, agent.id)!;
          expect(afterEscalate.needsAttention).toBe(true);
          expect(afterEscalate.lastSummary).toContain(created.key);

          const comment = yield* ops.addComment(agent.id, created.id, {
            body: "Go ahead and drop the legacy migration.",
            actor: "user",
          });
          expect(comment.kind).toBe("comment");
          expect(comment.actorKind).toBe("user");
          expect(sentTurns.length).toBe(2);
          expect(sentTurns[1]?.prompt).toContain("Go ahead and drop the legacy migration.");

          const delta = buildAgentDeltaHeader({ db, agentId: agent.id, profileHash: "abc" });
          expect(delta).toContain("Issues waiting on user (needs_you):");
          expect(delta).toContain("Recent user issue updates:");
          expect(delta).toContain(created.key);

          const resolved = yield* ops.update(agent.id, created.id, {
            state: "in_progress",
            assignee: { kind: "agent", agentId: agent.id },
            actor: "user",
          });
          expect(resolved.state).toBe("in_progress");
          expect(sentTurns.length).toBe(3);
          expect(readAgentById(db, agent.id)!.needsAttention).toBe(false);

          const agentReply = yield* ops.addComment(agent.id, created.id, {
            body: "Applied fix and verified migrations.",
            actor: "agent",
          });
          expect(agentReply.actorKind).toBe("agent");
          expect(sentTurns.length).toBe(3);

          const activities = yield* ops.listActivities(agent.id, created.id);
          expect(activities.length).toBeGreaterThanOrEqual(5);
          expect(
            events.some(
              (e) => e.kind === "agent.issue.activity.created" && e.activity.issueId === created.id,
            ),
          ).toBe(true);

          const all = yield* ops.listAll();
          expect(all.length).toBe(1);
          expect(all[0]?.commentCount).toBe(2);
        }),
      );
    } finally {
      db.close();
    }
  });
});

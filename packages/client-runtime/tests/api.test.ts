import { afterEach, describe, expect, it } from "bun:test";
import {
  AgentCheckInId,
  AgentDelegationId,
  AgentId,
  AgentIssueId,
  AgentMemoryId,
  ProjectId,
  ProviderId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import { createScuttleApiClient } from "../src/api.ts";

const originalFetch = globalThis.fetch;

const MODEL = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude" as const,
  model: "claude-opus-5-5",
  effort: "high" as const,
};

const AGENT = {
  id: AgentId.make("agent-1"),
  projectId: ProjectId.make("proj-1"),
  projectName: "scuttle",
  projectPath: "/repo",
  name: "Scuttle",
  purpose: "Coordinate repo work",
  primaryThreadId: ThreadId.make("thread-1"),
  runtime: "local" as const,
  modelSelection: MODEL,
  modelStack: { agent: MODEL },
  instructionsMd: "# Scuttle",
  pinned: false,
  needsAttention: false,
  createdAt: "2026-11-25T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z",
};

describe("client-runtime Agent API", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("decodes Agent, Memory, Issue, Delegation, CheckIn, and Setup endpoints", async () => {
    const calls: string[] = [];
    const memory = {
      id: AgentMemoryId.make("mem-1"),
      agentId: AGENT.id,
      category: "fact" as const,
      title: "Rule",
      content: "Keep files < 500 lines",
      pinned: true,
      source: "user" as const,
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    };
    const issue = {
      id: AgentIssueId.make("issue-1"),
      agentId: AGENT.id,
      key: "SCUT-1",
      title: "Ship UI",
      description: "Phase 2",
      state: "backlog" as const,
      labels: ["ui"],
      createdAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    };
    const delegation = {
      id: AgentDelegationId.make("del-1"),
      agentId: AGENT.id,
      parentThreadId: AGENT.primaryThreadId,
      childThreadId: ThreadId.make("thread-2"),
      role: "workhorse" as const,
      kind: "pr" as const,
      title: "SCUT-1: Ship UI",
      brief: "Build it",
      modelSelection: MODEL,
      status: "running" as const,
      issueId: issue.id,
      createdAt: "2026-11-25T00:00:00Z",
    };
    const checkIn = {
      id: AgentCheckInId.make("chk-1"),
      agentId: AGENT.id,
      summary: "All good",
      activeDelegations: 1,
      openPrs: 0,
      openIssues: 1,
      createdAt: "2026-11-25T00:00:00Z",
    };
    const turn = {
      id: TurnId.make("turn-1"),
      threadId: AGENT.primaryThreadId,
      origin: "system" as const,
      userMessage: "Setup",
      assistantMessage: "",
      thinkingText: "",
      status: "running" as const,
      startedAt: "2026-11-25T00:00:00Z",
      modelSelection: MODEL,
      activities: [],
      approvals: [],
    };

    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      calls.push(`${method} ${new URL(url).pathname}${new URL(url).search}`);
      if (url.endsWith("/api/agents") && method === "GET") return Response.json([AGENT]);
      if (url.endsWith("/api/agents/agent-1/memories?q=500")) return Response.json([memory]);
      if (url.endsWith("/api/agents/agent-1/issues/sync")) return Response.json([issue]);
      if (url.endsWith("/api/agents/agent-1/issues/issue-1/assign")) {
        return Response.json({ mode: "pr", issue, delegation });
      }
      if (url.endsWith("/api/agents/agent-1/checkins")) return Response.json(checkIn);
      if (url.endsWith("/api/agents/agent-1/setup/start")) return Response.json(turn);
      return Response.json({}, { status: 404 });
    };
    Object.assign(globalThis, { fetch: mockFetch });

    const client = createScuttleApiClient("http://127.0.0.1:4310");
    expect(await client.listAgents()).toEqual([AGENT]);
    expect(await client.listAgentMemories(AGENT.id, "500")).toEqual([memory]);
    expect(await client.syncAgentIssues(AGENT.id)).toEqual([issue]);
    expect(await client.assignAgentIssue(AGENT.id, issue.id)).toEqual({
      mode: "pr",
      issue,
      delegation,
    });
    expect(await client.triggerAgentCheckIn(AGENT.id)).toEqual(checkIn);
    expect(await client.startAgentSetup(AGENT.id)).toEqual(turn);
    expect(calls).toEqual([
      "GET /api/agents",
      "GET /api/agents/agent-1/memories?q=500",
      "POST /api/agents/agent-1/issues/sync",
      "POST /api/agents/agent-1/issues/issue-1/assign",
      "POST /api/agents/agent-1/checkins",
      "POST /api/agents/agent-1/setup/start",
    ]);
  });
});

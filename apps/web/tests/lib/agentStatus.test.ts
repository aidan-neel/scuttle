import { describe, expect, test } from "bun:test";
import type { Agent, AgentDelegation, Thread } from "@scuttle/contracts";
import {
  AgentDelegationId,
  AgentId,
  ApprovalId,
  ProjectId,
  ProviderId,
  ThreadId,
} from "@scuttle/shared/ids";
import { formatAgentWorkingLabel, resolveAgentActivityStatus } from "@/lib/agentStatus.ts";

const MODEL = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude" as const,
  model: "claude-opus-5-5",
  effort: "high" as const,
};

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: AgentId.make("agent-1"),
  projectId: ProjectId.make("proj-1"),
  projectName: "scuttle",
  projectPath: "/tmp/scuttle",
  name: "Design",
  purpose: "UI craft",
  primaryThreadId: ThreadId.make("thread-1"),
  runtime: "local",
  modelSelection: MODEL,
  modelStack: {},
  instructionsMd: "",
  pinned: false,
  needsAttention: false,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
  ...overrides,
});

const makeThread = (status: Thread["status"]): Thread => ({
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("proj-1"),
  projectName: "scuttle",
  title: "Design",
  runtime: "local",
  branch: "main",
  cwd: "/tmp/scuttle",
  modelSelection: MODEL,
  runtimeMode: "auto",
  interactionMode: "default",
  status,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
});

const makeDelegation = (status: AgentDelegation["status"]): AgentDelegation => ({
  id: AgentDelegationId.make("del-1"),
  agentId: AgentId.make("agent-1"),
  parentThreadId: ThreadId.make("thread-1"),
  childThreadId: ThreadId.make("thread-child"),
  role: "workhorse",
  kind: "task",
  title: "Subtask",
  brief: "Do work",
  modelSelection: MODEL,
  status,
  bounceCount: 0,
  maxBounces: 3,
  createdAt: "2026-11-27T00:00:00.000Z",
});

describe("resolveAgentActivityStatus", () => {
  test("returns working when primary thread is running", () => {
    const status = resolveAgentActivityStatus(
      makeAgent(),
      makeThread({ kind: "running", startedAt: "2026-11-27T00:00:00.000Z", phase: "working" }),
    );
    expect(status).toEqual({ kind: "working", activeDelegations: 0 });
  });

  test("returns working when idle primary thread has active delegations on agent summary", () => {
    const status = resolveAgentActivityStatus(
      makeAgent({ activeDelegationCount: 2 }),
      makeThread({ kind: "idle" }),
    );
    expect(status).toEqual({ kind: "working", activeDelegations: 2 });
  });

  test("prefers loaded delegations over stale summary count", () => {
    const status = resolveAgentActivityStatus(
      makeAgent({ activeDelegationCount: 2 }),
      makeThread({ kind: "idle" }),
      [makeDelegation("completed")],
    );
    expect(status).toEqual({ kind: "idle" });
  });

  test("prioritizes needs-input over running delegations", () => {
    const status = resolveAgentActivityStatus(
      makeAgent({ activeDelegationCount: 1 }),
      makeThread({ kind: "needs-input", approvalId: ApprovalId.make("app-1") }),
    );
    expect(status).toEqual({ kind: "needs-input" });
  });

  test("surfaces error status when idle with no active delegations", () => {
    const status = resolveAgentActivityStatus(
      makeAgent(),
      makeThread({ kind: "error", message: "boom" }),
    );
    expect(status).toEqual({ kind: "error" });
  });

  test("formats working label with active delegation count when present", () => {
    expect(formatAgentWorkingLabel(0)).toBe("Working");
    expect(formatAgentWorkingLabel(2)).toBe("Working · 2");
  });
});

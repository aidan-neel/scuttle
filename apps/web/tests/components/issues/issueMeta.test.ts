import { describe, expect, it } from "bun:test";
import type { AgentIssue } from "@scuttle/contracts";
import { AgentId, AgentIssueId } from "@scuttle/shared/ids";
import { filterIssues, groupIssuesByState } from "../../../src/components/issues/issueMeta.ts";

const AGENT_A = AgentId.make("agent-a");
const AGENT_B = AgentId.make("agent-b");

const makeIssue = (overrides: Partial<AgentIssue> & { readonly id: string }): AgentIssue => ({
  id: AgentIssueId.make(overrides.id),
  agentId: overrides.agentId ?? AGENT_A,
  key: overrides.key ?? "SCUT-1",
  title: overrides.title ?? "Sample issue",
  description: overrides.description ?? "",
  state: overrides.state ?? "todo",
  priority: overrides.priority ?? "normal",
  assignee: overrides.assignee ?? { kind: "unassigned" },
  createdBy: overrides.createdBy ?? "user",
  labels: overrides.labels ?? [],
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
});

describe("issueMeta", () => {
  const sample: ReadonlyArray<AgentIssue> = [
    makeIssue({
      id: AgentIssueId.make("i-1"),
      key: "SCUT-1",
      title: "Needs user approval",
      state: "needs_you",
      priority: "urgent",
      assignee: { kind: "user" },
      createdBy: "agent",
    }),
    makeIssue({
      id: AgentIssueId.make("i-2"),
      key: "SCUT-2",
      title: "Refactor parser",
      state: "in_progress",
      priority: "low",
      assignee: { kind: "agent", agentId: AGENT_A },
      createdBy: "user",
    }),
    makeIssue({
      id: AgentIssueId.make("i-3"),
      key: "SCUT-3",
      agentId: AGENT_B,
      title: "Unassigned agent backlog",
      state: "backlog",
      priority: "high",
      assignee: { kind: "unassigned" },
      createdBy: "agent",
    }),
  ];

  it("filters by preset, agent, priority, and search query", () => {
    expect(
      filterIssues(sample, {
        preset: "assigned_to_me",
        query: "",
        agentId: null,
        priority: null,
      }).map((i) => i.id),
    ).toEqual([AgentIssueId.make("i-1")]);

    expect(
      filterIssues(sample, {
        preset: "agents",
        query: "",
        agentId: null,
        priority: null,
      }).map((i) => i.id),
    ).toEqual([AgentIssueId.make("i-2")]);

    expect(
      filterIssues(sample, {
        preset: "for_you",
        query: "",
        agentId: null,
        priority: null,
      }).map((i) => i.id),
    ).toEqual([AgentIssueId.make("i-1"), AgentIssueId.make("i-2")]);

    expect(
      filterIssues(sample, {
        preset: "all",
        query: "parser",
        agentId: AGENT_A,
        priority: "low",
      }).map((i) => i.id),
    ).toEqual([AgentIssueId.make("i-2")]);
  });

  it("groups issues by state and sorts by priority rank", () => {
    const unsorted: ReadonlyArray<AgentIssue> = [
      makeIssue({ id: AgentIssueId.make("low-1"), state: "todo", priority: "low" }),
      makeIssue({ id: AgentIssueId.make("urg-1"), state: "todo", priority: "urgent" }),
      makeIssue({ id: AgentIssueId.make("high-1"), state: "todo", priority: "high" }),
    ];
    const grouped = groupIssuesByState(unsorted);
    expect(grouped.todo.map((i) => i.id)).toEqual([
      AgentIssueId.make("urg-1"),
      AgentIssueId.make("high-1"),
      AgentIssueId.make("low-1"),
    ]);
  });
});

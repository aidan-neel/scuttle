import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDelegationQuestion,
  AgentDetail,
  AgentIssue,
  AgentMemory,
  ServerPushEvent,
} from "@scuttle/contracts";
import { upsertById } from "./collections.ts";

export interface AgentWork {
  readonly memories: ReadonlyArray<AgentMemory>;
  readonly issues: ReadonlyArray<AgentIssue>;
  readonly delegations: ReadonlyArray<AgentDelegation>;
  readonly questions: ReadonlyArray<AgentDelegationQuestion>;
  readonly checkIns: ReadonlyArray<AgentCheckIn>;
}

export interface AgentSlice {
  readonly agents: ReadonlyArray<Agent>;
  readonly agentWork: Readonly<Record<string, AgentWork>>;
}

export const isAgentThread = (agents: ReadonlyArray<Agent>, threadId: string): boolean =>
  agents.some((agent) => agent.primaryThreadId === threadId);

const withWork = (
  slice: AgentSlice,
  agentId: string,
  update: (work: AgentWork) => AgentWork,
): AgentSlice => {
  const work = slice.agentWork[agentId];
  if (work === undefined) return slice;
  return { ...slice, agentWork: { ...slice.agentWork, [agentId]: update(work) } };
};

const withoutKeys = <T>(
  record: Readonly<Record<string, T>>,
  keys: ReadonlyArray<string>,
): Readonly<Record<string, T>> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

export const removeAgents = (
  slice: AgentSlice,
  predicate: (agent: Agent) => boolean,
): AgentSlice => {
  const removed = slice.agents.filter(predicate).map((agent) => agent.id);
  if (removed.length === 0) return slice;
  return {
    agents: slice.agents.filter((agent) => !removed.includes(agent.id)),
    agentWork: withoutKeys(slice.agentWork, removed),
  };
};

export const agentDetailLoaded = (
  slice: AgentSlice,
  detail: Omit<AgentDetail, "primaryThread">,
): AgentSlice => ({
  agents: upsertById(slice.agents, detail.agent),
  agentWork: {
    ...slice.agentWork,
    [detail.agent.id]: {
      memories: detail.memories,
      issues: detail.issues,
      delegations: detail.delegations,
      questions: slice.agentWork[detail.agent.id]?.questions ?? [],
      checkIns: detail.checkIns,
    },
  },
});

export const applyAgentEvent = (slice: AgentSlice, event: ServerPushEvent): AgentSlice => {
  switch (event.kind) {
    case "agent.upserted":
      return { ...slice, agents: upsertById(slice.agents, event.agent) };
    case "agent.deleted":
      return removeAgents(slice, (agent) => agent.id === event.agentId);
    case "agent.memory.upserted":
      return withWork(slice, event.memory.agentId, (work) => ({
        ...work,
        memories: upsertById(work.memories, event.memory),
      }));
    case "agent.memory.deleted":
      return withWork(slice, event.agentId, (work) => ({
        ...work,
        memories: work.memories.filter((memory) => memory.id !== event.memoryId),
      }));
    case "agent.issue.upserted":
      return withWork(slice, event.issue.agentId, (work) => ({
        ...work,
        issues: upsertById(work.issues, event.issue),
      }));
    case "agent.issue.deleted":
      return withWork(slice, event.agentId, (work) => ({
        ...work,
        issues: work.issues.filter((issue) => issue.id !== event.issueId),
      }));
    case "agent.delegation.upserted":
      return withWork(slice, event.delegation.agentId, (work) => ({
        ...work,
        delegations: upsertById(work.delegations, event.delegation),
      }));
    case "agent.delegation.question.upserted":
      return withWork(slice, event.question.agentId, (work) => ({
        ...work,
        questions: upsertById(work.questions, event.question, false),
      }));
    case "agent.checkin.created":
      return withWork(slice, event.checkIn.agentId, (work) => ({
        ...work,
        checkIns: upsertById(work.checkIns, event.checkIn),
      }));
    case "project.deleted":
      return removeAgents(slice, (agent) => agent.projectId === event.projectId);
    case "thread.deleted":
      return removeAgents(slice, (agent) => agent.primaryThreadId === event.threadId);
    default:
      return slice;
  }
};

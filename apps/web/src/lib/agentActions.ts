import type { ScuttleApiClient } from "@scuttle/client-runtime";
import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDetail,
  AgentIssue,
  AgentMemory,
  AssignAgentIssueInput,
  AssignAgentIssueResult,
  CreateAgentInput,
  CreateIssueInput,
  CreateMemoryInput,
  DelegateAgentTaskInput,
  SendTurnInput,
  ServerPushEvent,
  SetupAgentStartInput,
  ThreadTurn,
  TriggerCheckInInput,
  UpdateAgentInput,
  UpdateIssueInput,
  UpdateMemoryInput,
} from "@scuttle/contracts";
import type { AgentDelegationId, AgentId, AgentIssueId, AgentMemoryId } from "@scuttle/shared/ids";

export interface AgentActions {
  readonly loadAgentDetail: (agentId: AgentId) => Promise<AgentDetail>;
  readonly createAgent: (input: CreateAgentInput) => Promise<Agent>;
  readonly updateAgent: (agentId: AgentId, input: UpdateAgentInput) => Promise<Agent>;
  readonly deleteAgent: (agentId: AgentId) => Promise<void>;
  readonly sendAgentTurn: (agentId: AgentId, input: SendTurnInput) => Promise<ThreadTurn>;
  readonly startAgentSetup: (agentId: AgentId, input?: SetupAgentStartInput) => Promise<ThreadTurn>;
  readonly createMemory: (agentId: AgentId, input: CreateMemoryInput) => Promise<AgentMemory>;
  readonly updateMemory: (
    agentId: AgentId,
    memoryId: AgentMemoryId,
    input: UpdateMemoryInput,
  ) => Promise<AgentMemory>;
  readonly deleteMemory: (agentId: AgentId, memoryId: AgentMemoryId) => Promise<void>;
  readonly searchMemories: (agentId: AgentId, query: string) => Promise<ReadonlyArray<AgentMemory>>;
  readonly createIssue: (agentId: AgentId, input: CreateIssueInput) => Promise<AgentIssue>;
  readonly updateIssue: (
    agentId: AgentId,
    issueId: AgentIssueId,
    input: UpdateIssueInput,
  ) => Promise<AgentIssue>;
  readonly deleteIssue: (agentId: AgentId, issueId: AgentIssueId) => Promise<void>;
  readonly syncForgeIssues: (agentId: AgentId) => Promise<ReadonlyArray<AgentIssue>>;
  readonly assignIssue: (
    agentId: AgentId,
    issueId: AgentIssueId,
    input?: AssignAgentIssueInput,
  ) => Promise<AssignAgentIssueResult>;
  readonly delegateTask: (
    agentId: AgentId,
    input: DelegateAgentTaskInput,
  ) => Promise<AgentDelegation>;
  readonly cancelDelegation: (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) => Promise<AgentDelegation>;
  readonly runCheckIn: (agentId: AgentId, input?: TriggerCheckInInput) => Promise<AgentCheckIn>;
}

interface AgentActionSinks {
  readonly onEvent: (event: ServerPushEvent) => void;
  readonly onDetail: (detail: AgentDetail) => void;
}

export const createAgentActions = (
  api: () => ScuttleApiClient,
  { onEvent, onDetail }: AgentActionSinks,
): AgentActions => {
  const upsertAgent = (agent: Agent) => {
    onEvent({ kind: "agent.upserted", agent });
    return agent;
  };
  const upsertTurn = (turn: ThreadTurn) => {
    onEvent({ kind: "turn.upserted", turn });
    return turn;
  };
  const upsertMemory = (memory: AgentMemory) => {
    onEvent({ kind: "agent.memory.upserted", memory });
    return memory;
  };
  const upsertIssue = (issue: AgentIssue) => {
    onEvent({ kind: "agent.issue.upserted", issue });
    return issue;
  };
  const upsertDelegation = (delegation: AgentDelegation) => {
    onEvent({ kind: "agent.delegation.upserted", delegation });
    return delegation;
  };

  return {
    loadAgentDetail: async (agentId) => {
      const detail = await api().getAgentDetail(agentId);
      onDetail(detail);
      return detail;
    },
    createAgent: async (input) => upsertAgent(await api().createAgent(input)),
    updateAgent: async (agentId, input) => upsertAgent(await api().updateAgent(agentId, input)),
    deleteAgent: async (agentId) => {
      await api().deleteAgent(agentId);
      onEvent({ kind: "agent.deleted", agentId });
    },
    sendAgentTurn: async (agentId, input) => upsertTurn(await api().sendAgentTurn(agentId, input)),
    startAgentSetup: async (agentId, input) =>
      upsertTurn(await api().startAgentSetup(agentId, input)),
    createMemory: async (agentId, input) =>
      upsertMemory(await api().createAgentMemory(agentId, input)),
    updateMemory: async (agentId, memoryId, input) =>
      upsertMemory(await api().updateAgentMemory(agentId, memoryId, input)),
    deleteMemory: async (agentId, memoryId) => {
      await api().deleteAgentMemory(agentId, memoryId);
      onEvent({ kind: "agent.memory.deleted", agentId, memoryId });
    },
    searchMemories: async (agentId, query) => {
      const memories = await api().listAgentMemories(agentId, query);
      for (const memory of memories) upsertMemory(memory);
      return memories;
    },
    createIssue: async (agentId, input) =>
      upsertIssue(await api().createAgentIssue(agentId, input)),
    updateIssue: async (agentId, issueId, input) =>
      upsertIssue(await api().updateAgentIssue(agentId, issueId, input)),
    deleteIssue: async (agentId, issueId) => {
      await api().deleteAgentIssue(agentId, issueId);
      onEvent({ kind: "agent.issue.deleted", agentId, issueId });
    },
    syncForgeIssues: async (agentId) => {
      const issues = await api().syncAgentIssues(agentId);
      for (const issue of issues) upsertIssue(issue);
      return issues;
    },
    assignIssue: async (agentId, issueId, input) => {
      const result = await api().assignAgentIssue(agentId, issueId, input);
      upsertIssue(result.issue);
      if (result.mode === "pr") upsertDelegation(result.delegation);
      else upsertTurn(result.turn);
      return result;
    },
    delegateTask: async (agentId, input) =>
      upsertDelegation(await api().delegateAgentTask(agentId, input)),
    cancelDelegation: async (agentId, delegationId) =>
      upsertDelegation(await api().cancelAgentDelegation(agentId, delegationId)),
    runCheckIn: async (agentId, input) => {
      const checkIn = await api().triggerAgentCheckIn(agentId, input);
      onEvent({ kind: "agent.checkin.created", checkIn });
      return checkIn;
    },
  };
};

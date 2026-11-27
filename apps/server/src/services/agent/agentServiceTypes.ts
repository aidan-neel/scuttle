import type {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDelegationQuestion,
  AgentDetail,
  AgentIssue,
  AgentIssueActivity,
  AgentMemory,
  AskDelegationParentInput,
  AssignAgentIssueInput,
  AssignAgentIssueResult,
  CreateAgentInput,
  CreateIssueCommentInput,
  CreateIssueInput,
  CreateMemoryInput,
  DelegateAgentTaskInput,
  SendTurnInput,
  SetupAgentStartInput,
  ThreadTurn,
  TriggerCheckInInput,
  TurnOrigin,
  UpdateAgentInput,
  UpdateIssueInput,
  UpdateMemoryInput,
} from "@scuttle/contracts";
import type { AgentDelegationId, AgentId, AgentIssueId, AgentMemoryId } from "@scuttle/shared/ids";
import type * as Effect from "effect/Effect";
import type { AgentServiceError } from "./errors.ts";

export interface AgentServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<Agent>>;
  readonly getDetail: (agentId: AgentId) => Effect.Effect<AgentDetail, AgentServiceError>;
  readonly create: (input: CreateAgentInput) => Effect.Effect<Agent, AgentServiceError>;
  readonly update: (
    agentId: AgentId,
    input: UpdateAgentInput,
  ) => Effect.Effect<Agent, AgentServiceError>;
  readonly remove: (agentId: AgentId) => Effect.Effect<void, AgentServiceError>;
  readonly sendTurn: (
    agentId: AgentId,
    input: SendTurnInput,
    options?: { readonly origin?: TurnOrigin },
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly startSetup: (
    agentId: AgentId,
    input?: SetupAgentStartInput,
  ) => Effect.Effect<ThreadTurn, AgentServiceError>;
  readonly buildAgentContext: (
    agentId: AgentId,
    query?: string,
  ) => Effect.Effect<string, AgentServiceError>;
  readonly listMemories: (
    agentId: AgentId,
    query?: string,
  ) => Effect.Effect<ReadonlyArray<AgentMemory>, AgentServiceError>;
  readonly searchMemories: (
    agentId: AgentId,
    query: string,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<AgentMemory>, AgentServiceError>;
  readonly createMemory: (
    agentId: AgentId,
    input: CreateMemoryInput,
  ) => Effect.Effect<AgentMemory, AgentServiceError>;
  readonly updateMemory: (
    agentId: AgentId,
    memoryId: AgentMemoryId,
    input: UpdateMemoryInput,
  ) => Effect.Effect<AgentMemory, AgentServiceError>;
  readonly deleteMemory: (
    agentId: AgentId,
    memoryId: AgentMemoryId,
  ) => Effect.Effect<void, AgentServiceError>;
  readonly listAllIssues: () => Effect.Effect<ReadonlyArray<AgentIssue>>;
  readonly listIssues: (
    agentId: AgentId,
  ) => Effect.Effect<ReadonlyArray<AgentIssue>, AgentServiceError>;
  readonly listIssueActivities: (
    agentId: AgentId,
    issueId: AgentIssueId,
  ) => Effect.Effect<ReadonlyArray<AgentIssueActivity>, AgentServiceError>;
  readonly createIssue: (
    agentId: AgentId,
    input: CreateIssueInput,
  ) => Effect.Effect<AgentIssue, AgentServiceError>;
  readonly updateIssue: (
    agentId: AgentId,
    issueId: AgentIssueId,
    input: UpdateIssueInput,
  ) => Effect.Effect<AgentIssue, AgentServiceError>;
  readonly addIssueComment: (
    agentId: AgentId,
    issueId: AgentIssueId,
    input: CreateIssueCommentInput,
  ) => Effect.Effect<AgentIssueActivity, AgentServiceError>;
  readonly deleteIssue: (
    agentId: AgentId,
    issueId: AgentIssueId,
  ) => Effect.Effect<void, AgentServiceError>;
  readonly syncIssues: (
    agentId: AgentId,
  ) => Effect.Effect<ReadonlyArray<AgentIssue>, AgentServiceError>;
  readonly assignIssue: (
    agentId: AgentId,
    issueId: AgentIssueId,
    input?: AssignAgentIssueInput,
  ) => Effect.Effect<AssignAgentIssueResult, AgentServiceError>;
  readonly delegateTask: (
    agentId: AgentId,
    input: DelegateAgentTaskInput,
  ) => Effect.Effect<AgentDelegation, AgentServiceError>;
  readonly cancelDelegation: (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) => Effect.Effect<AgentDelegation, AgentServiceError>;
  readonly askParent: (
    agentId: AgentId,
    delegationId: AgentDelegationId,
    input: AskDelegationParentInput,
    options?: { readonly signal?: AbortSignal },
  ) => Effect.Effect<AgentDelegationQuestion, AgentServiceError>;
  readonly listDelegationQuestions: (
    agentId: AgentId,
    delegationId: AgentDelegationId,
  ) => Effect.Effect<ReadonlyArray<AgentDelegationQuestion>, AgentServiceError>;
  readonly runCheckIn: (
    agentId: AgentId,
    input?: TriggerCheckInInput,
  ) => Effect.Effect<AgentCheckIn, AgentServiceError>;
}

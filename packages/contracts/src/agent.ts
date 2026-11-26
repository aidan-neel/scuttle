import {
  AgentCheckInId,
  AgentDelegationId,
  AgentId,
  AgentIssueId,
  AgentMemoryId,
  ProjectId,
  ThreadId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { ModelSelection } from "./provider.ts";
import { ThreadDetail, ThreadRuntime, ThreadTurn } from "./thread.ts";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

export const AgentModelRole = Schema.Literals([
  "agent",
  "workhorse",
  "design",
  "review",
  "fast",
  "large",
]);
export type AgentModelRole = typeof AgentModelRole.Type;

export const AgentModelStack = Schema.Struct({
  agent: Schema.optionalKey(ModelSelection),
  workhorse: Schema.optionalKey(ModelSelection),
  design: Schema.optionalKey(ModelSelection),
  review: Schema.optionalKey(ModelSelection),
  fast: Schema.optionalKey(ModelSelection),
  large: Schema.optionalKey(ModelSelection),
});
export type AgentModelStack = typeof AgentModelStack.Type;

export const Agent = Schema.Struct({
  id: AgentId,
  projectId: ProjectId,
  projectName: Schema.String,
  projectPath: Schema.String,
  name: Schema.String,
  purpose: Schema.String,
  primaryThreadId: ThreadId,
  runtime: ThreadRuntime,
  modelSelection: ModelSelection,
  modelStack: AgentModelStack,
  instructionsMd: Schema.String,
  checkInIntervalMinutes: Schema.optionalKey(Schema.Number),
  lastCheckInAt: Schema.optionalKey(Schema.String),
  lastSummary: Schema.optionalKey(Schema.String),
  pinned: Schema.Boolean,
  needsAttention: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Agent = typeof Agent.Type;

export const AgentMemoryCategory = Schema.Literals([
  "fact",
  "decision",
  "convention",
  "context",
  "issue",
  "pr",
]);
export type AgentMemoryCategory = typeof AgentMemoryCategory.Type;

export const AgentMemorySource = Schema.Literals(["user", "agent", "checkin"]);
export type AgentMemorySource = typeof AgentMemorySource.Type;

export const AgentMemory = Schema.Struct({
  id: AgentMemoryId,
  agentId: AgentId,
  category: AgentMemoryCategory,
  title: Schema.String,
  content: Schema.String,
  pinned: Schema.Boolean,
  source: AgentMemorySource,
  lastAccessedAt: Schema.optionalKey(Schema.String),
  hitCount: Schema.optionalKey(Schema.Number),
  supersedesId: Schema.optionalKey(AgentMemoryId),
  supersededAt: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AgentMemory = typeof AgentMemory.Type;

export const AgentIssueState = Schema.Literals([
  "backlog",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);
export type AgentIssueState = typeof AgentIssueState.Type;

export const AgentIssue = Schema.Struct({
  id: AgentIssueId,
  agentId: AgentId,
  key: Schema.String,
  title: Schema.String,
  description: Schema.String,
  state: AgentIssueState,
  labels: Schema.Array(Schema.String),
  externalUrl: Schema.optionalKey(Schema.String),
  assignedThreadId: Schema.optionalKey(ThreadId),
  prNumber: Schema.optionalKey(Schema.Number),
  prUrl: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AgentIssue = typeof AgentIssue.Type;

export const AgentDelegationKind = Schema.Literals(["task", "pr", "review", "issue"]);
export type AgentDelegationKind = typeof AgentDelegationKind.Type;

export const AgentDelegationStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type AgentDelegationStatus = typeof AgentDelegationStatus.Type;

export const AgentDelegation = Schema.Struct({
  id: AgentDelegationId,
  agentId: AgentId,
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  role: AgentModelRole,
  kind: AgentDelegationKind,
  title: Schema.String,
  brief: Schema.String,
  modelSelection: ModelSelection,
  status: AgentDelegationStatus,
  issueId: Schema.optionalKey(AgentIssueId),
  prUrl: Schema.optionalKey(Schema.String),
  resultSummary: Schema.optionalKey(Schema.String),
  parentNotifiedAt: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  completedAt: Schema.optionalKey(Schema.String),
});
export type AgentDelegation = typeof AgentDelegation.Type;

export const AgentCheckIn = Schema.Struct({
  id: AgentCheckInId,
  agentId: AgentId,
  summary: Schema.String,
  activeDelegations: Schema.Number,
  openPrs: Schema.Number,
  openIssues: Schema.Number,
  createdAt: Schema.String,
});
export type AgentCheckIn = typeof AgentCheckIn.Type;

export const AgentDetail = Schema.Struct({
  agent: Agent,
  primaryThread: ThreadDetail,
  memories: Schema.Array(AgentMemory),
  issues: Schema.Array(AgentIssue),
  delegations: Schema.Array(AgentDelegation),
  checkIns: Schema.Array(AgentCheckIn),
});
export type AgentDetail = typeof AgentDetail.Type;

export const CreateAgentInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  path: Schema.optionalKey(NonEmpty),
  name: NonEmpty,
  purpose: Schema.optionalKey(Schema.String),
  runtime: Schema.optionalKey(ThreadRuntime),
  modelSelection: Schema.optionalKey(ModelSelection),
  modelStack: Schema.optionalKey(AgentModelStack),
  instructionsMd: Schema.optionalKey(Schema.String),
  checkInIntervalMinutes: Schema.optionalKey(Schema.Number),
  startOnboarding: Schema.optionalKey(Schema.Boolean),
});
export type CreateAgentInput = typeof CreateAgentInput.Type;

export const UpdateAgentInput = Schema.Struct({
  name: Schema.optionalKey(NonEmpty),
  purpose: Schema.optionalKey(Schema.String),
  runtime: Schema.optionalKey(ThreadRuntime),
  modelSelection: Schema.optionalKey(ModelSelection),
  modelStack: Schema.optionalKey(AgentModelStack),
  instructionsMd: Schema.optionalKey(Schema.String),
  checkInIntervalMinutes: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  pinned: Schema.optionalKey(Schema.Boolean),
  needsAttention: Schema.optionalKey(Schema.Boolean),
});
export type UpdateAgentInput = typeof UpdateAgentInput.Type;

export const CreateMemoryInput = Schema.Struct({
  category: AgentMemoryCategory,
  title: NonEmpty,
  content: NonEmpty,
  pinned: Schema.optionalKey(Schema.Boolean),
  source: Schema.optionalKey(AgentMemorySource),
});
export type CreateMemoryInput = typeof CreateMemoryInput.Type;

export const UpdateMemoryInput = Schema.Struct({
  category: Schema.optionalKey(AgentMemoryCategory),
  title: Schema.optionalKey(NonEmpty),
  content: Schema.optionalKey(NonEmpty),
  pinned: Schema.optionalKey(Schema.Boolean),
});
export type UpdateMemoryInput = typeof UpdateMemoryInput.Type;

export const CreateIssueInput = Schema.Struct({
  key: Schema.optionalKey(NonEmpty),
  title: NonEmpty,
  description: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(AgentIssueState),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  externalUrl: Schema.optionalKey(Schema.String),
  prNumber: Schema.optionalKey(Schema.Number),
  prUrl: Schema.optionalKey(Schema.String),
});
export type CreateIssueInput = typeof CreateIssueInput.Type;

export const UpdateIssueInput = Schema.Struct({
  title: Schema.optionalKey(NonEmpty),
  description: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(AgentIssueState),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  externalUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  assignedThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  prNumber: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  prUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type UpdateIssueInput = typeof UpdateIssueInput.Type;

export const DelegateAgentTaskInput = Schema.Struct({
  role: AgentModelRole,
  kind: AgentDelegationKind,
  title: NonEmpty,
  brief: NonEmpty,
  runtime: Schema.optionalKey(ThreadRuntime),
  issueId: Schema.optionalKey(AgentIssueId),
  modelSelection: Schema.optionalKey(ModelSelection),
});
export type DelegateAgentTaskInput = typeof DelegateAgentTaskInput.Type;

export const AssignAgentIssueInput = Schema.Struct({
  mode: Schema.optionalKey(Schema.Literals(["pr", "agent"])),
  role: Schema.optionalKey(AgentModelRole),
  runtime: Schema.optionalKey(ThreadRuntime),
  brief: Schema.optionalKey(Schema.String),
  modelSelection: Schema.optionalKey(ModelSelection),
});
export type AssignAgentIssueInput = typeof AssignAgentIssueInput.Type;

export const AssignAgentIssueResult = Schema.Union([
  Schema.Struct({
    mode: Schema.Literals(["pr"]),
    issue: AgentIssue,
    delegation: AgentDelegation,
  }),
  Schema.Struct({
    mode: Schema.Literals(["agent"]),
    issue: AgentIssue,
    turn: ThreadTurn,
  }),
]);
export type AssignAgentIssueResult = typeof AssignAgentIssueResult.Type;

export const TriggerCheckInInput = Schema.Struct({
  focus: Schema.optionalKey(Schema.String),
  promptAgent: Schema.optionalKey(Schema.Boolean),
});
export type TriggerCheckInInput = typeof TriggerCheckInInput.Type;

export const SetupAgentStartInput = Schema.Struct({
  instructions: Schema.optionalKey(Schema.String),
});
export type SetupAgentStartInput = typeof SetupAgentStartInput.Type;

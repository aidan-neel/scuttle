import { IDENTICON_STYLE_IDS } from "@scuttle/shared/identicon";
import {
  AgentCheckInId,
  AgentDelegationId,
  AgentDelegationQuestionId,
  AgentId,
  AgentIssueActivityId,
  AgentIssueId,
  AgentMemoryId,
  ProjectId,
  ProviderId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { EffortLevel, ModelSelection } from "./provider.ts";
import { ThreadDetail, ThreadRuntime, ThreadTurn } from "./thread.ts";

export const IdenticonStyle = Schema.Literals(IDENTICON_STYLE_IDS);
export type IdenticonStyle = typeof IdenticonStyle.Type;

const NonEmpty = Schema.String.check(Schema.isMinLength(1));
const BoundedQuestion = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_000),
  Schema.isPattern(/\S/),
);

export const AgentModelRole = Schema.Literals([
  "nano",
  "small",
  "medium",
  "large",
  "xlarge",
  "max",
  "design",
  "agent",
  "workhorse",
  "review",
  "fast",
]);
export type AgentModelRole = typeof AgentModelRole.Type;

export const AgentModelStack = Schema.Struct({
  nano: Schema.optionalKey(ModelSelection),
  small: Schema.optionalKey(ModelSelection),
  medium: Schema.optionalKey(ModelSelection),
  large: Schema.optionalKey(ModelSelection),
  xlarge: Schema.optionalKey(ModelSelection),
  max: Schema.optionalKey(ModelSelection),
  design: Schema.optionalKey(ModelSelection),
  agent: Schema.optionalKey(ModelSelection),
  workhorse: Schema.optionalKey(ModelSelection),
  review: Schema.optionalKey(ModelSelection),
  fast: Schema.optionalKey(ModelSelection),
});
export type AgentModelStack = typeof AgentModelStack.Type;

export const Agent = Schema.Struct({
  id: AgentId,
  projectId: ProjectId,
  projectName: Schema.String,
  projectPath: Schema.String,
  name: Schema.String,
  identiconStyle: Schema.optionalKey(IdenticonStyle),
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
  activeDelegationCount: Schema.optionalKey(Schema.Number),
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
  "needs_you",
  "in_review",
  "in_progress",
  "waiting",
  "todo",
  "backlog",
  "done",
  "canceled",
]);
export type AgentIssueState = typeof AgentIssueState.Type;

export const AgentIssuePriority = Schema.Literals(["urgent", "high", "normal", "low", "none"]);
export type AgentIssuePriority = typeof AgentIssuePriority.Type;

export const IssueActorKind = Schema.Literals(["user", "agent"]);
export type IssueActorKind = typeof IssueActorKind.Type;

export const AgentIssueAssignee = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["unassigned"]) }),
  Schema.Struct({ kind: Schema.Literals(["user"]) }),
  Schema.Struct({ kind: Schema.Literals(["agent"]), agentId: AgentId }),
]);
export type AgentIssueAssignee = typeof AgentIssueAssignee.Type;

export const AgentIssueActivityKind = Schema.Literals([
  "comment",
  "created",
  "state_changed",
  "assignee_changed",
  "priority_changed",
  "updated",
]);
export type AgentIssueActivityKind = typeof AgentIssueActivityKind.Type;

export const AgentIssueActivity = Schema.Struct({
  id: AgentIssueActivityId,
  issueId: AgentIssueId,
  agentId: AgentId,
  actorKind: IssueActorKind,
  actorAgentId: Schema.optionalKey(AgentId),
  kind: AgentIssueActivityKind,
  body: Schema.String,
  createdAt: Schema.String,
});
export type AgentIssueActivity = typeof AgentIssueActivity.Type;

export const AgentIssue = Schema.Struct({
  id: AgentIssueId,
  agentId: AgentId,
  key: Schema.String,
  title: Schema.String,
  description: Schema.String,
  state: AgentIssueState,
  priority: AgentIssuePriority,
  assignee: AgentIssueAssignee,
  createdBy: IssueActorKind,
  labels: Schema.Array(Schema.String),
  dueDate: Schema.optionalKey(Schema.String),
  relatedIssueId: Schema.optionalKey(AgentIssueId),
  commentCount: Schema.optionalKey(Schema.Number),
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
  "waiting_parent",
  "completed",
  "failed",
  "canceled",
]);
export type AgentDelegationStatus = typeof AgentDelegationStatus.Type;

export const AgentDelegation = Schema.Struct({
  id: AgentDelegationId,
  agentId: Schema.optionalKey(AgentId),
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  role: AgentModelRole,
  kind: AgentDelegationKind,
  title: Schema.String,
  brief: Schema.String,
  modelSelection: ModelSelection,
  status: AgentDelegationStatus,
  bounceCount: Schema.Number,
  maxBounces: Schema.Number,
  issueId: Schema.optionalKey(AgentIssueId),
  prUrl: Schema.optionalKey(Schema.String),
  resultSummary: Schema.optionalKey(Schema.String),
  parentNotifiedAt: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  completedAt: Schema.optionalKey(Schema.String),
});
export type AgentDelegation = typeof AgentDelegation.Type;

export const AgentDelegationQuestionKind = Schema.Literals([
  "missing_context",
  "test_failure",
  "unexpected_error",
  "plan_conflict",
  "other",
]);
export type AgentDelegationQuestionKind = typeof AgentDelegationQuestionKind.Type;

export const AgentDelegationQuestionStatus = Schema.Literals([
  "pending",
  "answered",
  "failed",
  "canceled",
]);
export type AgentDelegationQuestionStatus = typeof AgentDelegationQuestionStatus.Type;

export const AgentDelegationQuestion = Schema.Struct({
  id: AgentDelegationQuestionId,
  delegationId: AgentDelegationId,
  agentId: Schema.optionalKey(AgentId),
  childThreadId: ThreadId,
  parentThreadId: ThreadId,
  parentTurnId: Schema.optionalKey(TurnId),
  kind: AgentDelegationQuestionKind,
  question: Schema.String,
  attempted: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
  status: AgentDelegationQuestionStatus,
  answer: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  bounceNumber: Schema.Number,
  createdAt: Schema.String,
  answeredAt: Schema.optionalKey(Schema.String),
});
export type AgentDelegationQuestion = typeof AgentDelegationQuestion.Type;

export const AskDelegationParentInput = Schema.Struct({
  kind: Schema.optionalKey(AgentDelegationQuestionKind),
  question: BoundedQuestion,
  attempted: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  context: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8_000))),
});
export type AskDelegationParentInput = typeof AskDelegationParentInput.Type;

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
  identiconStyle: Schema.optionalKey(IdenticonStyle),
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
  identiconStyle: Schema.optionalKey(IdenticonStyle),
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
  priority: Schema.optionalKey(AgentIssuePriority),
  assignee: Schema.optionalKey(AgentIssueAssignee),
  createdBy: Schema.optionalKey(IssueActorKind),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  dueDate: Schema.optionalKey(Schema.String),
  relatedIssueId: Schema.optionalKey(AgentIssueId),
  externalUrl: Schema.optionalKey(Schema.String),
  prNumber: Schema.optionalKey(Schema.Number),
  prUrl: Schema.optionalKey(Schema.String),
  actor: Schema.optionalKey(IssueActorKind),
  notifyAgent: Schema.optionalKey(Schema.Boolean),
});
export type CreateIssueInput = typeof CreateIssueInput.Type;

export const UpdateIssueInput = Schema.Struct({
  title: Schema.optionalKey(NonEmpty),
  description: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(AgentIssueState),
  priority: Schema.optionalKey(AgentIssuePriority),
  assignee: Schema.optionalKey(AgentIssueAssignee),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  dueDate: Schema.optionalKey(Schema.NullOr(Schema.String)),
  relatedIssueId: Schema.optionalKey(Schema.NullOr(AgentIssueId)),
  externalUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  assignedThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  prNumber: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  prUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  actor: Schema.optionalKey(IssueActorKind),
  notifyAgent: Schema.optionalKey(Schema.Boolean),
});
export type UpdateIssueInput = typeof UpdateIssueInput.Type;

export const CreateIssueCommentInput = Schema.Struct({
  body: NonEmpty,
  actor: Schema.optionalKey(IssueActorKind),
  actorAgentId: Schema.optionalKey(AgentId),
});
export type CreateIssueCommentInput = typeof CreateIssueCommentInput.Type;

export const DelegateAgentTaskInput = Schema.Struct({
  role: AgentModelRole,
  kind: AgentDelegationKind,
  title: NonEmpty,
  brief: NonEmpty,
  runtime: Schema.optionalKey(ThreadRuntime),
  issueId: Schema.optionalKey(AgentIssueId),
  modelSelection: Schema.optionalKey(ModelSelection),
  maxBounces: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 10 })),
  ),
});
export type DelegateAgentTaskInput = typeof DelegateAgentTaskInput.Type;

export const CreateThreadDelegationInput = Schema.Struct({
  title: NonEmpty,
  brief: NonEmpty,
  kind: Schema.optionalKey(AgentDelegationKind),
  role: Schema.optionalKey(AgentModelRole),
  runtime: Schema.optionalKey(ThreadRuntime),
  providerId: Schema.optionalKey(ProviderId),
  model: Schema.optionalKey(NonEmpty),
  effort: Schema.optionalKey(EffortLevel),
  modelSelection: Schema.optionalKey(ModelSelection),
  branch: Schema.optionalKey(NonEmpty),
  issueId: Schema.optionalKey(AgentIssueId),
  maxBounces: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 10 })),
  ),
});
export type CreateThreadDelegationInput = typeof CreateThreadDelegationInput.Type;

export const DelegationLink = Schema.Struct({
  delegationId: AgentDelegationId,
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  status: AgentDelegationStatus,
  title: Schema.String,
  role: AgentModelRole,
  providerId: ProviderId,
  model: Schema.String,
});
export type DelegationLink = typeof DelegationLink.Type;

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

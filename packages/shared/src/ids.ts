import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

export const WorkspaceId = NonEmptyString.pipe(Schema.brand("WorkspaceId"));
export type WorkspaceId = typeof WorkspaceId.Type;

export const SessionId = NonEmptyString.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const ProjectId = NonEmptyString.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const ThreadId = NonEmptyString.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const TurnId = NonEmptyString.pipe(Schema.brand("TurnId"));
export type TurnId = typeof TurnId.Type;

export const ActivityId = NonEmptyString.pipe(Schema.brand("ActivityId"));
export type ActivityId = typeof ActivityId.Type;

export const ApprovalId = NonEmptyString.pipe(Schema.brand("ApprovalId"));
export type ApprovalId = typeof ApprovalId.Type;

export const ProviderId = NonEmptyString.pipe(Schema.brand("ProviderId"));
export type ProviderId = typeof ProviderId.Type;

export const AgentId = NonEmptyString.pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;

export const AgentMemoryId = NonEmptyString.pipe(Schema.brand("AgentMemoryId"));
export type AgentMemoryId = typeof AgentMemoryId.Type;

export const AgentIssueId = NonEmptyString.pipe(Schema.brand("AgentIssueId"));
export type AgentIssueId = typeof AgentIssueId.Type;

export const AgentDelegationId = NonEmptyString.pipe(Schema.brand("AgentDelegationId"));
export type AgentDelegationId = typeof AgentDelegationId.Type;

export const AgentDelegationQuestionId = NonEmptyString.pipe(
  Schema.brand("AgentDelegationQuestionId"),
);
export type AgentDelegationQuestionId = typeof AgentDelegationQuestionId.Type;

export const AgentCheckInId = NonEmptyString.pipe(Schema.brand("AgentCheckInId"));
export type AgentCheckInId = typeof AgentCheckInId.Type;

export const isWorkspaceId = Schema.is(WorkspaceId);
export const isSessionId = Schema.is(SessionId);
export const isProjectId = Schema.is(ProjectId);
export const isThreadId = Schema.is(ThreadId);
export const isTurnId = Schema.is(TurnId);
export const isActivityId = Schema.is(ActivityId);
export const isApprovalId = Schema.is(ApprovalId);
export const isProviderId = Schema.is(ProviderId);
export const isAgentId = Schema.is(AgentId);
export const isAgentMemoryId = Schema.is(AgentMemoryId);
export const isAgentIssueId = Schema.is(AgentIssueId);
export const isAgentDelegationId = Schema.is(AgentDelegationId);
export const isAgentDelegationQuestionId = Schema.is(AgentDelegationQuestionId);
export const isAgentCheckInId = Schema.is(AgentCheckInId);

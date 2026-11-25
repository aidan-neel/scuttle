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

export const isWorkspaceId = Schema.is(WorkspaceId);
export const isSessionId = Schema.is(SessionId);
export const isProjectId = Schema.is(ProjectId);
export const isThreadId = Schema.is(ThreadId);
export const isTurnId = Schema.is(TurnId);
export const isActivityId = Schema.is(ActivityId);
export const isApprovalId = Schema.is(ApprovalId);
export const isProviderId = Schema.is(ProviderId);

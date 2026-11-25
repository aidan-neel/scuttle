import { ActivityId, ApprovalId, ProjectId, ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { InteractionMode, ModelSelection, RuntimeMode } from "./provider.ts";

export const ThreadRuntime = Schema.Literals(["local", "worktree"]);
export type ThreadRuntime = typeof ThreadRuntime.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
  isGitRepo: Schema.Boolean,
  defaultBranch: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastMessage: Schema.optionalKey(Schema.String),
  lastActivityAt: Schema.optionalKey(Schema.String),
});
export type Project = typeof Project.Type;

export const GitBranchInfo = Schema.Struct({
  name: Schema.String,
  isCurrent: Schema.Boolean,
  isDefault: Schema.Boolean,
  isWorktree: Schema.Boolean,
});
export type GitBranchInfo = typeof GitBranchInfo.Type;

export const DirectoryEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  isGitRepo: Schema.Boolean,
});
export type DirectoryEntry = typeof DirectoryEntry.Type;

export const DirectoryListing = Schema.Struct({
  path: Schema.String,
  parentPath: Schema.NullOr(Schema.String),
  entries: Schema.Array(DirectoryEntry),
});
export type DirectoryListing = typeof DirectoryListing.Type;

export const ThreadStatusIdle = Schema.Struct({
  kind: Schema.Literals(["idle"]),
});

export const ThreadStatusRunning = Schema.Struct({
  kind: Schema.Literals(["running"]),
  startedAt: Schema.String,
  phase: Schema.Literals(["thinking", "working"]),
});

export const ThreadStatusNeedsInput = Schema.Struct({
  kind: Schema.Literals(["needs-input"]),
  approvalId: ApprovalId,
});

export const ThreadStatusError = Schema.Struct({
  kind: Schema.Literals(["error"]),
  message: Schema.String,
});

export const ThreadStatus = Schema.Union([
  ThreadStatusIdle,
  ThreadStatusRunning,
  ThreadStatusNeedsInput,
  ThreadStatusError,
]);
export type ThreadStatus = typeof ThreadStatus.Type;

export const Thread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  projectName: Schema.String,
  title: Schema.String,
  runtime: ThreadRuntime,
  branch: Schema.String,
  worktreePath: Schema.optionalKey(Schema.String),
  cwd: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: InteractionMode,
  status: ThreadStatus,
  settledAt: Schema.optionalKey(Schema.String),
  providerSessionId: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Thread = typeof Thread.Type;

export const ActivityKind = Schema.Literals([
  "thinking",
  "command",
  "file",
  "search",
  "tool",
  "error",
]);
export type ActivityKind = typeof ActivityKind.Type;

export const ActivityStatus = Schema.Literals(["running", "completed", "failed"]);
export type ActivityStatus = typeof ActivityStatus.Type;

export const ActivityItem = Schema.Struct({
  id: ActivityId,
  turnId: TurnId,
  threadId: ThreadId,
  kind: ActivityKind,
  label: Schema.String,
  activeLabel: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  status: ActivityStatus,
  startedAt: Schema.String,
  completedAt: Schema.optionalKey(Schema.String),
  durationMs: Schema.optionalKey(Schema.Number),
});
export type ActivityItem = typeof ActivityItem.Type;

export const ApprovalOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
});
export type ApprovalOption = typeof ApprovalOption.Type;

export const PendingApproval = Schema.Struct({
  id: ApprovalId,
  threadId: ThreadId,
  turnId: TurnId,
  kind: Schema.Literals(["permission", "question"]),
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  options: Schema.Array(ApprovalOption),
  status: Schema.Literals(["pending", "resolved"]),
  selectedOptionId: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
});
export type PendingApproval = typeof PendingApproval.Type;

export const TurnStatus = Schema.Literals(["running", "completed", "failed", "interrupted"]);
export type TurnStatus = typeof TurnStatus.Type;

export const ThreadAttachment = Schema.Struct({
  name: Schema.String,
  path: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
});
export type ThreadAttachment = typeof ThreadAttachment.Type;

export const ThreadTurn = Schema.Struct({
  id: TurnId,
  threadId: ThreadId,
  userMessage: Schema.String,
  assistantMessage: Schema.String,
  thinkingText: Schema.String,
  status: TurnStatus,
  startedAt: Schema.String,
  completedAt: Schema.optionalKey(Schema.String),
  durationMs: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
  modelSelection: ModelSelection,
  activities: Schema.Array(ActivityItem),
  approvals: Schema.Array(PendingApproval),
});
export type ThreadTurn = typeof ThreadTurn.Type;

export const ThreadDetail = Schema.Struct({
  thread: Thread,
  turns: Schema.Array(ThreadTurn),
});
export type ThreadDetail = typeof ThreadDetail.Type;

export const CreateProjectInput = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.optionalKey(Schema.String),
});
export type CreateProjectInput = typeof CreateProjectInput.Type;

export const CreateThreadInput = Schema.Struct({
  projectId: ProjectId,
  prompt: Schema.String.check(Schema.isMinLength(1)),
  title: Schema.optionalKey(Schema.String),
  runtime: ThreadRuntime,
  branch: Schema.String.check(Schema.isMinLength(1)),
  modelSelection: ModelSelection,
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(InteractionMode),
  attachments: Schema.optionalKey(Schema.Array(ThreadAttachment)),
});
export type CreateThreadInput = typeof CreateThreadInput.Type;

export const SendTurnInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)),
  modelSelection: Schema.optionalKey(ModelSelection),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(InteractionMode),
  attachments: Schema.optionalKey(Schema.Array(ThreadAttachment)),
});
export type SendTurnInput = typeof SendTurnInput.Type;

export const SettleThreadInput = Schema.Struct({
  settled: Schema.Boolean,
});
export type SettleThreadInput = typeof SettleThreadInput.Type;

export const UpdateThreadInput = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  modelSelection: Schema.optionalKey(ModelSelection),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(InteractionMode),
});
export type UpdateThreadInput = typeof UpdateThreadInput.Type;

export const RespondApprovalInput = Schema.Struct({
  optionId: Schema.String.check(Schema.isMinLength(1)),
  customText: Schema.optionalKey(Schema.String),
});
export type RespondApprovalInput = typeof RespondApprovalInput.Type;

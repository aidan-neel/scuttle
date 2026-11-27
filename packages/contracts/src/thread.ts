import { ActivityId, ApprovalId, ProjectId, ThreadId, TurnId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { InteractionMode, ModelSelection, RuntimeMode } from "./provider.ts";
import { ThreadVisualization } from "./viz.ts";

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
  kind: Schema.optionalKey(Schema.Literals(["directory", "file"])),
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

export const TurnUsage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.optionalKey(Schema.Number),
  cacheCreationTokens: Schema.optionalKey(Schema.Number),
  contextWindowTokens: Schema.optionalKey(Schema.Number),
});
export type TurnUsage = typeof TurnUsage.Type;

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
  costUsd: Schema.optionalKey(Schema.Number),
  settledAt: Schema.optionalKey(Schema.String),
  providerSessionId: Schema.optionalKey(Schema.String),
  sessionEpoch: Schema.optionalKey(Schema.Number),
  activeSummary: Schema.optionalKey(Schema.String),
  lastUsage: Schema.optionalKey(TurnUsage),
  compactAtTokens: Schema.optionalKey(Schema.Number),
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

export const UserInputQuestion = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  header: Schema.optionalKey(Schema.String),
  question: Schema.String.check(Schema.isMinLength(1)),
  options: Schema.Array(ApprovalOption),
  multiSelect: Schema.optionalKey(Schema.Boolean),
  allowCustom: Schema.optionalKey(Schema.Boolean),
});
export type UserInputQuestion = typeof UserInputQuestion.Type;

export const UserInputAnswerValue = Schema.Union([Schema.String, Schema.Array(Schema.String)]);
export type UserInputAnswerValue = typeof UserInputAnswerValue.Type;

export const UserInputAnswers = Schema.Record(Schema.String, UserInputAnswerValue);
export type UserInputAnswers = typeof UserInputAnswers.Type;

export const PendingApproval = Schema.Struct({
  id: ApprovalId,
  threadId: ThreadId,
  turnId: TurnId,
  kind: Schema.Literals(["permission", "question"]),
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  options: Schema.Array(ApprovalOption),
  questions: Schema.optionalKey(Schema.Array(UserInputQuestion)),
  status: Schema.Literals(["pending", "resolved"]),
  selectedOptionId: Schema.optionalKey(Schema.String),
  answers: Schema.optionalKey(UserInputAnswers),
  dismissed: Schema.optionalKey(Schema.Boolean),
  createdAt: Schema.String,
});
export type PendingApproval = typeof PendingApproval.Type;

export const TurnStatus = Schema.Literals(["running", "completed", "failed", "interrupted"]);
export type TurnStatus = typeof TurnStatus.Type;

export const TurnOrigin = Schema.Literals(["user", "system"]);
export type TurnOrigin = typeof TurnOrigin.Type;

export const AttachmentKind = Schema.Literals(["image", "file"]);
export type AttachmentKind = typeof AttachmentKind.Type;

export const ThreadAttachment = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(AttachmentKind),
  name: Schema.String,
  path: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
  sizeBytes: Schema.optionalKey(Schema.Number),
});
export type ThreadAttachment = typeof ThreadAttachment.Type;

export const UploadedAttachment = Schema.Struct({
  id: Schema.String,
  kind: AttachmentKind,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  url: Schema.String,
});
export type UploadedAttachment = typeof UploadedAttachment.Type;

export const ThreadTurn = Schema.Struct({
  id: TurnId,
  threadId: ThreadId,
  origin: Schema.optionalKey(TurnOrigin),
  sessionEpoch: Schema.optionalKey(Schema.Number),
  userMessage: Schema.String,
  assistantMessage: Schema.String,
  thinkingText: Schema.String,
  status: TurnStatus,
  startedAt: Schema.String,
  completedAt: Schema.optionalKey(Schema.String),
  durationMs: Schema.optionalKey(Schema.Number),
  costUsd: Schema.optionalKey(Schema.Number),
  usage: Schema.optionalKey(TurnUsage),
  error: Schema.optionalKey(Schema.String),
  modelSelection: ModelSelection,
  attachments: Schema.optionalKey(Schema.Array(ThreadAttachment)),
  activities: Schema.Array(ActivityItem),
  approvals: Schema.Array(PendingApproval),
});
export type ThreadTurn = typeof ThreadTurn.Type;

export const ThreadCheckpoint = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  turnId: Schema.optionalKey(TurnId),
  ordinal: Schema.Number,
  ref: Schema.String,
  commitOid: Schema.String,
  filesChanged: Schema.Number,
  insertions: Schema.Number,
  deletions: Schema.Number,
  createdAt: Schema.String,
});
export type ThreadCheckpoint = typeof ThreadCheckpoint.Type;

export const QueuedTurnStatus = Schema.Literals(["queued", "promoted", "canceled"]);
export type QueuedTurnStatus = typeof QueuedTurnStatus.Type;

export const QueuedTurn = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  prompt: Schema.String,
  attachments: Schema.optionalKey(Schema.Array(ThreadAttachment)),
  modelSelection: Schema.optionalKey(ModelSelection),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(InteractionMode),
  position: Schema.Number,
  status: QueuedTurnStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type QueuedTurn = typeof QueuedTurn.Type;

export const ThreadDetail = Schema.Struct({
  thread: Thread,
  turns: Schema.Array(ThreadTurn),
  checkpoints: Schema.optionalKey(Schema.Array(ThreadCheckpoint)),
  queuedTurns: Schema.optionalKey(Schema.Array(QueuedTurn)),
  visualizations: Schema.optionalKey(Schema.Array(ThreadVisualization)),
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

export const SendTurnMode = Schema.Literals(["auto", "steer", "queue"]);
export type SendTurnMode = typeof SendTurnMode.Type;

export const SendTurnInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)),
  mode: Schema.optionalKey(SendTurnMode),
  modelSelection: Schema.optionalKey(ModelSelection),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(InteractionMode),
  attachments: Schema.optionalKey(Schema.Array(ThreadAttachment)),
});
export type SendTurnInput = typeof SendTurnInput.Type;

export const SendTurnDisposition = Schema.Literals(["started", "steered", "queued"]);
export type SendTurnDisposition = typeof SendTurnDisposition.Type;

export const SendTurnResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("started"),
    turn: ThreadTurn,
  }),
  Schema.Struct({
    kind: Schema.Literal("steered"),
    turn: ThreadTurn,
  }),
  Schema.Struct({
    kind: Schema.Literal("queued"),
    queuedTurn: QueuedTurn,
  }),
]);
export type SendTurnResult = typeof SendTurnResult.Type;

export const EditQueuedTurnInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)),
  attachments: Schema.optionalKey(Schema.Array(ThreadAttachment)),
});
export type EditQueuedTurnInput = typeof EditQueuedTurnInput.Type;

export const RewindThreadInput = Schema.Struct({
  checkpointOrdinal: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  restoreFiles: Schema.Boolean,
});
export type RewindThreadInput = typeof RewindThreadInput.Type;

export const RewindThreadResult = Schema.Struct({
  thread: Thread,
  turns: Schema.Array(ThreadTurn),
  checkpoints: Schema.Array(ThreadCheckpoint),
  restoredPrompt: Schema.String,
  filesRestored: Schema.Boolean,
});
export type RewindThreadResult = typeof RewindThreadResult.Type;

export const SettleThreadInput = Schema.Struct({
  settled: Schema.Boolean,
});
export type SettleThreadInput = typeof SettleThreadInput.Type;

export const UpdateThreadInput = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  runtime: Schema.optionalKey(ThreadRuntime),
  branch: Schema.optionalKey(Schema.String),
  modelSelection: Schema.optionalKey(ModelSelection),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  interactionMode: Schema.optionalKey(InteractionMode),
  compactAtTokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type UpdateThreadInput = typeof UpdateThreadInput.Type;

export const RespondApprovalInput = Schema.Struct({
  optionId: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  customText: Schema.optionalKey(Schema.String),
  answers: Schema.optionalKey(UserInputAnswers),
  dismissed: Schema.optionalKey(Schema.Boolean),
});
export type RespondApprovalInput = typeof RespondApprovalInput.Type;

export const CompactThreadInput = Schema.Struct({
  focus: Schema.optionalKey(Schema.String),
});
export type CompactThreadInput = typeof CompactThreadInput.Type;

export const CompactThreadResult = Schema.Struct({
  thread: Thread,
  summary: Schema.String,
  sessionEpoch: Schema.Number,
});
export type CompactThreadResult = typeof CompactThreadResult.Type;

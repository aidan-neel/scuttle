import {
  AgentId,
  AgentIssueId,
  AgentMemoryId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDelegationQuestion,
  AgentIssue,
  AgentIssueActivity,
  AgentMemory,
} from "./agent.ts";
import { ScopedModelTierConfigs } from "./astack.ts";
import { ModelPerfRun } from "./performance.ts";
import { ProviderSnapshot } from "./provider.ts";
import { QueuedTurn, ThreadCheckpoint } from "./thread.ts";
import { ThreadVisualization } from "./viz.ts";
import { ActivityItem, PendingApproval, Project, Thread, ThreadTurn } from "./workspace.ts";

export const RuntimeKind = Schema.Literals(["web", "desktop"]);
export type RuntimeKind = typeof RuntimeKind.Type;

export const HealthStatus = Schema.Struct({
  status: Schema.Literals(["ok"]),
  service: Schema.String,
  version: Schema.String,
  uptimeMs: Schema.Number,
  databaseReady: Schema.Boolean,
  timestamp: Schema.String,
});
export type HealthStatus = typeof HealthStatus.Type;

export const PingRequest = Schema.Struct({
  kind: Schema.Literals(["ping"]),
  id: Schema.String,
});
export type PingRequest = typeof PingRequest.Type;

export const HealthRequest = Schema.Struct({
  kind: Schema.Literals(["health"]),
  id: Schema.String,
});
export type HealthRequest = typeof HealthRequest.Type;

export const RpcRequest = Schema.Union([PingRequest, HealthRequest]);
export type RpcRequest = typeof RpcRequest.Type;

export const PongResponse = Schema.Struct({
  kind: Schema.Literals(["pong"]),
  id: Schema.String,
  serverTime: Schema.String,
});
export type PongResponse = typeof PongResponse.Type;

export const HealthResponse = Schema.Struct({
  kind: Schema.Literals(["health"]),
  id: Schema.String,
  health: HealthStatus,
});
export type HealthResponse = typeof HealthResponse.Type;

export const RpcErrorResponse = Schema.Struct({
  kind: Schema.Literals(["error"]),
  id: Schema.optionalKey(Schema.String),
  code: Schema.String,
  message: Schema.String,
});
export type RpcErrorResponse = typeof RpcErrorResponse.Type;

export const RpcResponse = Schema.Union([PongResponse, HealthResponse, RpcErrorResponse]);
export type RpcResponse = typeof RpcResponse.Type;

export const ProjectUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["project.upserted"]),
  project: Project,
});

export const ProjectDeletedEvent = Schema.Struct({
  kind: Schema.Literals(["project.deleted"]),
  projectId: ProjectId,
});

export const ThreadUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["thread.upserted"]),
  thread: Thread,
});

export const ThreadDeletedEvent = Schema.Struct({
  kind: Schema.Literals(["thread.deleted"]),
  threadId: ThreadId,
});

export const TurnUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["turn.upserted"]),
  turn: ThreadTurn,
});

export const TurnDeltaEvent = Schema.Struct({
  kind: Schema.Literals(["turn.delta"]),
  threadId: ThreadId,
  turnId: TurnId,
  channel: Schema.Literals(["assistant", "thinking"]),
  delta: Schema.String,
  offset: Schema.optionalKey(Schema.Number),
});

export const TurnActivityEvent = Schema.Struct({
  kind: Schema.Literals(["turn.activity"]),
  activity: ActivityItem,
});

export const ApprovalUpdatedEvent = Schema.Struct({
  kind: Schema.Literals(["approval.updated"]),
  approval: PendingApproval,
});

export const ProviderUpdatedEvent = Schema.Struct({
  kind: Schema.Literals(["provider.updated"]),
  provider: ProviderSnapshot,
});

export const AgentUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.upserted"]),
  agent: Agent,
});

export const AgentDeletedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.deleted"]),
  agentId: AgentId,
});

export const AgentMemoryUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.memory.upserted"]),
  memory: AgentMemory,
});

export const AgentMemoryDeletedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.memory.deleted"]),
  agentId: AgentId,
  memoryId: AgentMemoryId,
});

export const AgentIssueUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.issue.upserted"]),
  issue: AgentIssue,
});

export const AgentIssueDeletedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.issue.deleted"]),
  agentId: AgentId,
  issueId: AgentIssueId,
});

export const AgentIssueActivityCreatedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.issue.activity.created"]),
  activity: AgentIssueActivity,
});

export const AgentDelegationUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.delegation.upserted"]),
  delegation: AgentDelegation,
});

export const AgentDelegationQuestionUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.delegation.question.upserted"]),
  question: AgentDelegationQuestion,
});

export const AgentCheckInCreatedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.checkin.created"]),
  checkIn: AgentCheckIn,
});

export const ModelTiersUpdatedEvent = Schema.Struct({
  kind: Schema.Literals(["modelTiers.updated"]),
  modelTiers: ScopedModelTierConfigs,
});

export const CheckpointCreatedEvent = Schema.Struct({
  kind: Schema.Literals(["checkpoint.created"]),
  checkpoint: ThreadCheckpoint,
});

export const ThreadRewoundEvent = Schema.Struct({
  kind: Schema.Literals(["thread.rewound"]),
  threadId: ThreadId,
  checkpointOrdinal: Schema.Number,
});

export const QueueUpdatedEvent = Schema.Struct({
  kind: Schema.Literals(["queue.updated"]),
  threadId: ThreadId,
  queuedTurns: Schema.Array(QueuedTurn),
});

export const VizUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["viz.upserted"]),
  visualization: ThreadVisualization,
});

export const PerfRecordedEvent = Schema.Struct({
  kind: Schema.Literals(["perf.recorded"]),
  run: ModelPerfRun,
});

export const ServerPushEvent = Schema.Union([
  ProjectUpsertedEvent,
  ProjectDeletedEvent,
  ThreadUpsertedEvent,
  ThreadDeletedEvent,
  TurnUpsertedEvent,
  TurnDeltaEvent,
  TurnActivityEvent,
  ApprovalUpdatedEvent,
  ProviderUpdatedEvent,
  AgentUpsertedEvent,
  AgentDeletedEvent,
  AgentMemoryUpsertedEvent,
  AgentMemoryDeletedEvent,
  AgentIssueUpsertedEvent,
  AgentIssueDeletedEvent,
  AgentIssueActivityCreatedEvent,
  AgentDelegationUpsertedEvent,
  AgentDelegationQuestionUpsertedEvent,
  AgentCheckInCreatedEvent,
  ModelTiersUpdatedEvent,
  CheckpointCreatedEvent,
  ThreadRewoundEvent,
  QueueUpdatedEvent,
  VizUpsertedEvent,
  PerfRecordedEvent,
]);
export type ServerPushEvent = typeof ServerPushEvent.Type;

export const ServerWsMessage = Schema.Union([
  PongResponse,
  HealthResponse,
  RpcErrorResponse,
  ProjectUpsertedEvent,
  ProjectDeletedEvent,
  ThreadUpsertedEvent,
  ThreadDeletedEvent,
  TurnUpsertedEvent,
  TurnDeltaEvent,
  TurnActivityEvent,
  ApprovalUpdatedEvent,
  ProviderUpdatedEvent,
  AgentUpsertedEvent,
  AgentDeletedEvent,
  AgentMemoryUpsertedEvent,
  AgentMemoryDeletedEvent,
  AgentIssueUpsertedEvent,
  AgentIssueDeletedEvent,
  AgentIssueActivityCreatedEvent,
  AgentDelegationUpsertedEvent,
  AgentDelegationQuestionUpsertedEvent,
  AgentCheckInCreatedEvent,
  ModelTiersUpdatedEvent,
  CheckpointCreatedEvent,
  ThreadRewoundEvent,
  QueueUpdatedEvent,
  VizUpsertedEvent,
  PerfRecordedEvent,
]);
export type ServerWsMessage = typeof ServerWsMessage.Type;

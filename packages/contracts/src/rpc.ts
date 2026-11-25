import {
  AgentId,
  AgentIssueId,
  AgentMemoryId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { Agent, AgentCheckIn, AgentDelegation, AgentIssue, AgentMemory } from "./agent.ts";
import { ProviderSnapshot } from "./provider.ts";
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

export const AgentDelegationUpsertedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.delegation.upserted"]),
  delegation: AgentDelegation,
});

export const AgentCheckInCreatedEvent = Schema.Struct({
  kind: Schema.Literals(["agent.checkin.created"]),
  checkIn: AgentCheckIn,
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
  AgentDelegationUpsertedEvent,
  AgentCheckInCreatedEvent,
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
  AgentDelegationUpsertedEvent,
  AgentCheckInCreatedEvent,
]);
export type ServerWsMessage = typeof ServerWsMessage.Type;

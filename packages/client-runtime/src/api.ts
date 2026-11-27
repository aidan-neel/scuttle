import {
  AcpRegistryAgentSummary,
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDelegationQuestion,
  AgentDetail,
  AgentIssue,
  AgentIssueActivity,
  AgentMemory,
  type AskDelegationParentInput,
  type AssignAgentIssueInput,
  AssignAgentIssueResult,
  type CompactThreadInput,
  CompactThreadResult,
  type CreateAgentInput,
  type CreateIssueCommentInput,
  type CreateIssueInput,
  type CreateMemoryInput,
  type CreateProjectInput,
  type CreateProviderInstanceInput,
  type CreateThreadInput,
  type DelegateAgentTaskInput,
  DirectoryListing,
  type EditQueuedTurnInput,
  GitBranchInfo,
  type InstallAcpAgentInput,
  type ModelPerfQueryInput,
  ModelPerfRun,
  ModelPerformanceSummary,
  type ModelTierConfig,
  type ModelTierScope,
  Project,
  type ProviderConfigPatch,
  ProviderSnapshot,
  QueuedTurn,
  type RateModelRunInput,
  type RespondApprovalInput,
  type RewindThreadInput,
  RewindThreadResult,
  ScopedModelTierConfigs,
  ScuttleSkill,
  ScuttleSkillDetail,
  type SendTurnInput,
  SendTurnResult,
  type SettleThreadInput,
  type SetupAgentStartInput,
  Thread,
  ThreadDetail,
  ThreadTurn,
  ThreadVisualization,
  type TriggerCheckInInput,
  type UpdateAgentInput,
  type UpdateIssueInput,
  type UpdateMemoryInput,
  type UpdateThreadInput,
  UploadedAttachment,
  type UsageProviderFilter,
  type UsageRange,
  UsageReport,
  WorkspaceSnapshot,
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { postJson, requestJson, requestVoid } from "./httpHelpers.ts";

export { createScuttleGitApi, type GitTargetRef, type ScuttleGitApi } from "./gitApi.ts";
export { describeApiError } from "./httpHelpers.ts";

const decodeWorkspace = Schema.decodeUnknownEffect(WorkspaceSnapshot);
const decodeAgents = Schema.decodeUnknownEffect(Schema.Array(Agent));
const decodeAgent = Schema.decodeUnknownEffect(Agent);
const decodeAgentDetail = Schema.decodeUnknownEffect(AgentDetail);
const decodeAgentMemories = Schema.decodeUnknownEffect(Schema.Array(AgentMemory));
const decodeAgentMemory = Schema.decodeUnknownEffect(AgentMemory);
const decodeAgentIssues = Schema.decodeUnknownEffect(Schema.Array(AgentIssue));
const decodeAgentIssue = Schema.decodeUnknownEffect(AgentIssue);
const decodeAgentIssueActivities = Schema.decodeUnknownEffect(Schema.Array(AgentIssueActivity));
const decodeAgentIssueActivity = Schema.decodeUnknownEffect(AgentIssueActivity);
const decodeAgentDelegation = Schema.decodeUnknownEffect(AgentDelegation);
const decodeAgentDelegationQuestion = Schema.decodeUnknownEffect(AgentDelegationQuestion);
const decodeAgentDelegationQuestions = Schema.decodeUnknownEffect(
  Schema.Array(AgentDelegationQuestion),
);
const decodeAssignIssueResult = Schema.decodeUnknownEffect(AssignAgentIssueResult);
const decodeAgentCheckIn = Schema.decodeUnknownEffect(AgentCheckIn);
const decodeProject = Schema.decodeUnknownEffect(Project);
const decodeBranches = Schema.decodeUnknownEffect(Schema.Array(GitBranchInfo));
const decodeDirectory = Schema.decodeUnknownEffect(DirectoryListing);
const decodeProviders = Schema.decodeUnknownEffect(Schema.Array(ProviderSnapshot));
const decodeProvider = Schema.decodeUnknownEffect(ProviderSnapshot);
const decodeAcpRegistryAgents = Schema.decodeUnknownEffect(Schema.Array(AcpRegistryAgentSummary));
const decodeThread = Schema.decodeUnknownEffect(Thread);
const decodeThreadDetail = Schema.decodeUnknownEffect(ThreadDetail);
const decodeCompactThreadResult = Schema.decodeUnknownEffect(CompactThreadResult);
const decodeTurn = Schema.decodeUnknownEffect(ThreadTurn);
const decodeUploadedAttachment = Schema.decodeUnknownEffect(UploadedAttachment);
const decodeSkills = Schema.decodeUnknownEffect(Schema.Array(ScuttleSkill));
const decodeSkillDetail = Schema.decodeUnknownEffect(ScuttleSkillDetail);
const decodeModelTiers = Schema.decodeUnknownEffect(ScopedModelTierConfigs);
const decodeUsageReport = Schema.decodeUnknownEffect(UsageReport);
const decodeSendTurnResponse = Schema.decodeUnknownEffect(
  Schema.Union([SendTurnResult, ThreadTurn]),
);
const decodeRewindResult = Schema.decodeUnknownEffect(RewindThreadResult);
const decodeQueuedTurn = Schema.decodeUnknownEffect(QueuedTurn);
const decodeQueuedTurns = Schema.decodeUnknownEffect(Schema.Array(QueuedTurn));
const decodeSendTurnResult = Schema.decodeUnknownEffect(SendTurnResult);
const decodeVisualizations = Schema.decodeUnknownEffect(Schema.Array(ThreadVisualization));
const decodePerformanceSummary = Schema.decodeUnknownEffect(ModelPerformanceSummary);
const decodePerfRun = Schema.decodeUnknownEffect(ModelPerfRun);

const toSendTurnResult = (response: SendTurnResult | ThreadTurn): SendTurnResult =>
  "kind" in response ? response : { kind: "started", turn: response };

const performanceQueryString = (query: ModelPerfQueryInput | undefined): string => {
  const qs = new URLSearchParams();
  if (query?.model) qs.set("model", query.model);
  if (query?.providerId) qs.set("providerId", query.providerId);
  if (query?.category) qs.set("category", query.category);
  if (query?.days !== undefined) qs.set("days", String(query.days));
  if (query?.limit !== undefined) qs.set("limit", String(query.limit));
  return qs.size > 0 ? `?${qs.toString()}` : "";
};

export interface ScuttleApiClient {
  readonly getWorkspace: () => Promise<WorkspaceSnapshot>;
  readonly getUsage: (params?: {
    readonly range?: UsageRange;
    readonly provider?: UsageProviderFilter;
    readonly refresh?: boolean;
  }) => Promise<UsageReport>;
  readonly listSkills: () => Promise<ReadonlyArray<ScuttleSkill>>;
  readonly getSkillDetail: (id: string, file?: string) => Promise<ScuttleSkillDetail>;
  readonly getModelTiers: () => Promise<ScopedModelTierConfigs>;
  readonly updateModelTiers: (
    scope: ModelTierScope,
    config: ModelTierConfig,
  ) => Promise<ScopedModelTierConfigs>;
  readonly createProject: (input: CreateProjectInput) => Promise<Project>;
  readonly deleteProject: (projectId: string) => Promise<void>;
  readonly listBranches: (projectId: string) => Promise<ReadonlyArray<GitBranchInfo>>;
  readonly listDirectory: (
    dirPath?: string,
    options?: { readonly includeFiles?: boolean },
  ) => Promise<DirectoryListing>;
  readonly refreshProviders: () => Promise<ReadonlyArray<ProviderSnapshot>>;
  readonly createProviderInstance: (
    input: CreateProviderInstanceInput,
  ) => Promise<ProviderSnapshot>;
  readonly updateProvider: (
    providerId: string,
    patch: ProviderConfigPatch,
  ) => Promise<ProviderSnapshot>;
  readonly deleteProviderInstance: (providerId: string) => Promise<void>;
  readonly listAcpRegistry: (options?: {
    readonly refresh?: boolean;
  }) => Promise<ReadonlyArray<AcpRegistryAgentSummary>>;
  readonly installAcpAgent: (input: InstallAcpAgentInput) => Promise<ProviderSnapshot>;
  readonly getThreadDetail: (threadId: string) => Promise<ThreadDetail>;
  readonly createThread: (input: CreateThreadInput) => Promise<ThreadDetail>;
  readonly sendTurn: (threadId: string, input: SendTurnInput) => Promise<SendTurnResult>;
  readonly rewindThread: (
    threadId: string,
    input: RewindThreadInput,
  ) => Promise<RewindThreadResult>;
  readonly listQueuedTurns: (threadId: string) => Promise<ReadonlyArray<QueuedTurn>>;
  readonly editQueuedTurn: (
    threadId: string,
    queuedId: string,
    input: EditQueuedTurnInput,
  ) => Promise<QueuedTurn>;
  readonly cancelQueuedTurn: (threadId: string, queuedId: string) => Promise<void>;
  readonly promoteQueuedTurn: (threadId: string, queuedId: string) => Promise<SendTurnResult>;
  readonly listVisualizations: (threadId: string) => Promise<ReadonlyArray<ThreadVisualization>>;
  readonly getPerformanceSummary: (query?: ModelPerfQueryInput) => Promise<ModelPerformanceSummary>;
  readonly rateModelRun: (input: RateModelRunInput) => Promise<ModelPerfRun>;
  readonly deletePerformanceRun: (runId: string) => Promise<void>;
  readonly uploadAttachment: (file: File) => Promise<UploadedAttachment>;
  readonly interruptTurn: (threadId: string) => Promise<void>;
  readonly settleThread: (threadId: string, input: SettleThreadInput) => Promise<Thread>;
  readonly compactThread: (
    threadId: string,
    input?: CompactThreadInput,
  ) => Promise<CompactThreadResult>;
  readonly updateThread: (threadId: string, input: UpdateThreadInput) => Promise<Thread>;
  readonly deleteThread: (threadId: string) => Promise<void>;
  readonly respondApproval: (
    threadId: string,
    approvalId: string,
    input: RespondApprovalInput,
  ) => Promise<void>;
  readonly listAgents: () => Promise<ReadonlyArray<Agent>>;
  readonly createAgent: (input: CreateAgentInput) => Promise<Agent>;
  readonly getAgentDetail: (agentId: string) => Promise<AgentDetail>;
  readonly updateAgent: (agentId: string, input: UpdateAgentInput) => Promise<Agent>;
  readonly deleteAgent: (agentId: string) => Promise<void>;
  readonly sendAgentTurn: (agentId: string, input: SendTurnInput) => Promise<ThreadTurn>;
  readonly startAgentSetup: (agentId: string, input?: SetupAgentStartInput) => Promise<ThreadTurn>;
  readonly listAgentMemories: (
    agentId: string,
    query?: string,
  ) => Promise<ReadonlyArray<AgentMemory>>;
  readonly createAgentMemory: (agentId: string, input: CreateMemoryInput) => Promise<AgentMemory>;
  readonly updateAgentMemory: (
    agentId: string,
    memoryId: string,
    input: UpdateMemoryInput,
  ) => Promise<AgentMemory>;
  readonly deleteAgentMemory: (agentId: string, memoryId: string) => Promise<void>;
  readonly listAllIssues: () => Promise<ReadonlyArray<AgentIssue>>;
  readonly listAgentIssues: (agentId: string) => Promise<ReadonlyArray<AgentIssue>>;
  readonly createAgentIssue: (agentId: string, input: CreateIssueInput) => Promise<AgentIssue>;
  readonly updateAgentIssue: (
    agentId: string,
    issueId: string,
    input: UpdateIssueInput,
  ) => Promise<AgentIssue>;
  readonly deleteAgentIssue: (agentId: string, issueId: string) => Promise<void>;
  readonly listIssueActivities: (
    agentId: string,
    issueId: string,
  ) => Promise<ReadonlyArray<AgentIssueActivity>>;
  readonly createIssueComment: (
    agentId: string,
    issueId: string,
    input: CreateIssueCommentInput,
  ) => Promise<AgentIssueActivity>;
  readonly syncAgentIssues: (agentId: string) => Promise<ReadonlyArray<AgentIssue>>;
  readonly assignAgentIssue: (
    agentId: string,
    issueId: string,
    input?: AssignAgentIssueInput,
  ) => Promise<AssignAgentIssueResult>;
  readonly delegateAgentTask: (
    agentId: string,
    input: DelegateAgentTaskInput,
  ) => Promise<AgentDelegation>;
  readonly cancelAgentDelegation: (
    agentId: string,
    delegationId: string,
  ) => Promise<AgentDelegation>;
  readonly askDelegationParent: (
    agentId: string,
    delegationId: string,
    input: AskDelegationParentInput,
  ) => Promise<AgentDelegationQuestion>;
  readonly listDelegationQuestions: (
    agentId: string,
    delegationId: string,
  ) => Promise<ReadonlyArray<AgentDelegationQuestion>>;
  readonly triggerAgentCheckIn: (
    agentId: string,
    input?: TriggerCheckInInput,
  ) => Promise<AgentCheckIn>;
}

export const createScuttleApiClient = (baseUrl?: string): ScuttleApiClient => {
  const json = <A>(
    path: string,
    init: RequestInit | undefined,
    decode: (input: unknown) => Effect.Effect<A, unknown>,
  ) => Effect.runPromise(requestJson(baseUrl, path, init, decode));
  const empty = (path: string, init: RequestInit | undefined) =>
    Effect.runPromise(requestVoid(baseUrl, path, init));
  const agentPath = (agentId: string, suffix = "") =>
    `/api/agents/${encodeURIComponent(agentId)}${suffix}`;
  const threadPath = (threadId: string, suffix = "") =>
    `/api/threads/${encodeURIComponent(threadId)}${suffix}`;
  const queuePath = (threadId: string, queuedId: string, suffix = "") =>
    threadPath(threadId, `/queue/${encodeURIComponent(queuedId)}${suffix}`);

  return {
    getWorkspace: () => json("/api/workspace", undefined, decodeWorkspace),
    getUsage: (params) => {
      const qs = new URLSearchParams();
      if (params?.range) qs.set("range", params.range);
      if (params?.provider) qs.set("provider", params.provider);
      if (params?.refresh) qs.set("refresh", "1");
      const query = qs.size > 0 ? `?${qs.toString()}` : "";
      return json(`/api/usage${query}`, undefined, decodeUsageReport);
    },
    listSkills: () => json("/api/skills", undefined, decodeSkills),
    getSkillDetail: (id, file) => {
      const query = file ? `?file=${encodeURIComponent(file)}` : "";
      return json(`/api/skills/${encodeURIComponent(id)}${query}`, undefined, decodeSkillDetail);
    },
    getModelTiers: () => json("/api/model-tiers", undefined, decodeModelTiers),
    updateModelTiers: (scope, config) =>
      json(
        "/api/model-tiers",
        { method: "PUT", body: JSON.stringify({ scope, config }) },
        decodeModelTiers,
      ),
    createProject: (input) => json("/api/projects", postJson(input), decodeProject),
    deleteProject: (projectId) =>
      empty(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
    listBranches: (projectId) =>
      json(`/api/projects/${encodeURIComponent(projectId)}/branches`, undefined, decodeBranches),
    listDirectory: (dirPath, options) => {
      const params = new URLSearchParams();
      if (dirPath) params.set("path", dirPath);
      if (options?.includeFiles) params.set("includeFiles", "1");
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return json(`/api/fs/list${query}`, undefined, decodeDirectory);
    },
    refreshProviders: () => json("/api/providers/refresh", postJson(), decodeProviders),
    createProviderInstance: (input) => json("/api/providers", postJson(input), decodeProvider),
    updateProvider: (providerId, patch) =>
      json(
        `/api/providers/${encodeURIComponent(providerId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        decodeProvider,
      ),
    deleteProviderInstance: (providerId) =>
      empty(`/api/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" }),
    listAcpRegistry: (options) => {
      const qs = options?.refresh ? "?refresh=1" : "";
      return json(`/api/acp-registry${qs}`, undefined, decodeAcpRegistryAgents);
    },
    installAcpAgent: (input) => json("/api/acp-registry/install", postJson(input), decodeProvider),
    getThreadDetail: (threadId) =>
      json(`/api/threads/${encodeURIComponent(threadId)}`, undefined, decodeThreadDetail),
    createThread: (input) => json("/api/threads", postJson(input), decodeThreadDetail),
    sendTurn: (threadId, input) =>
      json(threadPath(threadId, "/turns"), postJson(input), decodeSendTurnResponse).then(
        toSendTurnResult,
      ),
    rewindThread: (threadId, input) =>
      json(threadPath(threadId, "/rewind"), postJson(input), decodeRewindResult),
    listQueuedTurns: (threadId) =>
      json(threadPath(threadId, "/queue"), undefined, decodeQueuedTurns),
    editQueuedTurn: (threadId, queuedId, input) =>
      json(
        queuePath(threadId, queuedId),
        { method: "PATCH", body: JSON.stringify(input) },
        decodeQueuedTurn,
      ),
    cancelQueuedTurn: (threadId, queuedId) =>
      empty(queuePath(threadId, queuedId), { method: "DELETE" }),
    promoteQueuedTurn: (threadId, queuedId) =>
      json(queuePath(threadId, queuedId, "/promote"), postJson(), decodeSendTurnResult),
    listVisualizations: (threadId) =>
      json(threadPath(threadId, "/visualizations"), undefined, decodeVisualizations),
    getPerformanceSummary: (query) =>
      json(`/api/performance${performanceQueryString(query)}`, undefined, decodePerformanceSummary),
    rateModelRun: (input) => json("/api/performance/rate", postJson(input), decodePerfRun),
    deletePerformanceRun: (runId) =>
      empty(`/api/performance/runs/${encodeURIComponent(runId)}`, { method: "DELETE" }),
    uploadAttachment: (file) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return json("/api/attachments", { method: "POST", body: form }, decodeUploadedAttachment);
    },
    interruptTurn: (threadId) =>
      empty(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, postJson()),
    settleThread: (threadId, input) =>
      json(`/api/threads/${encodeURIComponent(threadId)}/settle`, postJson(input), decodeThread),
    compactThread: (threadId, input) =>
      json(
        `/api/threads/${encodeURIComponent(threadId)}/compact`,
        postJson(input ?? {}),
        decodeCompactThreadResult,
      ),
    updateThread: (threadId, input) =>
      json(
        `/api/threads/${encodeURIComponent(threadId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
        decodeThread,
      ),
    deleteThread: (threadId) =>
      empty(`/api/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" }),
    respondApproval: (threadId, approvalId, input) =>
      empty(
        `/api/threads/${encodeURIComponent(threadId)}/approvals/${encodeURIComponent(approvalId)}`,
        postJson(input),
      ),
    listAgents: () => json("/api/agents", undefined, decodeAgents),
    createAgent: (input) => json("/api/agents", postJson(input), decodeAgent),
    getAgentDetail: (agentId) => json(agentPath(agentId), undefined, decodeAgentDetail),
    updateAgent: (agentId, input) =>
      json(agentPath(agentId), { method: "PATCH", body: JSON.stringify(input) }, decodeAgent),
    deleteAgent: (agentId) => empty(agentPath(agentId), { method: "DELETE" }),
    sendAgentTurn: (agentId, input) =>
      json(agentPath(agentId, "/turns"), postJson(input), decodeTurn),
    startAgentSetup: (agentId, input) =>
      json(agentPath(agentId, "/setup/start"), postJson(input ?? {}), decodeTurn),
    listAgentMemories: (agentId, query) => {
      const qs = query && query.trim().length > 0 ? `?q=${encodeURIComponent(query)}` : "";
      return json(agentPath(agentId, `/memories${qs}`), undefined, decodeAgentMemories);
    },
    createAgentMemory: (agentId, input) =>
      json(agentPath(agentId, "/memories"), postJson(input), decodeAgentMemory),
    updateAgentMemory: (agentId, memoryId, input) =>
      json(
        agentPath(agentId, `/memories/${encodeURIComponent(memoryId)}`),
        { method: "PATCH", body: JSON.stringify(input) },
        decodeAgentMemory,
      ),
    deleteAgentMemory: (agentId, memoryId) =>
      empty(agentPath(agentId, `/memories/${encodeURIComponent(memoryId)}`), {
        method: "DELETE",
      }),
    listAllIssues: () => json("/api/issues", undefined, decodeAgentIssues),
    listAgentIssues: (agentId) => json(agentPath(agentId, "/issues"), undefined, decodeAgentIssues),
    createAgentIssue: (agentId, input) =>
      json(agentPath(agentId, "/issues"), postJson(input), decodeAgentIssue),
    updateAgentIssue: (agentId, issueId, input) =>
      json(
        agentPath(agentId, `/issues/${encodeURIComponent(issueId)}`),
        { method: "PATCH", body: JSON.stringify(input) },
        decodeAgentIssue,
      ),
    deleteAgentIssue: (agentId, issueId) =>
      empty(agentPath(agentId, `/issues/${encodeURIComponent(issueId)}`), { method: "DELETE" }),
    listIssueActivities: (agentId, issueId) =>
      json(
        agentPath(agentId, `/issues/${encodeURIComponent(issueId)}/activities`),
        undefined,
        decodeAgentIssueActivities,
      ),
    createIssueComment: (agentId, issueId, input) =>
      json(
        agentPath(agentId, `/issues/${encodeURIComponent(issueId)}/comments`),
        postJson(input),
        decodeAgentIssueActivity,
      ),
    syncAgentIssues: (agentId) =>
      json(agentPath(agentId, "/issues/sync"), postJson(), decodeAgentIssues),
    assignAgentIssue: (agentId, issueId, input) =>
      json(
        agentPath(agentId, `/issues/${encodeURIComponent(issueId)}/assign`),
        postJson(input ?? {}),
        decodeAssignIssueResult,
      ),
    delegateAgentTask: (agentId, input) =>
      json(agentPath(agentId, "/delegations"), postJson(input), decodeAgentDelegation),
    cancelAgentDelegation: (agentId, delegationId) =>
      json(
        agentPath(agentId, `/delegations/${encodeURIComponent(delegationId)}/cancel`),
        postJson(),
        decodeAgentDelegation,
      ),
    askDelegationParent: (agentId, delegationId, input) =>
      json(
        agentPath(agentId, `/delegations/${encodeURIComponent(delegationId)}/ask`),
        postJson(input),
        decodeAgentDelegationQuestion,
      ),
    listDelegationQuestions: (agentId, delegationId) =>
      json(
        agentPath(agentId, `/delegations/${encodeURIComponent(delegationId)}/questions`),
        undefined,
        decodeAgentDelegationQuestions,
      ),
    triggerAgentCheckIn: (agentId, input) =>
      json(agentPath(agentId, "/checkins"), postJson(input ?? {}), decodeAgentCheckIn),
  };
};

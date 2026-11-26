import {
  Agent,
  AgentCheckIn,
  AgentDelegation,
  AgentDetail,
  AgentIssue,
  AgentMemory,
  type AssignAgentIssueInput,
  AssignAgentIssueResult,
  type CompactThreadInput,
  CompactThreadResult,
  type CreateAgentInput,
  type CreateIssueInput,
  type CreateMemoryInput,
  type CreatePullRequestInput,
  type DelegateAgentTaskInput,
  DeviceFlowPoll,
  DeviceFlowStart,
  type ForgeKind,
  ForgeStatus,
  type ForgeTokenInput,
  GitActionResult,
  type GitCheckoutInput,
  type GitCommitInput,
  GitStatus,
  PullRequest,
  PullRequestList,
  type SetupAgentStartInput,
  type TriggerCheckInInput,
  type UpdateAgentInput,
  type UpdateIssueInput,
  type UpdateMemoryInput,
  type CreateProjectInput,
  type CreateThreadInput,
  DirectoryListing,
  GitBranchInfo,
  Project,
  type ProviderConfigPatch,
  ProviderSnapshot,
  type RespondApprovalInput,
  type SendTurnInput,
  type SettleThreadInput,
  Thread,
  ThreadDetail,
  ThreadTurn,
  type UpdateThreadInput,
  WorkspaceSnapshot,
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { resolveBaseHttpUrl, ServerFetchError } from "./connection.ts";

const decodeWorkspace = Schema.decodeUnknownEffect(WorkspaceSnapshot);
const decodeAgents = Schema.decodeUnknownEffect(Schema.Array(Agent));
const decodeAgent = Schema.decodeUnknownEffect(Agent);
const decodeAgentDetail = Schema.decodeUnknownEffect(AgentDetail);
const decodeAgentMemories = Schema.decodeUnknownEffect(Schema.Array(AgentMemory));
const decodeAgentMemory = Schema.decodeUnknownEffect(AgentMemory);
const decodeAgentIssues = Schema.decodeUnknownEffect(Schema.Array(AgentIssue));
const decodeAgentIssue = Schema.decodeUnknownEffect(AgentIssue);
const decodeAgentDelegation = Schema.decodeUnknownEffect(AgentDelegation);
const decodeAssignIssueResult = Schema.decodeUnknownEffect(AssignAgentIssueResult);
const decodeAgentCheckIn = Schema.decodeUnknownEffect(AgentCheckIn);
const decodeProject = Schema.decodeUnknownEffect(Project);
const decodeBranches = Schema.decodeUnknownEffect(Schema.Array(GitBranchInfo));
const decodeDirectory = Schema.decodeUnknownEffect(DirectoryListing);
const decodeProviders = Schema.decodeUnknownEffect(Schema.Array(ProviderSnapshot));
const decodeProvider = Schema.decodeUnknownEffect(ProviderSnapshot);
const decodeThread = Schema.decodeUnknownEffect(Thread);
const decodeThreadDetail = Schema.decodeUnknownEffect(ThreadDetail);
const decodeCompactThreadResult = Schema.decodeUnknownEffect(CompactThreadResult);
const decodeTurn = Schema.decodeUnknownEffect(ThreadTurn);
const decodeForges = Schema.decodeUnknownEffect(Schema.Array(ForgeStatus));
const decodeForge = Schema.decodeUnknownEffect(ForgeStatus);
const decodeDeviceStart = Schema.decodeUnknownEffect(DeviceFlowStart);
const decodeDevicePoll = Schema.decodeUnknownEffect(DeviceFlowPoll);
const decodeGitStatus = Schema.decodeUnknownEffect(GitStatus);
const decodeGitAction = Schema.decodeUnknownEffect(GitActionResult);
const decodePullRequests = Schema.decodeUnknownEffect(PullRequestList);
const decodePullRequest = Schema.decodeUnknownEffect(PullRequest);

export const describeApiError = (error: unknown, fallback: string): string => {
  if (error instanceof ServerFetchError && error.cause instanceof Error) {
    return error.cause.message;
  }
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const err = payload.error;
    if (typeof err === "string" && err.length > 0) return err;
  }
  return fallback;
};

const buildHeaders = (init: RequestInit | undefined): Headers => {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
};

const requestJson = <A>(
  baseUrl: string | undefined,
  path: string,
  init: RequestInit | undefined,
  decode: (input: unknown) => Effect.Effect<A, unknown>,
) =>
  Effect.gen(function* () {
    const endpoint = `${resolveBaseHttpUrl(baseUrl)}${path}`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(endpoint, {
          ...init,
          headers: buildHeaders(init),
        }),
      catch: (cause) => new ServerFetchError({ endpoint, cause }),
    });
    const payload: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => null,
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    if (!response.ok) {
      const msg = extractErrorMessage(payload, `HTTP ${response.status}`);
      return yield* new ServerFetchError({
        endpoint,
        status: response.status,
        cause: new Error(msg),
      });
    }
    return yield* decode(payload).pipe(
      Effect.mapError((cause) => new ServerFetchError({ endpoint, cause })),
    );
  });

const requestVoid = (baseUrl: string | undefined, path: string, init: RequestInit | undefined) =>
  Effect.gen(function* () {
    const endpoint = `${resolveBaseHttpUrl(baseUrl)}${path}`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(endpoint, {
          ...init,
          headers: buildHeaders(init),
        }),
      catch: (cause) => new ServerFetchError({ endpoint, cause }),
    });
    if (!response.ok) {
      const payload: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => null,
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      const msg = extractErrorMessage(payload, `HTTP ${response.status}`);
      return yield* new ServerFetchError({
        endpoint,
        status: response.status,
        cause: new Error(msg),
      });
    }
  });

export interface GitTargetRef {
  readonly projectId: string;
  readonly threadId?: string;
}

const gitPath = (target: GitTargetRef, action: string): string => {
  const query =
    target.threadId !== undefined ? `?threadId=${encodeURIComponent(target.threadId)}` : "";
  return `/api/projects/${encodeURIComponent(target.projectId)}/git/${action}${query}`;
};

const postJson = (body?: unknown): RequestInit =>
  body === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(body) };

export interface ScuttleGitApi {
  readonly listForges: (refresh?: boolean) => Promise<ReadonlyArray<ForgeStatus>>;
  readonly connectForgeToken: (input: ForgeTokenInput) => Promise<ForgeStatus>;
  readonly disconnectForge: (forge: ForgeKind) => Promise<ForgeStatus>;
  readonly startGithubDeviceFlow: () => Promise<DeviceFlowStart>;
  readonly pollGithubDeviceFlow: (flowId: string) => Promise<DeviceFlowPoll>;
  readonly getGitStatus: (target: GitTargetRef) => Promise<GitStatus>;
  readonly commitGit: (target: GitTargetRef, input: GitCommitInput) => Promise<GitActionResult>;
  readonly pushGit: (target: GitTargetRef) => Promise<GitActionResult>;
  readonly pullGit: (target: GitTargetRef) => Promise<GitActionResult>;
  readonly checkoutGit: (target: GitTargetRef, input: GitCheckoutInput) => Promise<GitActionResult>;
  readonly listPullRequests: (target: GitTargetRef) => Promise<PullRequestList>;
  readonly createPullRequest: (
    target: GitTargetRef,
    input: CreatePullRequestInput,
  ) => Promise<PullRequest>;
}

export const createScuttleGitApi = (baseUrl?: string): ScuttleGitApi => {
  const call = <A>(
    path: string,
    init: RequestInit | undefined,
    decode: (input: unknown) => Effect.Effect<A, unknown>,
  ) => Effect.runPromise(requestJson(baseUrl, path, init, decode));
  return {
    listForges: (refresh) =>
      call(`/api/git/forges${refresh === true ? "?refresh=1" : ""}`, undefined, decodeForges),
    connectForgeToken: (input) => call("/api/git/forges/token", postJson(input), decodeForge),
    disconnectForge: (forge) =>
      call(`/api/git/forges/${encodeURIComponent(forge)}`, { method: "DELETE" }, decodeForge),
    startGithubDeviceFlow: () =>
      call("/api/git/forges/github/device/start", postJson(), decodeDeviceStart),
    pollGithubDeviceFlow: (flowId) =>
      call("/api/git/forges/github/device/poll", postJson({ flowId }), decodeDevicePoll),
    getGitStatus: (target) => call(gitPath(target, "status"), undefined, decodeGitStatus),
    commitGit: (target, input) => call(gitPath(target, "commit"), postJson(input), decodeGitAction),
    pushGit: (target) => call(gitPath(target, "push"), postJson(), decodeGitAction),
    pullGit: (target) => call(gitPath(target, "pull"), postJson(), decodeGitAction),
    checkoutGit: (target, input) =>
      call(gitPath(target, "checkout"), postJson(input), decodeGitAction),
    listPullRequests: (target) =>
      call(gitPath(target, "pull-requests"), undefined, decodePullRequests),
    createPullRequest: (target, input) =>
      call(gitPath(target, "pull-requests"), postJson(input), decodePullRequest),
  };
};

export interface ScuttleApiClient {
  readonly getWorkspace: () => Promise<WorkspaceSnapshot>;
  readonly createProject: (input: CreateProjectInput) => Promise<Project>;
  readonly deleteProject: (projectId: string) => Promise<void>;
  readonly listBranches: (projectId: string) => Promise<ReadonlyArray<GitBranchInfo>>;
  readonly listDirectory: (dirPath?: string) => Promise<DirectoryListing>;
  readonly refreshProviders: () => Promise<ReadonlyArray<ProviderSnapshot>>;
  readonly updateProvider: (
    providerId: string,
    patch: ProviderConfigPatch,
  ) => Promise<ProviderSnapshot>;
  readonly getThreadDetail: (threadId: string) => Promise<ThreadDetail>;
  readonly createThread: (input: CreateThreadInput) => Promise<ThreadDetail>;
  readonly sendTurn: (threadId: string, input: SendTurnInput) => Promise<ThreadTurn>;
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
  readonly listAgentIssues: (agentId: string) => Promise<ReadonlyArray<AgentIssue>>;
  readonly createAgentIssue: (agentId: string, input: CreateIssueInput) => Promise<AgentIssue>;
  readonly updateAgentIssue: (
    agentId: string,
    issueId: string,
    input: UpdateIssueInput,
  ) => Promise<AgentIssue>;
  readonly deleteAgentIssue: (agentId: string, issueId: string) => Promise<void>;
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

  return {
    getWorkspace: () => json("/api/workspace", undefined, decodeWorkspace),
    createProject: (input) => json("/api/projects", postJson(input), decodeProject),
    deleteProject: (projectId) =>
      empty(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
    listBranches: (projectId) =>
      json(`/api/projects/${encodeURIComponent(projectId)}/branches`, undefined, decodeBranches),
    listDirectory: (dirPath) => {
      const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      return json(`/api/fs/list${query}`, undefined, decodeDirectory);
    },
    refreshProviders: () => json("/api/providers/refresh", postJson(), decodeProviders),
    updateProvider: (providerId, patch) =>
      json(
        `/api/providers/${encodeURIComponent(providerId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        decodeProvider,
      ),
    getThreadDetail: (threadId) =>
      json(`/api/threads/${encodeURIComponent(threadId)}`, undefined, decodeThreadDetail),
    createThread: (input) => json("/api/threads", postJson(input), decodeThreadDetail),
    sendTurn: (threadId, input) =>
      json(`/api/threads/${encodeURIComponent(threadId)}/turns`, postJson(input), decodeTurn),
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
    triggerAgentCheckIn: (agentId, input) =>
      json(agentPath(agentId, "/checkins"), postJson(input ?? {}), decodeAgentCheckIn),
  };
};

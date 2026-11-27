import {
  type CreatePullRequestInput,
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
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { postJson, requestJson } from "./httpHelpers.ts";

const decodeForges = Schema.decodeUnknownEffect(Schema.Array(ForgeStatus));
const decodeForge = Schema.decodeUnknownEffect(ForgeStatus);
const decodeDeviceStart = Schema.decodeUnknownEffect(DeviceFlowStart);
const decodeDevicePoll = Schema.decodeUnknownEffect(DeviceFlowPoll);
const decodeGitStatus = Schema.decodeUnknownEffect(GitStatus);
const decodeGitAction = Schema.decodeUnknownEffect(GitActionResult);
const decodePullRequests = Schema.decodeUnknownEffect(PullRequestList);
const decodePullRequest = Schema.decodeUnknownEffect(PullRequest);

export interface GitTargetRef {
  readonly projectId: string;
  readonly threadId?: string;
}

const gitPath = (target: GitTargetRef, action: string): string => {
  const query =
    target.threadId !== undefined ? `?threadId=${encodeURIComponent(target.threadId)}` : "";
  return `/api/projects/${encodeURIComponent(target.projectId)}/git/${action}${query}`;
};

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

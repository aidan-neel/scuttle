import * as Schema from "effect/Schema";

export const ForgeKind = Schema.Literals(["github", "gitlab"]);
export type ForgeKind = typeof ForgeKind.Type;

export const RemoteForge = Schema.Literals(["github", "gitlab", "other", "none"]);
export type RemoteForge = typeof RemoteForge.Type;

export const ForgeAuthSource = Schema.Literals(["gh-cli", "glab-cli", "oauth", "token", "none"]);
export type ForgeAuthSource = typeof ForgeAuthSource.Type;

export const ForgeStatus = Schema.Struct({
  forge: ForgeKind,
  connected: Schema.Boolean,
  authSource: ForgeAuthSource,
  host: Schema.String,
  username: Schema.NullOr(Schema.String),
  cliInstalled: Schema.Boolean,
  cliVersion: Schema.NullOr(Schema.String),
  cliAuthenticated: Schema.Boolean,
  hasStoredCredential: Schema.Boolean,
  oauthAvailable: Schema.Boolean,
});
export type ForgeStatus = typeof ForgeStatus.Type;

export const GitFileStatus = Schema.Literals([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "untracked",
  "conflicted",
]);
export type GitFileStatus = typeof GitFileStatus.Type;

export const GitChangedFile = Schema.Struct({
  path: Schema.String,
  originalPath: Schema.NullOr(Schema.String),
  status: GitFileStatus,
  staged: Schema.Boolean,
  unstaged: Schema.Boolean,
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type GitChangedFile = typeof GitChangedFile.Type;

export const GitRemote = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  forge: RemoteForge,
  host: Schema.NullOr(Schema.String),
  owner: Schema.NullOr(Schema.String),
  repo: Schema.NullOr(Schema.String),
  webUrl: Schema.NullOr(Schema.String),
});
export type GitRemote = typeof GitRemote.Type;

export const GitStatusSummary = Schema.Struct({
  changed: Schema.Number,
  staged: Schema.Number,
  untracked: Schema.Number,
  conflicted: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type GitStatusSummary = typeof GitStatusSummary.Type;

export const GitRepoStatus = Schema.Struct({
  kind: Schema.Literals(["repo"]),
  branch: Schema.NullOr(Schema.String),
  upstream: Schema.NullOr(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
  hasCommits: Schema.Boolean,
  remote: Schema.NullOr(GitRemote),
  forge: RemoteForge,
  files: Schema.Array(GitChangedFile),
  summary: GitStatusSummary,
});
export type GitRepoStatus = typeof GitRepoStatus.Type;

export const GitStatus = Schema.Union([
  GitRepoStatus,
  Schema.Struct({ kind: Schema.Literals(["not-a-repo"]), path: Schema.String }),
]);
export type GitStatus = typeof GitStatus.Type;

const NonBlank = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty());

export const GitCommitInput = Schema.Struct({
  message: Schema.String.check(Schema.isNonEmpty()),
  paths: Schema.optionalKey(Schema.Array(NonBlank)),
});
export type GitCommitInput = typeof GitCommitInput.Type;

export const GitCheckoutInput = Schema.Struct({
  branch: NonBlank,
  create: Schema.optionalKey(Schema.Boolean),
});
export type GitCheckoutInput = typeof GitCheckoutInput.Type;

export const GitActionResult = Schema.Struct({
  message: Schema.String,
  status: GitStatus,
});
export type GitActionResult = typeof GitActionResult.Type;

export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const PullRequest = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: PullRequestState,
  isDraft: Schema.Boolean,
  author: Schema.NullOr(Schema.String),
  headBranch: Schema.String,
  baseBranch: Schema.String,
  updatedAt: Schema.String,
});
export type PullRequest = typeof PullRequest.Type;

export const PullRequestList = Schema.Struct({
  forge: ForgeKind,
  authSource: ForgeAuthSource,
  items: Schema.Array(PullRequest),
});
export type PullRequestList = typeof PullRequestList.Type;

export const CreatePullRequestInput = Schema.Struct({
  title: NonBlank,
  body: Schema.optionalKey(Schema.String),
  base: Schema.optionalKey(NonBlank),
  draft: Schema.optionalKey(Schema.Boolean),
});
export type CreatePullRequestInput = typeof CreatePullRequestInput.Type;

export const ForgeTokenInput = Schema.Struct({
  forge: ForgeKind,
  token: NonBlank,
  host: Schema.optionalKey(NonBlank),
});
export type ForgeTokenInput = typeof ForgeTokenInput.Type;

export const DeviceFlowStart = Schema.Struct({
  flowId: Schema.String,
  userCode: Schema.String,
  verificationUri: Schema.String,
  expiresAt: Schema.String,
  intervalSeconds: Schema.Number,
});
export type DeviceFlowStart = typeof DeviceFlowStart.Type;

export const DeviceFlowPollInput = Schema.Struct({ flowId: NonBlank });
export type DeviceFlowPollInput = typeof DeviceFlowPollInput.Type;

export const DeviceFlowPoll = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["pending"]), intervalSeconds: Schema.Number }),
  Schema.Struct({ kind: Schema.Literals(["complete"]), status: ForgeStatus }),
  Schema.Struct({ kind: Schema.Literals(["expired"]) }),
  Schema.Struct({ kind: Schema.Literals(["denied"]) }),
]);
export type DeviceFlowPoll = typeof DeviceFlowPoll.Type;

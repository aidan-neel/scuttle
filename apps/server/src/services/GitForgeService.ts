import type {
  CreatePullRequestInput,
  DeviceFlowPoll,
  DeviceFlowPollInput,
  DeviceFlowStart,
  ForgeKind,
  ForgeStatus,
  ForgeTokenInput,
  GitActionResult,
  GitCheckoutInput,
  GitCommitInput,
  GitStatus,
  PullRequest,
  PullRequestList,
} from "@scuttle/contracts";
import type { ProjectId, ThreadId } from "@scuttle/shared/ids";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import { GitForgeError, fromHttpError } from "./gitForge/errors.ts";
import { type CliDetection, detectCli } from "./gitForge/forgeCli.ts";
import { makeForgeAccountStore, type StoredForgeAccount } from "./gitForge/forgeAccounts.ts";
import {
  DEFAULT_HOST,
  type FetchFn,
  fetchForgeUsername,
  normalizeHost,
} from "./gitForge/forgeHttp.ts";
import type { KnownForgeHosts } from "./gitForge/gitParse.ts";
import { type CommandRunner, runCommand } from "./gitForge/processRunner.ts";
import { makeDeviceFlow } from "./gitForge/deviceFlow.ts";
import { makeForgeRepoOps } from "./gitForge/repoOps.ts";
import * as GitService from "./GitService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ThreadService from "./ThreadService.ts";

export { GitForgeError } from "./gitForge/errors.ts";

export interface GitForgeOptions {
  readonly githubOAuthClientId: string | null;
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
  readonly now: () => number;
}

export const readGitForgeOptions = (
  env: Readonly<Record<string, string | undefined>>,
): GitForgeOptions => ({
  githubOAuthClientId: env["SCUTTLE_GITHUB_OAUTH_CLIENT_ID"]?.trim() || null,
  runner: runCommand,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
});

export interface GitTarget {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | null;
}

export class GitForgeService extends Context.Service<
  GitForgeService,
  {
    readonly listForges: (refresh: boolean) => Effect.Effect<ReadonlyArray<ForgeStatus>>;
    readonly connectToken: (input: ForgeTokenInput) => Effect.Effect<ForgeStatus, GitForgeError>;
    readonly disconnect: (forge: ForgeKind) => Effect.Effect<ForgeStatus>;
    readonly startDeviceFlow: () => Effect.Effect<DeviceFlowStart, GitForgeError>;
    readonly pollDeviceFlow: (
      input: DeviceFlowPollInput,
    ) => Effect.Effect<DeviceFlowPoll, GitForgeError>;
    readonly status: (target: GitTarget) => Effect.Effect<GitStatus, GitForgeError>;
    readonly commit: (
      target: GitTarget,
      input: GitCommitInput,
    ) => Effect.Effect<GitActionResult, GitForgeError>;
    readonly push: (target: GitTarget) => Effect.Effect<GitActionResult, GitForgeError>;
    readonly pull: (target: GitTarget) => Effect.Effect<GitActionResult, GitForgeError>;
    readonly checkout: (
      target: GitTarget,
      input: GitCheckoutInput,
    ) => Effect.Effect<GitActionResult, GitForgeError>;
    readonly listPullRequests: (target: GitTarget) => Effect.Effect<PullRequestList, GitForgeError>;
    readonly createPullRequest: (
      target: GitTarget,
      input: CreatePullRequestInput,
    ) => Effect.Effect<PullRequest, GitForgeError>;
  }
>()("scuttle/server/GitForgeService") {}

const CLI_CACHE_MS = 30_000;
const FORGES: ReadonlyArray<ForgeKind> = ["github", "gitlab"];

export const toForgeStatus = (
  forge: ForgeKind,
  cli: CliDetection,
  stored: StoredForgeAccount | null,
  oauthAvailable: boolean,
): ForgeStatus => {
  const cliLogin =
    cli.logins.find((login) => login.host === DEFAULT_HOST[forge]) ?? cli.logins[0] ?? null;
  const base = {
    forge,
    cliInstalled: cli.installed,
    cliVersion: cli.version,
    cliAuthenticated: cliLogin !== null,
    hasStoredCredential: stored !== null,
    oauthAvailable: forge === "github" && oauthAvailable,
  };
  if (cliLogin !== null) {
    return {
      ...base,
      connected: true,
      authSource: forge === "github" ? "gh-cli" : "glab-cli",
      host: cliLogin.host,
      username: cliLogin.username,
    };
  }
  if (stored !== null) {
    return {
      ...base,
      connected: true,
      authSource: stored.authSource,
      host: stored.host,
      username: stored.username,
    };
  }
  return {
    ...base,
    connected: false,
    authSource: "none",
    host: DEFAULT_HOST[forge],
    username: null,
  };
};

export const makeGitForgeService = (options: GitForgeOptions) =>
  Effect.gen(function* () {
    const { db } = yield* Sqlite.SqliteDatabase;
    const git = yield* GitService.GitService;
    const projects = yield* ProjectService.ProjectService;
    const threads = yield* ThreadService.ThreadService;
    const accounts = makeForgeAccountStore(db);
    const cliCache = new Map<ForgeKind, { readonly at: number; readonly value: CliDetection }>();

    const cliFor = (forge: ForgeKind, refresh = false) =>
      Effect.gen(function* () {
        const cached = cliCache.get(forge);
        if (!refresh && cached !== undefined && options.now() - cached.at < CLI_CACHE_MS) {
          return cached.value;
        }
        const value = yield* detectCli(options.runner, forge);
        cliCache.set(forge, { at: options.now(), value });
        return value;
      });

    const forgeStatus = (forge: ForgeKind, refresh = false) =>
      cliFor(forge, refresh).pipe(
        Effect.map((cli) =>
          toForgeStatus(forge, cli, accounts.get(forge), options.githubOAuthClientId !== null),
        ),
      );

    const knownHosts = (): KnownForgeHosts => {
      const stored = accounts.list();
      const hostsFor = (forge: ForgeKind) => [
        ...stored.filter((account) => account.forge === forge).map((account) => account.host),
        ...(cliCache.get(forge)?.value.logins.map((login) => login.host) ?? []),
      ];
      return { github: hostsFor("github"), gitlab: hostsFor("gitlab") };
    };

    const listForges = Effect.fn("GitForgeService.listForges")(function* (refresh: boolean) {
      return yield* Effect.all(
        FORGES.map((forge) => forgeStatus(forge, refresh)),
        { concurrency: "unbounded" },
      );
    });

    const connectToken = Effect.fn("GitForgeService.connectToken")(function* (
      input: ForgeTokenInput,
    ) {
      const host = normalizeHost(input.host ?? DEFAULT_HOST[input.forge]);
      if (host === null) {
        return yield* new GitForgeError({
          reason: "invalid",
          detail: "Host must be a hostname such as gitlab.example.com.",
        });
      }
      const username = yield* fetchForgeUsername(
        options.fetch,
        input.forge,
        host,
        input.token,
      ).pipe(Effect.mapError(fromHttpError));
      accounts.save({
        forge: input.forge,
        host,
        authSource: "token",
        token: input.token,
        username,
      });
      return yield* forgeStatus(input.forge);
    });

    const disconnect = Effect.fn("GitForgeService.disconnect")(function* (forge: ForgeKind) {
      accounts.remove(forge);
      return yield* forgeStatus(forge);
    });

    const deviceFlow = makeDeviceFlow({
      clientId: options.githubOAuthClientId,
      fetch: options.fetch,
      now: options.now,
      onToken: (token, username) =>
        Effect.gen(function* () {
          accounts.save({
            forge: "github",
            host: DEFAULT_HOST.github,
            authSource: "oauth",
            token,
            username,
          });
          return yield* forgeStatus("github");
        }),
    });

    const resolveCwd = Effect.fn("GitForgeService.resolveCwd")(function* (target: GitTarget) {
      const project = yield* projects
        .get(target.projectId)
        .pipe(
          Effect.mapError(
            (error) => new GitForgeError({ reason: "not-found", detail: error.detail }),
          ),
        );
      if (target.threadId === null) return project.path;
      const detail = yield* threads
        .getDetail(target.threadId)
        .pipe(
          Effect.mapError(
            (error) => new GitForgeError({ reason: "not-found", detail: error.message }),
          ),
        );
      if (detail.thread.projectId !== project.id) {
        return yield* new GitForgeError({
          reason: "not-found",
          detail: `Thread "${target.threadId}" does not belong to project "${project.id}".`,
        });
      }
      return detail.thread.cwd;
    });

    const repoOps = makeForgeRepoOps({
      git,
      runner: options.runner,
      fetch: options.fetch,
      knownHosts,
      cliFor: (forge) => cliFor(forge),
      storedAccount: (forge) => accounts.get(forge),
    });

    const withCwd =
      <A>(run: (cwd: string) => Effect.Effect<A, GitForgeError>) =>
      (target: GitTarget) =>
        resolveCwd(target).pipe(Effect.flatMap(run));

    return GitForgeService.of({
      listForges,
      connectToken,
      disconnect,
      startDeviceFlow: deviceFlow.start,
      pollDeviceFlow: deviceFlow.poll,
      status: withCwd((cwd) => git.status(cwd, knownHosts())),
      commit: (target, input) => withCwd((cwd) => repoOps.commit(cwd, input))(target),
      push: withCwd(repoOps.push),
      pull: withCwd(repoOps.pull),
      checkout: (target, input) =>
        withCwd((cwd) => repoOps.checkout(cwd, input))(target).pipe(
          Effect.tap((result) =>
            target.threadId !== null &&
            result.status.kind === "repo" &&
            result.status.branch !== null
              ? threads
                  .update(target.threadId, { branch: result.status.branch })
                  .pipe(Effect.ignore)
              : Effect.void,
          ),
        ),
      listPullRequests: withCwd(repoOps.listPullRequests),
      createPullRequest: (target, input) =>
        withCwd((cwd) => repoOps.createPullRequest(cwd, input))(target),
    });
  });

export const layer = (options: GitForgeOptions) =>
  Layer.effect(GitForgeService, makeGitForgeService(options));

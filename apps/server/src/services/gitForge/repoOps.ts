import type {
  CreatePullRequestInput,
  ForgeKind,
  GitCheckoutInput,
  GitCommitInput,
  GitRepoStatus,
} from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import type * as GitService from "../GitService.ts";
import { fromHttpError, GitForgeError } from "./errors.ts";
import { CLI_BINARY, type CliDetection } from "./forgeCli.ts";
import type { StoredForgeAccount } from "./forgeAccounts.ts";
import type { FetchFn } from "./forgeHttp.ts";
import type { KnownForgeHosts } from "./gitParse.ts";
import type { CommandRunner } from "./processRunner.ts";
import {
  fetchDefaultBranch,
  type ForgeTransport,
  listOpenPullRequests,
  openPullRequest,
  transportAuthSource,
} from "./pullRequests.ts";

const FORGE_LABEL: Record<ForgeKind, string> = { github: "GitHub", gitlab: "GitLab" };

export const chooseTransport = (input: {
  readonly forge: ForgeKind;
  readonly host: string;
  readonly cwd: string;
  readonly cli: CliDetection;
  readonly stored: StoredForgeAccount | null;
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
}): ForgeTransport | null => {
  if (input.cli.logins.some((login) => login.host === input.host)) {
    return {
      kind: "cli",
      forge: input.forge,
      host: input.host,
      runner: input.runner,
      cwd: input.cwd,
    };
  }
  if (input.stored !== null && input.stored.host === input.host) {
    return {
      kind: "http",
      forge: input.forge,
      host: input.host,
      token: input.stored.token,
      fetch: input.fetch,
      authSource: input.stored.authSource,
    };
  }
  return null;
};

const rejected = (error: { readonly message: string }) =>
  new GitForgeError({ reason: "rejected", detail: error.message });

export const makeForgeRepoOps = (deps: {
  readonly git: GitService.GitService["Service"];
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
  readonly knownHosts: () => KnownForgeHosts;
  readonly cliFor: (forge: ForgeKind) => Effect.Effect<CliDetection>;
  readonly storedAccount: (forge: ForgeKind) => StoredForgeAccount | null;
}) => {
  const repoStatus = (cwd: string) =>
    deps.git
      .status(cwd, deps.knownHosts())
      .pipe(
        Effect.flatMap((status) =>
          status.kind === "repo"
            ? Effect.succeed(status)
            : Effect.fail(
                new GitForgeError({ reason: "invalid", detail: `${cwd} is not a Git repository.` }),
              ),
        ),
      );

  const withStatus = (cwd: string, action: Effect.Effect<string, GitService.GitServiceError>) =>
    action.pipe(
      Effect.mapError(rejected),
      Effect.flatMap((message) =>
        deps.git.status(cwd, deps.knownHosts()).pipe(Effect.map((status) => ({ message, status }))),
      ),
    );

  const forgeContext = Effect.fn("GitForgeService.forgeContext")(function* (cwd: string) {
    const status = yield* repoStatus(cwd);
    const remote = status.remote;
    if (remote === null) {
      return yield* new GitForgeError({
        reason: "invalid",
        detail: "This repository has no remote. Add one with `git remote add origin <url>`.",
      });
    }
    if (
      (remote.forge !== "github" && remote.forge !== "gitlab") ||
      remote.host === null ||
      remote.owner === null ||
      remote.repo === null
    ) {
      return yield* new GitForgeError({
        reason: "invalid",
        detail: `Remote "${remote.name}" is not a GitHub or GitLab repository.`,
      });
    }
    const forge = remote.forge;
    const transport = chooseTransport({
      forge,
      host: remote.host,
      cwd,
      cli: yield* deps.cliFor(forge),
      stored: deps.storedAccount(forge),
      runner: deps.runner,
      fetch: deps.fetch,
    });
    if (transport === null) {
      return yield* new GitForgeError({
        reason: "unauthorized",
        detail: `No ${FORGE_LABEL[forge]} credential for ${remote.host}. Run \`${CLI_BINARY[forge]} auth login\` or connect ${FORGE_LABEL[forge]} in Settings → Git.`,
      });
    }
    return { status, transport, owner: remote.owner, repo: remote.repo };
  });

  const listPullRequests = Effect.fn("GitForgeService.listPullRequests")(function* (cwd: string) {
    const ctx = yield* forgeContext(cwd);
    const items = yield* listOpenPullRequests(ctx.transport, ctx.owner, ctx.repo).pipe(
      Effect.mapError(fromHttpError),
    );
    return { forge: ctx.transport.forge, authSource: transportAuthSource(ctx.transport), items };
  });

  const ensurePushed = (cwd: string, status: GitRepoStatus) =>
    status.upstream === null || status.ahead > 0
      ? deps.git.push(cwd).pipe(Effect.mapError(rejected), Effect.asVoid)
      : Effect.void;

  const createPullRequest = Effect.fn("GitForgeService.createPullRequest")(function* (
    cwd: string,
    input: CreatePullRequestInput,
  ) {
    const ctx = yield* forgeContext(cwd);
    const head = ctx.status.branch;
    if (head === null) {
      return yield* new GitForgeError({
        reason: "invalid",
        detail: "HEAD is detached. Switch to a branch before opening a pull request.",
      });
    }
    const base =
      input.base ??
      (yield* fetchDefaultBranch(ctx.transport, ctx.owner, ctx.repo).pipe(
        Effect.mapError(fromHttpError),
      ));
    if (base === head) {
      return yield* new GitForgeError({
        reason: "invalid",
        detail: `You are on ${base}. Create a feature branch before opening a pull request.`,
      });
    }
    yield* ensurePushed(cwd, ctx.status);
    return yield* openPullRequest(ctx.transport, ctx.owner, ctx.repo, {
      title: input.title,
      body: input.body ?? "",
      head,
      base,
      draft: input.draft === true,
    }).pipe(Effect.mapError(fromHttpError));
  });

  return {
    commit: (cwd: string, input: GitCommitInput) => withStatus(cwd, deps.git.commit(cwd, input)),
    push: (cwd: string) => withStatus(cwd, deps.git.push(cwd)),
    pull: (cwd: string) => withStatus(cwd, deps.git.pull(cwd)),
    checkout: (cwd: string, input: GitCheckoutInput) =>
      withStatus(cwd, deps.git.checkout(cwd, input)),
    listPullRequests,
    createPullRequest,
  };
};

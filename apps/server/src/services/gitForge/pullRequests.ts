import type { ForgeAuthSource, ForgeKind, PullRequest } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CLI_BINARY } from "./forgeCli.ts";
import { type FetchFn, ForgeHttpError, forgeErrorMessage, forgeRequest } from "./forgeHttp.ts";
import { commandFailure, type CommandRunner } from "./processRunner.ts";
import { redactSecrets } from "./redact.ts";

export type ForgeTransport =
  | {
      readonly kind: "cli";
      readonly forge: ForgeKind;
      readonly host: string;
      readonly runner: CommandRunner;
      readonly cwd: string;
    }
  | {
      readonly kind: "http";
      readonly forge: ForgeKind;
      readonly host: string;
      readonly token: string;
      readonly fetch: FetchFn;
      readonly authSource: "oauth" | "token";
    };

type Body = Readonly<Record<string, string | boolean>>;

export const transportAuthSource = (transport: ForgeTransport): ForgeAuthSource => {
  if (transport.kind === "http") return transport.authSource;
  return transport.forge === "github" ? "gh-cli" : "glab-cli";
};

export const cliApiArgs = (
  forge: ForgeKind,
  host: string,
  method: "GET" | "POST",
  path: string,
  body: Body | undefined,
): ReadonlyArray<string> => {
  const fields = Object.entries(body ?? {}).flatMap(([key, value]) =>
    typeof value === "boolean" ? ["-F", `${key}=${value}`] : ["-f", `${key}=${value}`],
  );
  return [CLI_BINARY[forge], "api", "--hostname", host, "-X", method, path, ...fields];
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const forgeCall = (
  transport: ForgeTransport,
  method: "GET" | "POST",
  path: string,
  body?: Body,
): Effect.Effect<unknown, ForgeHttpError> => {
  if (transport.kind === "http") {
    return forgeRequest({
      fetch: transport.fetch,
      forge: transport.forge,
      host: transport.host,
      token: transport.token,
      method,
      path,
      ...(body !== undefined ? { body } : {}),
    });
  }
  const argv = cliApiArgs(transport.forge, transport.host, method, path, body);
  return transport.runner(argv, { cwd: transport.cwd, timeoutMs: 30_000 }).pipe(
    Effect.flatMap((result) => {
      const payload = parseJson(result.stdout);
      if (result.exitCode === 0 && payload !== null) return Effect.succeed(payload);
      const detail =
        forgeErrorMessage(payload) ??
        commandFailure(result, `${CLI_BINARY[transport.forge]} api failed`);
      const status = Number(/\(HTTP (\d{3})\)/.exec(result.stderr)?.[1] ?? 502);
      return Effect.fail(new ForgeHttpError({ status, detail: redactSecrets(detail) }));
    }),
  );
};

const GithubPull = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.String,
  draft: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  merged_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  head: Schema.Struct({ ref: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
  updated_at: Schema.String,
});

const GitlabMergeRequest = Schema.Struct({
  iid: Schema.Number,
  title: Schema.String,
  web_url: Schema.String,
  state: Schema.String,
  draft: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  work_in_progress: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  author: Schema.NullOr(Schema.Struct({ username: Schema.String })),
  source_branch: Schema.String,
  target_branch: Schema.String,
  updated_at: Schema.String,
});

const RepoInfo = Schema.Struct({ default_branch: Schema.String });

export const githubPullToPullRequest = (pull: typeof GithubPull.Type): PullRequest => ({
  number: pull.number,
  title: pull.title,
  url: pull.html_url,
  state:
    pull.merged_at !== undefined && pull.merged_at !== null
      ? "merged"
      : pull.state === "open"
        ? "open"
        : "closed",
  isDraft: pull.draft === true,
  author: pull.user?.login ?? null,
  headBranch: pull.head.ref,
  baseBranch: pull.base.ref,
  updatedAt: pull.updated_at,
});

export const gitlabMergeRequestToPullRequest = (
  mr: typeof GitlabMergeRequest.Type,
): PullRequest => ({
  number: mr.iid,
  title: mr.title,
  url: mr.web_url,
  state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
  isDraft: mr.draft === true || mr.work_in_progress === true,
  author: mr.author?.username ?? null,
  headBranch: mr.source_branch,
  baseBranch: mr.target_branch,
  updatedAt: mr.updated_at,
});

const decodeOrFail = <A>(schema: Schema.Decoder<A>, payload: unknown) =>
  Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError(
      () => new ForgeHttpError({ status: 502, detail: "Forge returned an unexpected response." }),
    ),
  );

const repoPath = (forge: ForgeKind, owner: string, repo: string): string =>
  forge === "github"
    ? `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    : `projects/${encodeURIComponent(`${owner}/${repo}`)}`;

export const listOpenPullRequests = (transport: ForgeTransport, owner: string, repo: string) =>
  Effect.gen(function* () {
    const base = repoPath(transport.forge, owner, repo);
    if (transport.forge === "github") {
      const payload = yield* forgeCall(transport, "GET", `${base}/pulls?state=open&per_page=30`);
      const pulls = yield* decodeOrFail(Schema.Array(GithubPull), payload);
      return pulls.map(githubPullToPullRequest);
    }
    const payload = yield* forgeCall(
      transport,
      "GET",
      `${base}/merge_requests?state=opened&per_page=30&order_by=updated_at`,
    );
    const mrs = yield* decodeOrFail(Schema.Array(GitlabMergeRequest), payload);
    return mrs.map(gitlabMergeRequestToPullRequest);
  });

export const fetchDefaultBranch = (transport: ForgeTransport, owner: string, repo: string) =>
  forgeCall(transport, "GET", repoPath(transport.forge, owner, repo)).pipe(
    Effect.flatMap((payload) => decodeOrFail(RepoInfo, payload)),
    Effect.map((info) => info.default_branch),
  );

export interface NewPullRequest {
  readonly title: string;
  readonly body: string;
  readonly head: string;
  readonly base: string;
  readonly draft: boolean;
}

export const openPullRequest = (
  transport: ForgeTransport,
  owner: string,
  repo: string,
  input: NewPullRequest,
) =>
  Effect.gen(function* () {
    const base = repoPath(transport.forge, owner, repo);
    if (transport.forge === "github") {
      const payload = yield* forgeCall(transport, "POST", `${base}/pulls`, {
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      });
      return githubPullToPullRequest(yield* decodeOrFail(GithubPull, payload));
    }
    const title =
      input.draft && !/^draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title;
    const payload = yield* forgeCall(transport, "POST", `${base}/merge_requests`, {
      title,
      description: input.body,
      source_branch: input.head,
      target_branch: input.base,
    });
    return gitlabMergeRequestToPullRequest(yield* decodeOrFail(GitlabMergeRequest, payload));
  });

import type { Database } from "bun:sqlite";
import type { Agent, AgentIssue, ForgeKind } from "@scuttle/contracts";
import { AgentIssueId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as GitService from "../GitService.ts";
import { makeForgeAccountStore } from "../gitForge/forgeAccounts.ts";
import { detectCli } from "../gitForge/forgeCli.ts";
import type { FetchFn } from "../gitForge/forgeHttp.ts";
import type { KnownForgeHosts } from "../gitForge/gitParse.ts";
import type { CommandRunner } from "../gitForge/processRunner.ts";
import { forgeCall } from "../gitForge/pullRequests.ts";
import { chooseTransport } from "../gitForge/repoOps.ts";
import { insertIssue, listIssues, readIssueByKey, updateIssueRow } from "./agentWorkStore.ts";
import { AgentServiceError } from "./errors.ts";

const GithubIssue = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  labels: Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.String })])),
  pull_request: Schema.optionalKey(Schema.Unknown),
});

const GitlabIssue = Schema.Struct({
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  web_url: Schema.String,
  labels: Schema.Array(Schema.String),
});

interface ParsedRemoteIssue {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly labels: ReadonlyArray<string>;
  readonly externalUrl: string;
}

const repoPath = (forge: ForgeKind, owner: string, repo: string): string =>
  forge === "github"
    ? `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    : `projects/${encodeURIComponent(`${owner}/${repo}`)}`;

export const syncForgeIssuesForAgent = Effect.fn("AgentService.syncForgeIssues")(function* (deps: {
  readonly db: Database;
  readonly git: GitService.GitService["Service"];
  readonly runner: CommandRunner;
  readonly fetch: FetchFn;
  readonly agent: Agent;
}) {
  const accounts = makeForgeAccountStore(deps.db);
  const stored = accounts.list();
  const known: KnownForgeHosts = {
    github: stored.filter((a) => a.forge === "github").map((a) => a.host),
    gitlab: stored.filter((a) => a.forge === "gitlab").map((a) => a.host),
  };

  const status = yield* deps.git.status(deps.agent.projectPath, known);
  if (status.kind !== "repo" || status.remote === null) {
    return yield* new AgentServiceError({
      reason: "invalid",
      detail: "Project is not a Git repository with a configured remote.",
    });
  }

  const remote = status.remote;
  if (
    (remote.forge !== "github" && remote.forge !== "gitlab") ||
    remote.host === null ||
    remote.owner === null ||
    remote.repo === null
  ) {
    return yield* new AgentServiceError({
      reason: "invalid",
      detail: `Remote "${remote.name}" is not a GitHub or GitLab repository.`,
    });
  }

  const forge = remote.forge;
  const cli = yield* detectCli(deps.runner, forge);
  const transport = chooseTransport({
    forge,
    host: remote.host,
    cwd: deps.agent.projectPath,
    cli,
    stored: accounts.get(forge),
    runner: deps.runner,
    fetch: deps.fetch,
  });

  if (transport === null) {
    return yield* new AgentServiceError({
      reason: "rejected",
      detail: `No ${forge === "github" ? "GitHub" : "GitLab"} credential configured for ${remote.host}.`,
    });
  }

  const base = repoPath(forge, remote.owner, remote.repo);
  const items: ParsedRemoteIssue[] = [];

  if (forge === "github") {
    const payload = yield* forgeCall(
      transport,
      "GET",
      `${base}/issues?state=open&per_page=50`,
    ).pipe(
      Effect.mapError((err) => new AgentServiceError({ reason: "rejected", detail: err.detail })),
    );
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(GithubIssue))(payload).pipe(
      Effect.mapError(
        () =>
          new AgentServiceError({
            reason: "rejected",
            detail: "GitHub returned an unexpected issues response.",
          }),
      ),
    );
    for (const issue of decoded) {
      if (issue.pull_request !== undefined) continue;
      items.push({
        key: `GH-${issue.number}`,
        title: issue.title,
        description: issue.body ?? "",
        labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
        externalUrl: issue.html_url,
      });
    }
  } else {
    const payload = yield* forgeCall(
      transport,
      "GET",
      `${base}/issues?state=opened&per_page=50`,
    ).pipe(
      Effect.mapError((err) => new AgentServiceError({ reason: "rejected", detail: err.detail })),
    );
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(GitlabIssue))(payload).pipe(
      Effect.mapError(
        () =>
          new AgentServiceError({
            reason: "rejected",
            detail: "GitLab returned an unexpected issues response.",
          }),
      ),
    );
    for (const issue of decoded) {
      items.push({
        key: `GL-${issue.iid}`,
        title: issue.title,
        description: issue.description ?? "",
        labels: [...issue.labels],
        externalUrl: issue.web_url,
      });
    }
  }

  const now = new Date().toISOString();
  const upserted: AgentIssue[] = [];
  for (const remoteIssue of items) {
    const existing = readIssueByKey(deps.db, deps.agent.id, remoteIssue.key);
    if (existing) {
      const next: AgentIssue = {
        ...existing,
        title: remoteIssue.title,
        description: remoteIssue.description,
        labels: remoteIssue.labels,
        externalUrl: remoteIssue.externalUrl,
        updatedAt: now,
      };
      updateIssueRow(deps.db, next);
      upserted.push(next);
    } else {
      const created: AgentIssue = {
        id: AgentIssueId.make(crypto.randomUUID()),
        agentId: deps.agent.id,
        key: remoteIssue.key,
        title: remoteIssue.title,
        description: remoteIssue.description,
        state: "backlog",
        labels: remoteIssue.labels,
        externalUrl: remoteIssue.externalUrl,
        createdAt: now,
        updatedAt: now,
      };
      insertIssue(deps.db, created);
      upserted.push(created);
    }
  }

  return { upserted, all: listIssues(deps.db, deps.agent.id) };
});

import {
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
const decodeProject = Schema.decodeUnknownEffect(Project);
const decodeBranches = Schema.decodeUnknownEffect(Schema.Array(GitBranchInfo));
const decodeDirectory = Schema.decodeUnknownEffect(DirectoryListing);
const decodeProviders = Schema.decodeUnknownEffect(Schema.Array(ProviderSnapshot));
const decodeProvider = Schema.decodeUnknownEffect(ProviderSnapshot);
const decodeThread = Schema.decodeUnknownEffect(Thread);
const decodeThreadDetail = Schema.decodeUnknownEffect(ThreadDetail);
const decodeTurn = Schema.decodeUnknownEffect(ThreadTurn);

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
  readonly updateThread: (threadId: string, input: UpdateThreadInput) => Promise<Thread>;
  readonly deleteThread: (threadId: string) => Promise<void>;
  readonly respondApproval: (
    threadId: string,
    approvalId: string,
    input: RespondApprovalInput,
  ) => Promise<void>;
}

export const createScuttleApiClient = (baseUrl?: string): ScuttleApiClient => ({
  getWorkspace: () =>
    Effect.runPromise(requestJson(baseUrl, "/api/workspace", undefined, decodeWorkspace)),
  createProject: (input) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        "/api/projects",
        { method: "POST", body: JSON.stringify(input) },
        decodeProject,
      ),
    ),
  deleteProject: (projectId) =>
    Effect.runPromise(
      requestVoid(baseUrl, `/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
    ),
  listBranches: (projectId) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        `/api/projects/${encodeURIComponent(projectId)}/branches`,
        undefined,
        decodeBranches,
      ),
    ),
  listDirectory: (dirPath) => {
    const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
    return Effect.runPromise(
      requestJson(baseUrl, `/api/fs/list${query}`, undefined, decodeDirectory),
    );
  },
  refreshProviders: () =>
    Effect.runPromise(
      requestJson(baseUrl, "/api/providers/refresh", { method: "POST" }, decodeProviders),
    ),
  updateProvider: (providerId, patch) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        `/api/providers/${encodeURIComponent(providerId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        decodeProvider,
      ),
    ),
  getThreadDetail: (threadId) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        `/api/threads/${encodeURIComponent(threadId)}`,
        undefined,
        decodeThreadDetail,
      ),
    ),
  createThread: (input) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        "/api/threads",
        { method: "POST", body: JSON.stringify(input) },
        decodeThreadDetail,
      ),
    ),
  sendTurn: (threadId, input) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        `/api/threads/${encodeURIComponent(threadId)}/turns`,
        { method: "POST", body: JSON.stringify(input) },
        decodeTurn,
      ),
    ),
  interruptTurn: (threadId) =>
    Effect.runPromise(
      requestVoid(baseUrl, `/api/threads/${encodeURIComponent(threadId)}/interrupt`, {
        method: "POST",
      }),
    ),
  settleThread: (threadId, input) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        `/api/threads/${encodeURIComponent(threadId)}/settle`,
        { method: "POST", body: JSON.stringify(input) },
        decodeThread,
      ),
    ),
  updateThread: (threadId, input) =>
    Effect.runPromise(
      requestJson(
        baseUrl,
        `/api/threads/${encodeURIComponent(threadId)}`,
        { method: "PATCH", body: JSON.stringify(input) },
        decodeThread,
      ),
    ),
  deleteThread: (threadId) =>
    Effect.runPromise(
      requestVoid(baseUrl, `/api/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" }),
    ),
  respondApproval: (threadId, approvalId, input) =>
    Effect.runPromise(
      requestVoid(
        baseUrl,
        `/api/threads/${encodeURIComponent(threadId)}/approvals/${encodeURIComponent(approvalId)}`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ),
});

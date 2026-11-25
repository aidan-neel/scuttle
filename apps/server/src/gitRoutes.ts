import {
  CreatePullRequestInput,
  DeviceFlowPollInput,
  ForgeKind,
  ForgeTokenInput,
  GitCheckoutInput,
  GitCommitInput,
} from "@scuttle/contracts";
import { ProjectId, ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { jsonError, matchRoute, readAndDecode } from "./httpHelpers.ts";
import type { GitForgeErrorReason } from "./services/gitForge/errors.ts";
import * as GitForgeService from "./services/GitForgeService.ts";

const ERROR_STATUS: Record<GitForgeErrorReason, number> = {
  invalid: 400,
  "not-found": 404,
  unauthorized: 401,
  unavailable: 503,
  rejected: 422,
};

const toErrorResponse = (error: { readonly message: string }): Response =>
  jsonError(
    error.message,
    error instanceof GitForgeService.GitForgeError ? ERROR_STATUS[error.reason] : 400,
  );

const respond = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
  status = 200,
) =>
  effect.pipe(
    Effect.map((body) => Response.json(body, { status })),
    Effect.catch((error) => Effect.succeed(toErrorResponse(error))),
  );

const decodeForge = Schema.decodeUnknownOption(ForgeKind);

const targetFrom = (projectId: string, url: URL): GitForgeService.GitTarget => {
  const threadId = url.searchParams.get("threadId");
  return {
    projectId: ProjectId.make(projectId),
    threadId: threadId !== null && threadId.length > 0 ? ThreadId.make(threadId) : null,
  };
};

const PROJECT_GIT_ROUTE =
  /^\/api\/projects\/([^/]+)\/git\/(status|commit|push|pull|checkout|pull-requests)$/;

export const handleGitApiRequest = (
  request: Request,
  url: URL,
): Effect.Effect<Response | null, never, GitForgeService.GitForgeService> =>
  Effect.gen(function* () {
    const method = request.method.toUpperCase();
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/git/") && !PROJECT_GIT_ROUTE.test(pathname)) return null;
    const forges = yield* GitForgeService.GitForgeService;

    if (method === "GET" && pathname === "/api/git/forges") {
      return yield* respond(forges.listForges(url.searchParams.get("refresh") === "1"));
    }
    if (method === "POST" && pathname === "/api/git/forges/token") {
      return yield* respond(
        readAndDecode(request, ForgeTokenInput).pipe(Effect.flatMap(forges.connectToken)),
      );
    }
    if (method === "POST" && pathname === "/api/git/forges/github/device/start") {
      return yield* respond(forges.startDeviceFlow());
    }
    if (method === "POST" && pathname === "/api/git/forges/github/device/poll") {
      return yield* respond(
        readAndDecode(request, DeviceFlowPollInput).pipe(Effect.flatMap(forges.pollDeviceFlow)),
      );
    }
    const forgeById = matchRoute(pathname, /^\/api\/git\/forges\/([^/]+)$/);
    if (method === "DELETE" && forgeById !== null) {
      const forge = decodeForge(forgeById[0]);
      if (forge._tag === "None") return jsonError(`Unknown forge "${forgeById[0]}".`, 404);
      return yield* respond(forges.disconnect(forge.value));
    }

    const projectRoute = matchRoute(pathname, PROJECT_GIT_ROUTE);
    if (projectRoute === null) return null;
    const target = targetFrom(projectRoute[0]!, url);
    const action = projectRoute[1];

    if (method === "GET" && action === "status") return yield* respond(forges.status(target));
    if (method === "POST" && action === "commit") {
      return yield* respond(
        readAndDecode(request, GitCommitInput).pipe(
          Effect.flatMap((input) => forges.commit(target, input)),
        ),
      );
    }
    if (method === "POST" && action === "push") return yield* respond(forges.push(target));
    if (method === "POST" && action === "pull") return yield* respond(forges.pull(target));
    if (method === "POST" && action === "checkout") {
      return yield* respond(
        readAndDecode(request, GitCheckoutInput).pipe(
          Effect.flatMap((input) => forges.checkout(target, input)),
        ),
      );
    }
    if (method === "GET" && action === "pull-requests") {
      return yield* respond(forges.listPullRequests(target));
    }
    if (method === "POST" && action === "pull-requests") {
      return yield* respond(
        readAndDecode(request, CreatePullRequestInput).pipe(
          Effect.flatMap((input) => forges.createPullRequest(target, input)),
        ),
        201,
      );
    }
    return null;
  });

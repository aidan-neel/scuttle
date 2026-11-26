import {
  CompactThreadInput,
  CreateProjectInput,
  CreateThreadInput,
  ProviderConfigPatch,
  RespondApprovalInput,
  SendTurnInput,
  SettleThreadInput,
  UpdateThreadInput,
} from "@scuttle/contracts";
import { ApprovalId, ProjectId, ProviderId, ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import { handleAgentApiRequest } from "./agentRoutes.ts";
import { handleGitApiRequest } from "./gitRoutes.ts";
import { jsonError, matchRoute, readAndDecode, readOptionalAndDecode } from "./httpHelpers.ts";
import * as AgentService from "./services/AgentService.ts";
import type * as GitForgeService from "./services/GitForgeService.ts";
import * as HealthService from "./services/HealthService.ts";
import * as ProjectService from "./services/ProjectService.ts";
import * as ProviderService from "./services/ProviderService.ts";
import * as ThreadService from "./services/ThreadService.ts";

export type ApiServices =
  | AgentService.AgentService
  | GitForgeService.GitForgeService
  | HealthService.HealthService
  | ProjectService.ProjectService
  | ProviderService.ProviderService
  | ThreadService.ThreadService;

export const handleApiRequest = (
  request: Request,
  url: URL,
): Effect.Effect<Response | null, never, ApiServices> =>
  Effect.gen(function* () {
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    const agentResponse = yield* handleAgentApiRequest(request, url);
    if (agentResponse !== null) return agentResponse;

    const gitResponse = yield* handleGitApiRequest(request, url);
    if (gitResponse !== null) return gitResponse;

    if (method === "GET" && pathname === "/api/health") {
      const health = yield* HealthService.HealthService;
      return Response.json(yield* health.check());
    }

    if (method === "GET" && pathname === "/api/workspace") {
      const projectService = yield* ProjectService.ProjectService;
      const threadService = yield* ThreadService.ThreadService;
      const providerService = yield* ProviderService.ProviderService;
      const agentService = yield* AgentService.AgentService;
      const [projects, threads, providers, agents] = yield* Effect.all([
        projectService.list(),
        threadService.list(),
        providerService.listSnapshots(),
        agentService.list(),
      ]);
      return Response.json({ projects, threads, providers, agents });
    }

    if (method === "GET" && pathname === "/api/fs/list") {
      const projectService = yield* ProjectService.ProjectService;
      const dir = url.searchParams.get("path") ?? undefined;
      return yield* projectService.listDirectory(dir).pipe(
        Effect.map((listing) => Response.json(listing)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    if (method === "GET" && pathname === "/api/projects") {
      const projectService = yield* ProjectService.ProjectService;
      return Response.json(yield* projectService.list());
    }

    if (method === "POST" && pathname === "/api/projects") {
      const projectService = yield* ProjectService.ProjectService;
      return yield* readAndDecode(request, CreateProjectInput).pipe(
        Effect.flatMap((body) => projectService.create(body)),
        Effect.map((project) => Response.json(project, { status: 201 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const projectBranches = matchRoute(pathname, /^\/api\/projects\/([^/]+)\/branches$/);
    if (method === "GET" && projectBranches !== null) {
      const projectService = yield* ProjectService.ProjectService;
      return yield* projectService.listBranches(ProjectId.make(projectBranches[0]!)).pipe(
        Effect.map((branches) => Response.json(branches)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 404))),
      );
    }

    const projectById = matchRoute(pathname, /^\/api\/projects\/([^/]+)$/);
    if (method === "DELETE" && projectById !== null) {
      const projectService = yield* ProjectService.ProjectService;
      return yield* projectService.remove(ProjectId.make(projectById[0]!)).pipe(
        Effect.map(() => new Response(null, { status: 204 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 404))),
      );
    }

    if (method === "GET" && pathname === "/api/providers") {
      const providerService = yield* ProviderService.ProviderService;
      return Response.json(yield* providerService.listSnapshots());
    }

    if (method === "POST" && pathname === "/api/providers/refresh") {
      const providerService = yield* ProviderService.ProviderService;
      return Response.json(yield* providerService.refreshAll());
    }

    const providerById = matchRoute(pathname, /^\/api\/providers\/([^/]+)$/);
    if (method === "PATCH" && providerById !== null) {
      const providerService = yield* ProviderService.ProviderService;
      return yield* readAndDecode(request, ProviderConfigPatch).pipe(
        Effect.flatMap((patch) =>
          providerService.updateConfig(ProviderId.make(providerById[0]!), patch),
        ),
        Effect.map((snapshot) => Response.json(snapshot)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    if (method === "POST" && pathname === "/api/threads") {
      const threadService = yield* ThreadService.ThreadService;
      return yield* readAndDecode(request, CreateThreadInput).pipe(
        Effect.flatMap((input) => threadService.create(input)),
        Effect.map((detail) => Response.json(detail, { status: 201 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const threadApproval = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/approvals\/([^/]+)$/);
    if (method === "POST" && threadApproval !== null) {
      const threadService = yield* ThreadService.ThreadService;
      return yield* readAndDecode(request, RespondApprovalInput).pipe(
        Effect.flatMap((input) =>
          threadService.respondApproval(
            ThreadId.make(threadApproval[0]!),
            ApprovalId.make(threadApproval[1]!),
            input,
          ),
        ),
        Effect.map(() => new Response(null, { status: 204 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const threadTurns = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/turns$/);
    if (method === "POST" && threadTurns !== null) {
      const threadService = yield* ThreadService.ThreadService;
      return yield* readAndDecode(request, SendTurnInput).pipe(
        Effect.flatMap((input) => threadService.sendTurn(ThreadId.make(threadTurns[0]!), input)),
        Effect.map((turn) => Response.json(turn, { status: 201 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const threadInterrupt = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/interrupt$/);
    if (method === "POST" && threadInterrupt !== null) {
      const threadService = yield* ThreadService.ThreadService;
      return yield* threadService.interrupt(ThreadId.make(threadInterrupt[0]!)).pipe(
        Effect.map(() => new Response(null, { status: 204 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const threadSettle = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/settle$/);
    if (method === "POST" && threadSettle !== null) {
      const threadService = yield* ThreadService.ThreadService;
      return yield* readAndDecode(request, SettleThreadInput).pipe(
        Effect.flatMap((input) =>
          threadService.settle(ThreadId.make(threadSettle[0]!), input.settled),
        ),
        Effect.map((thread) => Response.json(thread)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const threadCompact = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/compact$/);
    if (method === "POST" && threadCompact !== null) {
      const threadService = yield* ThreadService.ThreadService;
      return yield* readOptionalAndDecode(request, CompactThreadInput, {}).pipe(
        Effect.flatMap((input) => threadService.compact(ThreadId.make(threadCompact[0]!), input)),
        Effect.map((result) => Response.json(result)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    const threadById = matchRoute(pathname, /^\/api\/threads\/([^/]+)$/);
    if (threadById !== null) {
      const threadService = yield* ThreadService.ThreadService;
      const id = ThreadId.make(threadById[0]!);
      if (method === "GET") {
        return yield* threadService.getDetail(id).pipe(
          Effect.map((detail) => Response.json(detail)),
          Effect.catch((err) => Effect.succeed(jsonError(err.message, 404))),
        );
      }
      if (method === "PATCH") {
        return yield* readAndDecode(request, UpdateThreadInput).pipe(
          Effect.flatMap((input) => threadService.update(id, input)),
          Effect.map((thread) => Response.json(thread)),
          Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
        );
      }
      if (method === "DELETE") {
        return yield* threadService.remove(id).pipe(
          Effect.map(() => new Response(null, { status: 204 })),
          Effect.catch((err) => Effect.succeed(jsonError(err.message, 404))),
        );
      }
    }

    return null;
  }).pipe(Effect.catch(() => Effect.succeed(jsonError("Internal server error.", 500))));

import {
  AskDelegationParentInput,
  AssignAgentIssueInput,
  CreateAgentInput,
  CreateIssueCommentInput,
  CreateIssueInput,
  CreateMemoryInput,
  CreateThreadDelegationInput,
  DelegateAgentTaskInput,
  SendTurnInput,
  SetupAgentStartInput,
  TriggerCheckInInput,
  UpdateAgentInput,
  UpdateIssueInput,
  UpdateMemoryInput,
} from "@scuttle/contracts";
import {
  AgentDelegationId,
  AgentId,
  AgentIssueId,
  AgentMemoryId,
  ThreadId,
} from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import { jsonError, matchRoute, readAndDecode, readOptionalAndDecode } from "./httpHelpers.ts";
import type { AgentErrorReason } from "./services/agent/errors.ts";
import * as AgentService from "./services/AgentService.ts";

const ERROR_STATUS: Record<AgentErrorReason, number> = {
  invalid: 400,
  "not-found": 404,
  rejected: 422,
};

const toErrorResponse = (error: { readonly message: string }): Response =>
  jsonError(
    error.message,
    error instanceof AgentService.AgentServiceError ? ERROR_STATUS[error.reason] : 400,
  );

const respond = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
  status = 200,
) =>
  effect.pipe(
    Effect.map((body) => Response.json(body, { status })),
    Effect.catch((error) => Effect.succeed(toErrorResponse(error))),
  );

export const handleAgentApiRequest = (
  request: Request,
  url: URL,
): Effect.Effect<Response | null, never, AgentService.AgentService> =>
  Effect.gen(function* () {
    const method = request.method.toUpperCase();
    const pathname = url.pathname;
    const threadDelegations = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/delegations$/);
    const isDelegationRoute =
      pathname === "/api/delegations" || pathname.startsWith("/api/delegations/");
    const isAgentRoute = pathname === "/api/agents" || pathname.startsWith("/api/agents/");
    if (!isAgentRoute && !isDelegationRoute && threadDelegations === null) return null;

    const agents = yield* AgentService.AgentService;

    if (method === "GET" && pathname === "/api/delegations") {
      return yield* respond(agents.listActiveDelegationLinks());
    }

    if (threadDelegations !== null) {
      const threadId = ThreadId.make(threadDelegations[0]!);
      if (method === "GET") {
        return yield* respond(agents.listThreadDelegations(threadId));
      }
      if (method === "POST") {
        return yield* respond(
          readAndDecode(request, CreateThreadDelegationInput).pipe(
            Effect.flatMap((input) => agents.delegateFromThread(threadId, input)),
          ),
          201,
        );
      }
    }

    const delegationById = matchRoute(pathname, /^\/api\/delegations\/([^/]+)$/);
    if (method === "GET" && delegationById !== null) {
      return yield* respond(agents.getDelegation(AgentDelegationId.make(delegationById[0]!)));
    }

    const threadDelegationCancel = matchRoute(pathname, /^\/api\/delegations\/([^/]+)\/cancel$/);
    if (method === "POST" && threadDelegationCancel !== null) {
      return yield* respond(
        agents.cancelDelegationById(AgentDelegationId.make(threadDelegationCancel[0]!)),
      );
    }

    const threadDelegationAsk = matchRoute(pathname, /^\/api\/delegations\/([^/]+)\/ask$/);
    if (method === "POST" && threadDelegationAsk !== null) {
      const delegationId = AgentDelegationId.make(threadDelegationAsk[0]!);
      return yield* respond(
        readAndDecode(request, AskDelegationParentInput).pipe(
          Effect.flatMap((input) =>
            agents.askParentByDelegation(delegationId, input, { signal: request.signal }),
          ),
        ),
      );
    }

    const threadDelegationQuestions = matchRoute(
      pathname,
      /^\/api\/delegations\/([^/]+)\/questions$/,
    );
    if (method === "GET" && threadDelegationQuestions !== null) {
      return yield* respond(
        agents.listDelegationQuestionsById(AgentDelegationId.make(threadDelegationQuestions[0]!)),
      );
    }

    if (!isAgentRoute) return null;

    if (method === "GET" && pathname === "/api/agents") {
      return yield* respond(agents.list());
    }
    if (method === "POST" && pathname === "/api/agents") {
      return yield* respond(
        readAndDecode(request, CreateAgentInput).pipe(Effect.flatMap(agents.create)),
        201,
      );
    }

    const agentById = matchRoute(pathname, /^\/api\/agents\/([^/]+)$/);
    if (agentById !== null) {
      const id = AgentId.make(agentById[0]!);
      if (method === "GET") return yield* respond(agents.getDetail(id));
      if (method === "PATCH") {
        return yield* respond(
          readAndDecode(request, UpdateAgentInput).pipe(
            Effect.flatMap((input) => agents.update(id, input)),
          ),
        );
      }
      if (method === "DELETE") {
        return yield* agents.remove(id).pipe(
          Effect.map(() => new Response(null, { status: 204 })),
          Effect.catch((error) => Effect.succeed(toErrorResponse(error))),
        );
      }
    }

    const agentTurns = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/turns$/);
    if (method === "POST" && agentTurns !== null) {
      const id = AgentId.make(agentTurns[0]!);
      return yield* respond(
        readAndDecode(request, SendTurnInput).pipe(
          Effect.flatMap((input) => agents.sendTurn(id, input)),
        ),
        201,
      );
    }

    const agentSetup = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/setup\/start$/);
    if (method === "POST" && agentSetup !== null) {
      const id = AgentId.make(agentSetup[0]!);
      return yield* respond(
        readOptionalAndDecode(request, SetupAgentStartInput, {}).pipe(
          Effect.flatMap((input) => agents.startSetup(id, input)),
        ),
        201,
      );
    }

    const memoriesRoot = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/memories$/);
    if (memoriesRoot !== null) {
      const id = AgentId.make(memoriesRoot[0]!);
      if (method === "GET") {
        const q = url.searchParams.get("q") ?? undefined;
        return yield* respond(agents.listMemories(id, q));
      }
      if (method === "POST") {
        return yield* respond(
          readAndDecode(request, CreateMemoryInput).pipe(
            Effect.flatMap((input) => agents.createMemory(id, input)),
          ),
          201,
        );
      }
    }

    const memoryById = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/memories\/([^/]+)$/);
    if (memoryById !== null) {
      const id = AgentId.make(memoryById[0]!);
      const memoryId = AgentMemoryId.make(memoryById[1]!);
      if (method === "PATCH") {
        return yield* respond(
          readAndDecode(request, UpdateMemoryInput).pipe(
            Effect.flatMap((input) => agents.updateMemory(id, memoryId, input)),
          ),
        );
      }
      if (method === "DELETE") {
        return yield* agents.deleteMemory(id, memoryId).pipe(
          Effect.map(() => new Response(null, { status: 204 })),
          Effect.catch((error) => Effect.succeed(toErrorResponse(error))),
        );
      }
    }

    const issuesRoot = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/issues$/);
    if (issuesRoot !== null) {
      const id = AgentId.make(issuesRoot[0]!);
      if (method === "GET") return yield* respond(agents.listIssues(id));
      if (method === "POST") {
        return yield* respond(
          readAndDecode(request, CreateIssueInput).pipe(
            Effect.flatMap((input) => agents.createIssue(id, input)),
          ),
          201,
        );
      }
    }

    const issuesSync = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/issues\/sync$/);
    if (method === "POST" && issuesSync !== null) {
      return yield* respond(agents.syncIssues(AgentId.make(issuesSync[0]!)));
    }

    const issueAssign = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/issues\/([^/]+)\/assign$/);
    if (method === "POST" && issueAssign !== null) {
      const id = AgentId.make(issueAssign[0]!);
      const issueId = AgentIssueId.make(issueAssign[1]!);
      return yield* respond(
        readOptionalAndDecode(request, AssignAgentIssueInput, {}).pipe(
          Effect.flatMap((input) => agents.assignIssue(id, issueId, input)),
        ),
        201,
      );
    }

    const issueActivities = matchRoute(
      pathname,
      /^\/api\/agents\/([^/]+)\/issues\/([^/]+)\/activities$/,
    );
    if (method === "GET" && issueActivities !== null) {
      return yield* respond(
        agents.listIssueActivities(
          AgentId.make(issueActivities[0]!),
          AgentIssueId.make(issueActivities[1]!),
        ),
      );
    }

    const issueComments = matchRoute(
      pathname,
      /^\/api\/agents\/([^/]+)\/issues\/([^/]+)\/comments$/,
    );
    if (method === "POST" && issueComments !== null) {
      const id = AgentId.make(issueComments[0]!);
      const issueId = AgentIssueId.make(issueComments[1]!);
      return yield* respond(
        readAndDecode(request, CreateIssueCommentInput).pipe(
          Effect.flatMap((input) => agents.addIssueComment(id, issueId, input)),
        ),
        201,
      );
    }

    const issueById = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/issues\/([^/]+)$/);
    if (issueById !== null) {
      const id = AgentId.make(issueById[0]!);
      const issueId = AgentIssueId.make(issueById[1]!);
      if (method === "PATCH") {
        return yield* respond(
          readAndDecode(request, UpdateIssueInput).pipe(
            Effect.flatMap((input) => agents.updateIssue(id, issueId, input)),
          ),
        );
      }
      if (method === "DELETE") {
        return yield* agents.deleteIssue(id, issueId).pipe(
          Effect.map(() => new Response(null, { status: 204 })),
          Effect.catch((error) => Effect.succeed(toErrorResponse(error))),
        );
      }
    }

    const delegationsRoot = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/delegations$/);
    if (method === "POST" && delegationsRoot !== null) {
      const id = AgentId.make(delegationsRoot[0]!);
      return yield* respond(
        readAndDecode(request, DelegateAgentTaskInput).pipe(
          Effect.flatMap((input) => agents.delegateTask(id, input)),
        ),
        201,
      );
    }

    const delegationAsk = matchRoute(
      pathname,
      /^\/api\/agents\/([^/]+)\/delegations\/([^/]+)\/ask$/,
    );
    if (method === "POST" && delegationAsk !== null) {
      const id = AgentId.make(delegationAsk[0]!);
      const delegationId = AgentDelegationId.make(delegationAsk[1]!);
      return yield* respond(
        readAndDecode(request, AskDelegationParentInput).pipe(
          Effect.flatMap((input) =>
            agents.askParent(id, delegationId, input, { signal: request.signal }),
          ),
        ),
      );
    }

    const delegationQuestions = matchRoute(
      pathname,
      /^\/api\/agents\/([^/]+)\/delegations\/([^/]+)\/questions$/,
    );
    if (method === "GET" && delegationQuestions !== null) {
      return yield* respond(
        agents.listDelegationQuestions(
          AgentId.make(delegationQuestions[0]!),
          AgentDelegationId.make(delegationQuestions[1]!),
        ),
      );
    }

    const delegationCancel = matchRoute(
      pathname,
      /^\/api\/agents\/([^/]+)\/delegations\/([^/]+)\/cancel$/,
    );
    if (method === "POST" && delegationCancel !== null) {
      return yield* respond(
        agents.cancelDelegation(
          AgentId.make(delegationCancel[0]!),
          AgentDelegationId.make(delegationCancel[1]!),
        ),
      );
    }

    const checkInsRoot = matchRoute(pathname, /^\/api\/agents\/([^/]+)\/checkins$/);
    if (method === "POST" && checkInsRoot !== null) {
      const id = AgentId.make(checkInsRoot[0]!);
      return yield* respond(
        readOptionalAndDecode(request, TriggerCheckInInput, {}).pipe(
          Effect.flatMap((input) => agents.runCheckIn(id, input)),
        ),
        201,
      );
    }

    return null;
  });

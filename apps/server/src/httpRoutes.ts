import {
  CompactThreadInput,
  CreateProjectInput,
  CreateThreadInput,
  RespondApprovalInput,
  SendTurnInput,
  SettleThreadInput,
  UpdateModelTierConfigInput,
  UpdateThreadInput,
  UsageProviderFilter,
  UsageRange,
} from "@scuttle/contracts";
import { ApprovalId, ProjectId, ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { handleAgentApiRequest } from "./agentRoutes.ts";
import { handleGitApiRequest } from "./gitRoutes.ts";
import { jsonError, matchRoute, readAndDecode, readOptionalAndDecode } from "./httpHelpers.ts";
import { handleProviderApiRequest } from "./providerRoutes.ts";
import * as AgentService from "./services/AgentService.ts";
import * as AttachmentService from "./services/AttachmentService.ts";
import type * as GitForgeService from "./services/GitForgeService.ts";
import * as HealthService from "./services/HealthService.ts";
import type * as ModelPerformanceService from "./services/ModelPerformanceService.ts";
import * as ModelTierService from "./services/ModelTierService.ts";
import * as ProjectService from "./services/ProjectService.ts";
import * as ProviderService from "./services/ProviderService.ts";
import * as SkillService from "./services/SkillService.ts";
import * as ThreadService from "./services/ThreadService.ts";
import * as UsageService from "./services/UsageService.ts";
import { handleThreadExtraApiRequest } from "./threadExtraRoutes.ts";

const decodeUsageRange = Schema.decodeUnknownOption(UsageRange);
const decodeUsageProvider = Schema.decodeUnknownOption(UsageProviderFilter);

export type ApiServices =
  | AgentService.AgentService
  | AttachmentService.AttachmentService
  | GitForgeService.GitForgeService
  | HealthService.HealthService
  | ModelPerformanceService.ModelPerformanceService
  | ModelTierService.ModelTierService
  | ProjectService.ProjectService
  | ProviderService.ProviderService
  | SkillService.SkillService
  | ThreadService.ThreadService
  | UsageService.UsageService;

const decodeAttachmentHeaderName = (raw: string | null): string => {
  if (!raw) return "attachment";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const readUploadPayload = (request: Request) =>
  Effect.gen(function* () {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("multipart/form-data")) {
      const formData = yield* Effect.tryPromise({
        try: () => request.formData(),
        catch: () => new Error("Request body must be valid multipart/form-data."),
      });
      const file = formData.get("file");
      if (!(file instanceof Blob)) {
        return yield* Effect.fail(new Error('Multipart upload must include a "file" field.'));
      }
      const rawName =
        "name" in file && typeof file.name === "string" && file.name.length > 0
          ? file.name
          : decodeAttachmentHeaderName(request.headers.get("x-attachment-name"));
      const mimeType = file.type || request.headers.get("x-attachment-mime-type") || "";
      const bytes = new Uint8Array(
        yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: () => new Error("Failed to read uploaded attachment bytes."),
        }),
      );
      return { name: rawName, mimeType, bytes };
    }

    const bytes = new Uint8Array(
      yield* Effect.tryPromise({
        try: () => request.arrayBuffer(),
        catch: () => new Error("Failed to read uploaded attachment bytes."),
      }),
    );
    return {
      name: decodeAttachmentHeaderName(request.headers.get("x-attachment-name")),
      mimeType: contentType,
      bytes,
    };
  });

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

    const threadExtraResponse = yield* handleThreadExtraApiRequest(request, url);
    if (threadExtraResponse !== null) return threadExtraResponse;

    const providerResponse = yield* handleProviderApiRequest(request, url);
    if (providerResponse !== null) return providerResponse;

    if (method === "GET" && pathname === "/api/health") {
      const health = yield* HealthService.HealthService;
      return Response.json(yield* health.check());
    }

    if (method === "POST" && pathname === "/api/attachments") {
      const attachmentService = yield* AttachmentService.AttachmentService;
      return yield* readUploadPayload(request).pipe(
        Effect.flatMap((payload) => attachmentService.saveUpload(payload)),
        Effect.map((uploaded) => Response.json(uploaded, { status: 201 })),
        Effect.catch((err) =>
          Effect.succeed(
            jsonError(
              err.message,
              err instanceof AttachmentService.AttachmentServiceError ? err.httpStatus : 400,
            ),
          ),
        ),
      );
    }

    const attachmentById = matchRoute(pathname, /^\/api\/attachments\/([^/]+)$/);
    if (method === "GET" && attachmentById !== null) {
      const attachmentService = yield* AttachmentService.AttachmentService;
      return yield* attachmentService.readAttachment(attachmentById[0]!).pipe(
        Effect.map((attachment) => {
          const safeName = attachment.name.replace(/["\r\n\\]/g, "_");
          return new Response(new Uint8Array(attachment.bytes), {
            status: 200,
            headers: {
              "Content-Type": attachment.mimeType,
              "Cache-Control": "public, max-age=31536000, immutable",
              "Content-Disposition": `inline; filename="${safeName}"`,
            },
          });
        }),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, err.httpStatus))),
      );
    }

    if (method === "GET" && pathname === "/api/usage") {
      const usageService = yield* UsageService.UsageService;
      const rangeOpt = decodeUsageRange(url.searchParams.get("range") ?? "7d");
      const providerOpt = decodeUsageProvider(url.searchParams.get("provider") ?? "all");
      const refresh = url.searchParams.get("refresh") === "1";
      const report = yield* usageService.getReport({
        range: rangeOpt._tag === "Some" ? rangeOpt.value : "7d",
        provider: providerOpt._tag === "Some" ? providerOpt.value : "all",
        refresh,
      });
      return Response.json(report);
    }

    if (method === "GET" && pathname === "/api/workspace") {
      const projectService = yield* ProjectService.ProjectService;
      const threadService = yield* ThreadService.ThreadService;
      const providerService = yield* ProviderService.ProviderService;
      const agentService = yield* AgentService.AgentService;
      const skillService = yield* SkillService.SkillService;
      const modelTierService = yield* ModelTierService.ModelTierService;
      const [projects, threads, providers, agents, issues, skills, modelTiers] = yield* Effect.all([
        projectService.list(),
        threadService.list(),
        providerService.listSnapshots(),
        agentService.list(),
        agentService.listAllIssues(),
        skillService.list(),
        modelTierService.getAll(),
      ]);
      return Response.json({ projects, threads, providers, agents, issues, skills, modelTiers });
    }

    if (method === "GET" && pathname === "/api/issues") {
      const agentService = yield* AgentService.AgentService;
      return Response.json(yield* agentService.listAllIssues());
    }

    if (method === "GET" && pathname === "/api/skills") {
      const skillService = yield* SkillService.SkillService;
      return Response.json(yield* skillService.list());
    }

    const skillById = matchRoute(pathname, /^\/api\/skills\/([^/]+)$/);
    if (method === "GET" && skillById !== null) {
      const skillService = yield* SkillService.SkillService;
      const fileParam = url.searchParams.get("file") ?? undefined;
      const detail = yield* skillService.getDetail(skillById[0]!, fileParam);
      if (detail === null) {
        return jsonError("Skill not found.", 404);
      }
      return Response.json(detail);
    }

    if (method === "GET" && pathname === "/api/model-tiers") {
      const modelTierService = yield* ModelTierService.ModelTierService;
      return Response.json(yield* modelTierService.getAll());
    }

    if (method === "PUT" && pathname === "/api/model-tiers") {
      const modelTierService = yield* ModelTierService.ModelTierService;
      return yield* readAndDecode(request, UpdateModelTierConfigInput).pipe(
        Effect.flatMap((input) => modelTierService.setScope(input.scope, input.config)),
        Effect.map((modelTiers) => Response.json(modelTiers)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    if (method === "GET" && pathname === "/api/fs/list") {
      const projectService = yield* ProjectService.ProjectService;
      const dir = url.searchParams.get("path") ?? undefined;
      const includeFiles = url.searchParams.get("includeFiles") === "1";
      return yield* projectService
        .listDirectory(dir, includeFiles ? { includeFiles: true } : undefined)
        .pipe(
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
        Effect.flatMap((input) =>
          threadService.dispatchTurn(ThreadId.make(threadTurns[0]!), input),
        ),
        Effect.map((outcome) =>
          outcome.kind === "queued"
            ? Response.json(
                { kind: "queued", disposition: "queued", queuedTurn: outcome.queuedTurn },
                { status: 201 },
              )
            : Response.json(
                {
                  ...outcome.turn,
                  kind: outcome.kind,
                  disposition: outcome.kind,
                  turn: outcome.turn,
                },
                { status: 201 },
              ),
        ),
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

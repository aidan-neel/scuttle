import {
  EditQueuedTurnInput,
  ModelPerfQueryInput,
  RateModelRunInput,
  RewindThreadInput,
} from "@scuttle/contracts";
import { ThreadId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { jsonError, matchRoute, readAndDecode } from "./httpHelpers.ts";
import * as ModelPerformanceService from "./services/ModelPerformanceService.ts";
import * as ThreadService from "./services/ThreadService.ts";

const decodePerfQuery = Schema.decodeUnknownOption(ModelPerfQueryInput);

const threadErrorStatus = (message: string): number =>
  message.includes("was not found") ? 404 : 400;

export const handleThreadExtraApiRequest = (
  request: Request,
  url: URL,
): Effect.Effect<
  Response | null,
  never,
  ThreadService.ThreadService | ModelPerformanceService.ModelPerformanceService
> =>
  Effect.gen(function* () {
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    const threadRewind = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/rewind$/);
    if (method === "POST" && threadRewind !== null) {
      const threads = yield* ThreadService.ThreadService;
      const id = ThreadId.make(threadRewind[0]!);
      return yield* readAndDecode(request, RewindThreadInput).pipe(
        Effect.flatMap((input) => threads.rewindThread(id, input)),
        Effect.map((result) => Response.json(result)),
        Effect.catch((err) =>
          Effect.succeed(jsonError(err.message, threadErrorStatus(err.message))),
        ),
      );
    }

    const threadQueueRoot = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/queue$/);
    if (method === "GET" && threadQueueRoot !== null) {
      const threads = yield* ThreadService.ThreadService;
      return yield* threads.listQueuedTurns(ThreadId.make(threadQueueRoot[0]!)).pipe(
        Effect.map((queued) => Response.json(queued)),
        Effect.catch((err) =>
          Effect.succeed(jsonError(err.message, threadErrorStatus(err.message))),
        ),
      );
    }

    const threadQueuePromote = matchRoute(
      pathname,
      /^\/api\/threads\/([^/]+)\/queue\/([^/]+)\/promote$/,
    );
    if (method === "POST" && threadQueuePromote !== null) {
      const threads = yield* ThreadService.ThreadService;
      const id = ThreadId.make(threadQueuePromote[0]!);
      const queuedId = threadQueuePromote[1]!;
      return yield* threads.promoteQueuedTurn(id, queuedId).pipe(
        Effect.map((res) =>
          res.kind === "steered"
            ? Response.json({
                ...res.turn,
                kind: "steered",
                disposition: "steered",
                turn: res.turn,
              })
            : Response.json({ kind: "queued", disposition: "queued", queuedTurn: res.queuedTurn }),
        ),
        Effect.catch((err) =>
          Effect.succeed(jsonError(err.message, threadErrorStatus(err.message))),
        ),
      );
    }

    const threadQueueItem = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/queue\/([^/]+)$/);
    if (threadQueueItem !== null) {
      const threads = yield* ThreadService.ThreadService;
      const id = ThreadId.make(threadQueueItem[0]!);
      const queuedId = threadQueueItem[1]!;
      if (method === "PATCH") {
        return yield* readAndDecode(request, EditQueuedTurnInput).pipe(
          Effect.flatMap((input) => threads.editQueuedTurn(id, queuedId, input)),
          Effect.map((updated) => Response.json(updated)),
          Effect.catch((err) =>
            Effect.succeed(jsonError(err.message, threadErrorStatus(err.message))),
          ),
        );
      }
      if (method === "DELETE") {
        return yield* threads.cancelQueuedTurn(id, queuedId).pipe(
          Effect.map(() => new Response(null, { status: 204 })),
          Effect.catch((err) =>
            Effect.succeed(jsonError(err.message, threadErrorStatus(err.message))),
          ),
        );
      }
    }

    const threadViz = matchRoute(pathname, /^\/api\/threads\/([^/]+)\/visualizations$/);
    if (method === "GET" && threadViz !== null) {
      const threads = yield* ThreadService.ThreadService;
      return yield* threads.listVisualizations(ThreadId.make(threadViz[0]!)).pipe(
        Effect.map((items) => Response.json(items)),
        Effect.catch((err) =>
          Effect.succeed(jsonError(err.message, threadErrorStatus(err.message))),
        ),
      );
    }

    if (method === "GET" && pathname === "/api/performance") {
      const perf = yield* ModelPerformanceService.ModelPerformanceService;
      const daysRaw = url.searchParams.get("days");
      const limitRaw = url.searchParams.get("limit");
      const rawQuery = {
        ...(url.searchParams.get("model") ? { model: url.searchParams.get("model")! } : {}),
        ...(url.searchParams.get("providerId")
          ? { providerId: url.searchParams.get("providerId")! }
          : {}),
        ...(url.searchParams.get("category")
          ? { category: url.searchParams.get("category")! }
          : {}),
        ...(daysRaw !== null && Number.isFinite(Number(daysRaw)) ? { days: Number(daysRaw) } : {}),
        ...(limitRaw !== null && Number.isFinite(Number(limitRaw))
          ? { limit: Number(limitRaw) }
          : {}),
      };
      const queryOpt = decodePerfQuery(rawQuery);
      if (queryOpt._tag === "None") {
        return jsonError("Invalid performance query parameters.", 400);
      }
      return yield* perf.querySummary(queryOpt.value).pipe(
        Effect.map((summary) => Response.json(summary)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    if (method === "POST" && pathname === "/api/performance/rate") {
      const perf = yield* ModelPerformanceService.ModelPerformanceService;
      return yield* readAndDecode(request, RateModelRunInput).pipe(
        Effect.flatMap((input) => perf.rateRun(input)),
        Effect.map((run) => Response.json(run)),
        Effect.catch((err) =>
          Effect.succeed(
            jsonError(
              err.message,
              err instanceof ModelPerformanceService.ModelPerformanceServiceError &&
                err.reason === "not-found"
                ? 404
                : 400,
            ),
          ),
        ),
      );
    }

    const perfRunById = matchRoute(pathname, /^\/api\/performance\/runs\/([^/]+)$/);
    if (method === "DELETE" && perfRunById !== null) {
      const perf = yield* ModelPerformanceService.ModelPerformanceService;
      return yield* perf.deleteRun(perfRunById[0]!).pipe(
        Effect.map((deleted) =>
          deleted
            ? new Response(null, { status: 204 })
            : jsonError("Performance run not found.", 404),
        ),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, 400))),
      );
    }

    return null;
  });

import {
  CreateProviderInstanceInput,
  InstallAcpAgentInput,
  ProviderConfigPatch,
} from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Effect from "effect/Effect";
import { jsonError, matchRoute, readAndDecode } from "./httpHelpers.ts";
import * as ProviderService from "./services/ProviderService.ts";

type ProviderServiceShape = ProviderService.ProviderService["Service"];

const errorStatus = (err: { readonly message: string }): number =>
  err.message.includes("was not found") ? 404 : 400;

export const handleProviderRoute = (
  req: Request,
  url: URL,
  providers: ProviderServiceShape,
  method: string,
): Effect.Effect<Response | null> => {
  const pathname = url.pathname;
  const upperMethod = method.toUpperCase();

  if (upperMethod === "GET" && pathname === "/api/providers") {
    return providers.listSnapshots().pipe(Effect.map((list) => Response.json(list)));
  }

  if (upperMethod === "POST" && pathname === "/api/providers") {
    return readAndDecode(req, CreateProviderInstanceInput).pipe(
      Effect.flatMap((input) => providers.createInstance(input)),
      Effect.map((snapshot) => Response.json(snapshot, { status: 201 })),
      Effect.catch((err) => Effect.succeed(jsonError(err.message, errorStatus(err)))),
    );
  }

  if (upperMethod === "POST" && pathname === "/api/providers/refresh") {
    return providers.refreshAll().pipe(Effect.map((list) => Response.json(list)));
  }

  const providerById = matchRoute(pathname, /^\/api\/providers\/([^/]+)$/);
  if (providerById !== null) {
    const id = ProviderId.make(providerById[0]!);
    if (upperMethod === "PATCH") {
      return readAndDecode(req, ProviderConfigPatch).pipe(
        Effect.flatMap((patch) => providers.updateConfig(id, patch)),
        Effect.map((snapshot) => Response.json(snapshot)),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, errorStatus(err)))),
      );
    }
    if (upperMethod === "DELETE") {
      return providers.deleteInstance(id).pipe(
        Effect.map(() => new Response(null, { status: 204 })),
        Effect.catch((err) => Effect.succeed(jsonError(err.message, errorStatus(err)))),
      );
    }
  }

  if (upperMethod === "GET" && pathname === "/api/acp-registry") {
    const refreshParam = url.searchParams.get("refresh");
    const refresh = refreshParam === "1" || refreshParam === "true";
    return providers.listAcpRegistry(refresh ? { refresh: true } : undefined).pipe(
      Effect.map((agents) => Response.json(agents)),
      Effect.catch((err) => Effect.succeed(jsonError(err.message, 502))),
    );
  }

  if (upperMethod === "POST" && pathname === "/api/acp-registry/install") {
    return readAndDecode(req, InstallAcpAgentInput).pipe(
      Effect.flatMap((input) => providers.installAcpAgent(input)),
      Effect.map((snapshot) => Response.json(snapshot, { status: 201 })),
      Effect.catch((err) => Effect.succeed(jsonError(err.message, errorStatus(err)))),
    );
  }

  return Effect.succeed(null);
};

export const handleProviderApiRequest = (
  req: Request,
  url: URL,
): Effect.Effect<Response | null, never, ProviderService.ProviderService> =>
  Effect.gen(function* () {
    const providers = yield* ProviderService.ProviderService;
    return yield* handleProviderRoute(req, url, providers, req.method);
  });

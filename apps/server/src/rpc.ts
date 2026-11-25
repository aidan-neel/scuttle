import { RpcRequest, type RpcResponse } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HealthService from "./services/HealthService.ts";

const decodeRpcRequest = Schema.decodeUnknownEffect(RpcRequest);

export const handleRpcMessage = Effect.fn("Rpc.handleMessage")(function* (
  raw: string,
): Effect.fn.Return<RpcResponse, never, HealthService.HealthService> {
  const parsed = yield* Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)));

  if (parsed === null) {
    return {
      kind: "error",
      code: "INVALID_JSON",
      message: "RPC message is not valid JSON.",
    };
  }

  const decoded = yield* decodeRpcRequest(parsed).pipe(
    Effect.map((request) => ({ ok: true as const, request })),
    Effect.catch(() => Effect.succeed({ ok: false as const })),
  );

  if (!decoded.ok) {
    return {
      kind: "error",
      code: "INVALID_REQUEST",
      message: "RPC message did not match the Scuttle wire contract.",
    };
  }

  const request = decoded.request;
  switch (request.kind) {
    case "ping":
      return {
        kind: "pong",
        id: request.id,
        serverTime: new Date().toISOString(),
      };
    case "health": {
      const healthService = yield* HealthService.HealthService;
      return yield* healthService.check().pipe(
        Effect.map((health): RpcResponse => ({
          kind: "health",
          id: request.id,
          health,
        })),
        Effect.catch((): Effect.Effect<RpcResponse> =>
          Effect.succeed({
            kind: "error",
            id: request.id,
            code: "HEALTH_CHECK_FAILED",
            message: "Failed to read server health.",
          }),
        ),
      );
    }
    default: {
      const _exhaustive: never = request;
      return _exhaustive;
    }
  }
});

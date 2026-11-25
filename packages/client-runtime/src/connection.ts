import { HealthStatus, RpcResponse } from "@scuttle/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type ConnectionState =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting"; readonly attempt: number }
  | { readonly kind: "connected"; readonly health: HealthStatus }
  | { readonly kind: "disconnected"; readonly reason: string; readonly attempt: number };

export class ServerFetchError extends Schema.TaggedError<ServerFetchError>()("ServerFetchError", {
  endpoint: Schema.String,
  status: Schema.optionalKey(Schema.Number),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to reach Scuttle server at ${this.endpoint}.`;
  }
}

const decodeHealth = Schema.decodeUnknownEffect(HealthStatus);
const decodeRpcResponse = Schema.decodeUnknownEffect(RpcResponse);

export const resolveBaseHttpUrl = (explicitBaseUrl?: string): string => {
  if (explicitBaseUrl !== undefined && explicitBaseUrl.length > 0) {
    return explicitBaseUrl.replace(/\/+$/, "");
  }
  return "";
};

export const resolveWebSocketUrl = (explicitBaseUrl?: string): string => {
  if (explicitBaseUrl !== undefined && explicitBaseUrl.length > 0) {
    const parsed = new URL(explicitBaseUrl);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = "/ws";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }
  const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${globalThis.location.host}/ws`;
};

export const fetchServerHealth = Effect.fn("ClientRuntime.fetchServerHealth")(function* (
  baseUrl?: string,
) {
  const endpoint = `${resolveBaseHttpUrl(baseUrl)}/api/health`;
  const response = yield* Effect.tryPromise({
    try: () => fetch(endpoint),
    catch: (cause) => new ServerFetchError({ endpoint, cause }),
  });
  if (!response.ok) {
    return yield* new ServerFetchError({
      endpoint,
      status: response.status,
      cause: new Error(`HTTP ${response.status}`),
    });
  }
  const payload = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new ServerFetchError({ endpoint, cause }),
  });
  return yield* decodeHealth(payload).pipe(
    Effect.mapError((cause) => new ServerFetchError({ endpoint, cause })),
  );
});

export const parseServerRpcMessage = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => new ServerFetchError({ endpoint: "/ws", cause }),
  }).pipe(
    Effect.flatMap((parsed) =>
      decodeRpcResponse(parsed).pipe(
        Effect.mapError((cause) => new ServerFetchError({ endpoint: "/ws", cause })),
      ),
    ),
  );

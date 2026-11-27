import * as Effect from "effect/Effect";
import { resolveBaseHttpUrl, ServerFetchError } from "./connection.ts";

export const describeApiError = (error: unknown, fallback: string): string => {
  if (error instanceof ServerFetchError && error.cause instanceof Error) {
    return error.cause.message;
  }
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const err = payload.error;
    if (typeof err === "string" && err.length > 0) return err;
  }
  return fallback;
};

const buildHeaders = (init: RequestInit | undefined): Headers => {
  const headers = new Headers(init?.headers);
  if (
    init?.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
};

export const requestJson = <A>(
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

export const requestVoid = (
  baseUrl: string | undefined,
  path: string,
  init: RequestInit | undefined,
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

export const postJson = (body?: unknown): RequestInit =>
  body === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(body) };

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const jsonError = (message: string, status: number): Response =>
  Response.json({ error: message }, { status });

export const readAndDecode = <A>(request: Request, schema: Schema.Decoder<A>) =>
  Effect.gen(function* () {
    const raw: unknown = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () => new Error("Request body must be valid JSON."),
    });
    return yield* Schema.decodeUnknownEffect(schema)(raw).pipe(
      Effect.mapError(() => new Error("Request body did not match expected schema.")),
    );
  });

export const matchRoute = (pathname: string, pattern: RegExp): ReadonlyArray<string> | null => {
  const match = pattern.exec(pathname);
  if (!match) return null;
  return match.slice(1).map((segment) => decodeURIComponent(segment));
};

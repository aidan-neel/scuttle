import type { HealthStatus } from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

export class HealthCheckError extends Schema.TaggedError<HealthCheckError>()("HealthCheckError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Failed to compute Scuttle server health.";
  }
}

export class HealthService extends Context.Service<
  HealthService,
  {
    readonly check: () => Effect.Effect<HealthStatus, HealthCheckError>;
  }
>()("scuttle/server/HealthService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const sqlite = yield* Sqlite.SqliteDatabase;
  const startedAt = Date.now();

  const check = Effect.fn("HealthService.check")(function* () {
    const databaseReady = yield* sqlite
      .ping()
      .pipe(Effect.mapError((cause) => new HealthCheckError({ cause })));

    return {
      status: "ok" as const,
      service: "scuttle-server",
      version: config.version,
      uptimeMs: Math.max(0, Date.now() - startedAt),
      databaseReady,
      timestamp: new Date().toISOString(),
    };
  });

  return HealthService.of({ check });
});

export const layer = Layer.effect(HealthService, make);

import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as HealthService from "./HealthService.ts";

const testConfigLayer = ServerConfig.layer({
  dbPath: ":memory:",
  port: 0,
  version: "0.1.0-test",
});

const testLayer = HealthService.layer.pipe(
  Layer.provide(Sqlite.layer.pipe(Layer.provide(testConfigLayer))),
  Layer.provide(testConfigLayer),
);

describe("HealthService", () => {
  test("reports databaseReady with in-memory SQLite", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* HealthService.HealthService;
        return yield* service.check();
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.status).toBe("ok");
    expect(result.service).toBe("scuttle-server");
    expect(result.version).toBe("0.1.0-test");
    expect(result.databaseReady).toBe(true);
    expect(result.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

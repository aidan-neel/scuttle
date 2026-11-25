import { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import { applyScuttleMigrations } from "./migrations.ts";

export class SqliteDatabaseError extends Schema.TaggedError<SqliteDatabaseError>()(
  "SqliteDatabaseError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `SQLite operation "${this.operation}" failed.`;
  }
}

export class SqliteDatabase extends Context.Service<
  SqliteDatabase,
  {
    readonly db: Database;
    readonly ping: () => Effect.Effect<boolean, SqliteDatabaseError>;
  }
>()("scuttle/server/SqliteDatabase") {}

const configurePragmas = (db: Database, isMemory: boolean) => {
  db.run("PRAGMA foreign_keys = ON;");
  db.run("PRAGMA busy_timeout = 5000;");
  if (!isMemory) {
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");
  }
  db.run("PRAGMA temp_store = MEMORY;");
  applyScuttleMigrations(db);
};

const make = Effect.gen(function* () {
  const { dbPath } = yield* ServerConfig.ServerConfig;
  const isMemory = dbPath === ":memory:";

  const db = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        if (!isMemory) {
          NodeFS.mkdirSync(NodePath.dirname(dbPath), { recursive: true });
        }
        const instance = new Database(dbPath, { create: true });
        configurePragmas(instance, isMemory);
        return instance;
      },
      catch: (cause) => new SqliteDatabaseError({ operation: "open", cause }),
    }),
    (instance) =>
      Effect.sync(() => {
        instance.close();
      }),
  );

  const ping = Effect.fn("SqliteDatabase.ping")(function* () {
    const row = yield* Effect.try({
      try: () => db.query<{ ok: number }, []>("SELECT 1 AS ok").get(),
      catch: (cause) => new SqliteDatabaseError({ operation: "ping", cause }),
    });
    return row?.ok === 1;
  });

  return SqliteDatabase.of({ db, ping });
});

export const layer = Layer.effect(SqliteDatabase, make);

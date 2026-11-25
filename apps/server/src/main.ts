import * as Effect from "effect/Effect";
import { startScuttleServer } from "./server.ts";

const handle = await startScuttleServer();
await Effect.runPromise(Effect.logInfo(`Scuttle server listening at ${handle.url}`));

const shutdown = async () => {
  await handle.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

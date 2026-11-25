import * as Schema from "effect/Schema";
import { Agent } from "./agent.ts";
import { ProviderSnapshot } from "./provider.ts";
import { Project, Thread } from "./thread.ts";

export * from "./thread.ts";

export const WorkspaceSnapshot = Schema.Struct({
  projects: Schema.Array(Project),
  threads: Schema.Array(Thread),
  providers: Schema.Array(ProviderSnapshot),
  agents: Schema.Array(Agent),
});
export type WorkspaceSnapshot = typeof WorkspaceSnapshot.Type;

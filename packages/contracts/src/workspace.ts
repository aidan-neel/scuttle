import * as Schema from "effect/Schema";
import { Agent, AgentIssue } from "./agent.ts";
import { ScopedModelTierConfigs, ScuttleSkill } from "./astack.ts";
import { ProviderSnapshot } from "./provider.ts";
import { Project, Thread } from "./thread.ts";

export * from "./thread.ts";

export const WorkspaceSnapshot = Schema.Struct({
  projects: Schema.Array(Project),
  threads: Schema.Array(Thread),
  providers: Schema.Array(ProviderSnapshot),
  agents: Schema.Array(Agent),
  issues: Schema.optionalKey(Schema.Array(AgentIssue)),
  skills: Schema.optionalKey(Schema.Array(ScuttleSkill)),
  modelTiers: Schema.optionalKey(ScopedModelTierConfigs),
});
export type WorkspaceSnapshot = typeof WorkspaceSnapshot.Type;

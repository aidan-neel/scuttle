import { AgentId, ProjectId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";
import { ModelSelection } from "./provider.ts";

export const MODEL_TIER_SIZES = [
  "nano",
  "small",
  "medium",
  "large",
  "xlarge",
  "max",
  "design",
] as const;

export const ModelTierSize = Schema.Literals([...MODEL_TIER_SIZES]);
export type ModelTierSize = typeof ModelTierSize.Type;

export const REASONING_BUDGETS = ["small", "medium", "large", "unlimited"] as const;

export const ReasoningBudget = Schema.Literals([...REASONING_BUDGETS]);
export type ReasoningBudget = typeof ReasoningBudget.Type;

export const ModelTierScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["global"]) }),
  Schema.Struct({ kind: Schema.Literals(["project"]), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literals(["agent"]), agentId: AgentId }),
]);
export type ModelTierScope = typeof ModelTierScope.Type;

export const ModelTierConfig = Schema.Struct({
  budget: Schema.optionalKey(ReasoningBudget),
  nano: Schema.optionalKey(ModelSelection),
  small: Schema.optionalKey(ModelSelection),
  medium: Schema.optionalKey(ModelSelection),
  large: Schema.optionalKey(ModelSelection),
  xlarge: Schema.optionalKey(ModelSelection),
  max: Schema.optionalKey(ModelSelection),
  design: Schema.optionalKey(ModelSelection),
  panel: Schema.optionalKey(Schema.Array(ModelSelection)),
  council: Schema.optionalKey(Schema.Array(ModelSelection)),
});
export type ModelTierConfig = typeof ModelTierConfig.Type;

export const ScopedModelTierConfigs = Schema.Struct({
  global: ModelTierConfig,
  projects: Schema.Record(Schema.String, ModelTierConfig),
  agents: Schema.Record(Schema.String, ModelTierConfig),
});
export type ScopedModelTierConfigs = typeof ScopedModelTierConfigs.Type;

export const EMPTY_SCOPED_MODEL_TIERS: ScopedModelTierConfigs = {
  global: {},
  projects: {},
  agents: {},
};

export const UpdateModelTierConfigInput = Schema.Struct({
  scope: ModelTierScope,
  config: ModelTierConfig,
});
export type UpdateModelTierConfigInput = typeof UpdateModelTierConfigInput.Type;

export const ScuttleSkill = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  name: Schema.String,
  description: Schema.String,
  path: Schema.String,
  source: Schema.Literals(["vendored"]),
  hidden: Schema.Boolean,
});
export type ScuttleSkill = typeof ScuttleSkill.Type;

export const ScuttleSkillDetail = Schema.Struct({
  skill: ScuttleSkill,
  activeFile: Schema.String,
  content: Schema.String,
  files: Schema.Array(Schema.String),
});
export type ScuttleSkillDetail = typeof ScuttleSkillDetail.Type;

export type ModelTierSource = "agent" | "project" | "global" | "inherit";

export interface ResolvedSlot<T> {
  readonly value: T | undefined;
  readonly source: ModelTierSource;
}

export interface ResolvedModelTiers {
  readonly budget: ResolvedSlot<ReasoningBudget>;
  readonly sizes: Readonly<Record<ModelTierSize, ResolvedSlot<ModelSelection>>>;
  readonly panel: ResolvedSlot<ReadonlyArray<ModelSelection>>;
  readonly council: ResolvedSlot<ReadonlyArray<ModelSelection>>;
}

export const modelTierScopeKey = (scope: ModelTierScope): string => {
  switch (scope.kind) {
    case "global":
      return "global";
    case "project":
      return `project:${scope.projectId}`;
    case "agent":
      return `agent:${scope.agentId}`;
  }
};

const pickLayer = <T>(
  layers: ReadonlyArray<{
    readonly source: Exclude<ModelTierSource, "inherit">;
    readonly value: T | undefined;
  }>,
): ResolvedSlot<T> => {
  for (const layer of layers) {
    if (layer.value !== undefined) {
      return { value: layer.value, source: layer.source };
    }
  }
  return { value: undefined, source: "inherit" };
};

export const resolveEffectiveModelTiers = (
  configs: ScopedModelTierConfigs,
  target?: { readonly projectId?: string | undefined; readonly agentId?: string | undefined },
): ResolvedModelTiers => {
  const agentCfg = target?.agentId ? configs.agents[target.agentId] : undefined;
  const projectCfg = target?.projectId ? configs.projects[target.projectId] : undefined;
  const globalCfg = configs.global;

  const layers = <K extends keyof ModelTierConfig>(key: K) => [
    { source: "agent" as const, value: agentCfg?.[key] },
    { source: "project" as const, value: projectCfg?.[key] },
    { source: "global" as const, value: globalCfg[key] },
  ];

  return {
    budget: pickLayer(layers("budget")),
    sizes: {
      nano: pickLayer(layers("nano")),
      small: pickLayer(layers("small")),
      medium: pickLayer(layers("medium")),
      large: pickLayer(layers("large")),
      xlarge: pickLayer(layers("xlarge")),
      max: pickLayer(layers("max")),
      design: pickLayer(layers("design")),
    },
    panel: pickLayer(layers("panel")),
    council: pickLayer(layers("council")),
  };
};

const formatSelection = (sel: ModelSelection): string =>
  `${sel.providerId}/${sel.model}${sel.effort ? ` effort=${sel.effort}` : ""}`;

export const resolveModelForRole = (
  resolved: ResolvedModelTiers,
  role: string,
): ModelSelection | undefined => {
  switch (role) {
    case "nano":
      return resolved.sizes.nano.value;
    case "small":
      return resolved.sizes.small.value;
    case "medium":
      return resolved.sizes.medium.value;
    case "large":
      return resolved.sizes.large.value;
    case "xlarge":
      return resolved.sizes.xlarge.value;
    case "max":
      return resolved.sizes.max.value;
    case "design":
      return resolved.sizes.design.value;
    case "fast":
      return resolved.sizes.nano.value ?? resolved.sizes.small.value;
    case "workhorse":
      return resolved.sizes.medium.value ?? resolved.sizes.small.value;
    case "review":
      return resolved.panel.value?.[0] ?? resolved.sizes.large.value;
    default:
      return undefined;
  }
};

export const formatResolvedModelTiers = (resolved: ResolvedModelTiers): string => {
  const lines: string[] = [];
  if (resolved.budget.value) {
    lines.push(`budget: ${resolved.budget.value} (${resolved.budget.source})`);
  }
  for (const size of MODEL_TIER_SIZES) {
    const slot = resolved.sizes[size];
    lines.push(
      slot.value ? `${size}: ${formatSelection(slot.value)} (${slot.source})` : `${size}: inherit`,
    );
  }
  if (resolved.panel.value && resolved.panel.value.length > 0) {
    lines.push(
      `panel: ${resolved.panel.value.map(formatSelection).join(", ")} (${resolved.panel.source})`,
    );
  } else {
    lines.push("panel: inherit");
  }
  if (resolved.council.value && resolved.council.value.length > 0) {
    lines.push(
      `council: ${resolved.council.value.map(formatSelection).join(", ")} (${resolved.council.source})`,
    );
  } else {
    lines.push("council: inherit");
  }
  return lines.join("\n");
};

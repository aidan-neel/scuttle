import { ProviderId } from "@scuttle/shared/ids";
import * as Schema from "effect/Schema";

export const ProviderKind = Schema.Literals([
  "claude",
  "codex",
  "antigravity",
  "opencode",
  "copilot",
]);
export type ProviderKind = typeof ProviderKind.Type;

export const ProviderStatusKind = Schema.Literals([
  "probing",
  "ready",
  "unauthenticated",
  "unavailable",
  "disabled",
]);
export type ProviderStatusKind = typeof ProviderStatusKind.Type;

export const RuntimeMode = Schema.Literals(["auto", "approval-required", "full-access"]);
export type RuntimeMode = typeof RuntimeMode.Type;

export const InteractionMode = Schema.Literals(["default", "plan"]);
export type InteractionMode = typeof InteractionMode.Type;

export const EffortLevel = Schema.Literals(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = typeof EffortLevel.Type;

export const ProviderModel = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  isDefault: Schema.optionalKey(Schema.Boolean),
  efforts: Schema.Array(EffortLevel),
  defaultEffort: Schema.optionalKey(EffortLevel),
});
export type ProviderModel = typeof ProviderModel.Type;

export const ProviderConfig = Schema.Struct({
  id: ProviderId,
  kind: ProviderKind,
  name: Schema.String,
  enabled: Schema.Boolean,
  binaryPath: Schema.String,
  launchArgs: Schema.String,
  defaultModel: Schema.optionalKey(Schema.String),
  defaultEffort: Schema.optionalKey(EffortLevel),
});
export type ProviderConfig = typeof ProviderConfig.Type;

export const ProviderConfigPatch = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
  defaultModel: Schema.optionalKey(Schema.NullOr(Schema.String)),
  defaultEffort: Schema.optionalKey(Schema.NullOr(EffortLevel)),
});
export type ProviderConfigPatch = typeof ProviderConfigPatch.Type;

export const ProviderSnapshot = Schema.Struct({
  id: ProviderId,
  kind: ProviderKind,
  name: Schema.String,
  enabled: Schema.Boolean,
  status: ProviderStatusKind,
  version: Schema.optionalKey(Schema.String),
  binaryPath: Schema.String,
  resolvedPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.String,
  defaultModel: Schema.optionalKey(Schema.String),
  defaultEffort: Schema.optionalKey(EffortLevel),
  message: Schema.optionalKey(Schema.String),
  setupHint: Schema.optionalKey(Schema.String),
  models: Schema.Array(ProviderModel),
  checkedAt: Schema.String,
});
export type ProviderSnapshot = typeof ProviderSnapshot.Type;

export const ModelSelection = Schema.Struct({
  providerId: ProviderId,
  providerKind: ProviderKind,
  model: Schema.String,
  effort: Schema.optionalKey(EffortLevel),
});
export type ModelSelection = typeof ModelSelection.Type;

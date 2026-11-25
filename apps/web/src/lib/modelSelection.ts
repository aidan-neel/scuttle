import { ModelSelection, type ProviderSnapshot } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { readDisabledModels } from "./disabledModels.ts";
import { modelFavoriteKey } from "./modelFavorites.ts";

const MODEL_STORAGE_KEY = "scuttle.defaultModelSelection.v1";

const decodeStoredSelection = Schema.decodeUnknownOption(ModelSelection);

export const FALLBACK_SELECTION: ModelSelection = {
  providerId: ProviderId.make("claude"),
  providerKind: "claude",
  model: "claude-opus-5-5",
  effort: "high",
};

export const readStoredSelection = (): ModelSelection | null => {
  try {
    const raw = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return null;
    const decoded = decodeStoredSelection(JSON.parse(raw));
    return Option.isSome(decoded) ? decoded.value : null;
  } catch {
    return null;
  }
};

export const writeStoredSelection = (selection: ModelSelection): void => {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    return;
  }
};

export const pickBestSelection = (
  providers: ReadonlyArray<ProviderSnapshot>,
  preferred: ModelSelection | null,
): ModelSelection => {
  const disabled = readDisabledModels();
  const isEnabled = (providerId: string, slug: string) =>
    !disabled.has(modelFavoriteKey(providerId, slug));
  if (preferred) {
    const match = providers.find((p) => p.id === preferred.providerId && p.enabled);
    if (match && match.status === "ready") {
      const enabledModels = match.models.filter((m) => isEnabled(match.id, m.slug));
      const model =
        enabledModels.find((m) => m.slug === preferred.model) ??
        enabledModels.find((m) => m.isDefault) ??
        enabledModels[0];
      if (model) {
        const effort =
          preferred.effort && model.efforts.includes(preferred.effort)
            ? preferred.effort
            : (model.defaultEffort ?? model.efforts[0]);
        return {
          providerId: match.id,
          providerKind: match.kind,
          model: model.slug,
          ...(effort ? { effort } : {}),
        };
      }
    }
  }
  const ready =
    providers.find(
      (p) => p.enabled && p.status === "ready" && p.models.some((m) => isEnabled(p.id, m.slug)),
    ) ??
    providers.find((p) => p.enabled && p.models.some((m) => isEnabled(p.id, m.slug))) ??
    providers.find((p) => p.enabled) ??
    providers[0];
  if (!ready) return preferred ?? FALLBACK_SELECTION;
  const enabledModels = ready.models.filter((m) => isEnabled(ready.id, m.slug));
  const pool = enabledModels.length > 0 ? enabledModels : ready.models;
  const model =
    pool.find((m) => m.slug === ready.defaultModel) ?? pool.find((m) => m.isDefault) ?? pool[0];
  if (!model) return preferred ?? FALLBACK_SELECTION;
  const effort =
    ready.defaultEffort && model.efforts.includes(ready.defaultEffort)
      ? ready.defaultEffort
      : (model.defaultEffort ?? model.efforts[0]);
  return {
    providerId: ready.id,
    providerKind: ready.kind,
    model: model.slug,
    ...(effort ? { effort } : {}),
  };
};

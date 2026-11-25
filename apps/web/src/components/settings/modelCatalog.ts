import type { ProviderModel } from "@scuttle/contracts";
import { displayModelName, upstreamOf as parseUpstream } from "@/lib/modelGrouping.ts";

export const ALL_UPSTREAMS = "all";
export const UNPREFIXED_UPSTREAM = "";

export interface UpstreamGroup {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export const upstreamOf = (slug: string): string =>
  parseUpstream(slug)?.label ?? UNPREFIXED_UPSTREAM;

export const upstreamLabel = (id: string): string => (id === UNPREFIXED_UPSTREAM ? "Other" : id);

export const modelDisplayName = (model: ProviderModel): string =>
  displayModelName(model, parseUpstream(model.slug));

export const upstreamGroups = (
  models: ReadonlyArray<ProviderModel>,
): ReadonlyArray<UpstreamGroup> => {
  const counts = new Map<string, number>();
  for (const model of models) {
    const id = upstreamOf(model.slug);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [...counts]
    .map(([id, count]) => ({ id, label: upstreamLabel(id), count }))
    .sort((a, b) => {
      if (a.id === UNPREFIXED_UPSTREAM) return 1;
      if (b.id === UNPREFIXED_UPSTREAM) return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
};

export interface ModelFilter {
  readonly query: string;
  readonly upstream: string;
}

export const filterModels = (
  models: ReadonlyArray<ProviderModel>,
  { query, upstream }: ModelFilter,
): ReadonlyArray<ProviderModel> => {
  const q = query.trim().toLowerCase();
  return models.filter(
    (model) =>
      (upstream === ALL_UPSTREAMS || upstreamOf(model.slug) === upstream) &&
      (q.length === 0 ||
        modelDisplayName(model).toLowerCase().includes(q) ||
        model.name.toLowerCase().includes(q) ||
        model.slug.toLowerCase().includes(q) ||
        upstreamLabel(upstreamOf(model.slug)).toLowerCase().includes(q)),
  );
};

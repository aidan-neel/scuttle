import { StarIcon } from "@hugeicons/core-free-icons";
import type { ProviderModel, ProviderSnapshot } from "@scuttle/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { modelFavoriteKey, useFavoriteModels } from "@/lib/modelFavorites.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import {
  ALL_UPSTREAMS,
  filterModels,
  modelDisplayName,
  type UpstreamGroup,
  upstreamGroups,
  upstreamLabel,
  upstreamOf,
} from "./modelCatalog.ts";
import { SearchField } from "./primitives.tsx";

function UpstreamPill({
  label,
  count,
  active,
  onSelect,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-label outline-none transition-colors duration-(--dur-hover) ease-hover focus-visible:shadow-focus",
        active
          ? "bg-white/10 text-fg shadow-[inset_0_0_0_1px_var(--color-edge)]"
          : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
      )}
    >
      {label}
      <span className={cn("font-mono text-meta", active ? "text-fg-muted" : "text-fg-faint")}>
        {count}
      </span>
    </button>
  );
}

function UpstreamPills({
  groups,
  total,
  active,
  onSelect,
}: {
  readonly groups: ReadonlyArray<UpstreamGroup>;
  readonly total: number;
  readonly active: string;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by upstream provider"
      className="-mx-1 flex gap-1 overflow-x-auto py-0.5 pr-8 pl-1 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]"
    >
      <UpstreamPill
        label="All"
        count={total}
        active={active === ALL_UPSTREAMS}
        onSelect={() => onSelect(ALL_UPSTREAMS)}
      />
      {groups.map((group) => (
        <UpstreamPill
          key={group.id}
          label={group.label}
          count={group.count}
          active={active === group.id}
          onSelect={() => onSelect(group.id)}
        />
      ))}
    </div>
  );
}

function ModelRow({
  model,
  showUpstream,
  starred,
  isDefault,
  onToggleFavorite,
  onMakeDefault,
}: {
  readonly model: ProviderModel;
  readonly showUpstream: boolean;
  readonly starred: boolean;
  readonly isDefault: boolean;
  readonly onToggleFavorite: () => void;
  readonly onMakeDefault: () => void;
}) {
  const name = modelDisplayName(model);

  return (
    <div className="group flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body text-fg" title={model.slug}>
            {name}
          </span>
          {isDefault && (
            <span className="shrink-0 rounded-chip bg-primary/16 px-1.5 py-0.5 text-meta text-input">
              Default
            </span>
          )}
        </div>
        {showUpstream && (
          <div className="truncate text-meta text-fg-muted">
            {upstreamLabel(upstreamOf(model.slug))}
          </div>
        )}
      </div>
      {!isDefault && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onMakeDefault}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          Make default
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={starred}
        aria-label={starred ? `Remove ${name} from favorites` : `Favorite ${name}`}
        onClick={onToggleFavorite}
        className={starred ? "text-warning hover:text-warning" : "text-fg-faint"}
      >
        <Icon icon={StarIcon} className={cn(starred && "fill-current")} />
      </Button>
    </div>
  );
}

export function ModelList({ provider }: { readonly provider: ProviderSnapshot }) {
  const { defaultModelSelection, setDefaultModelSelection } = useWorkspace();
  const { isFavorite, toggle } = useFavoriteModels();
  const [query, setQuery] = useState("");
  const [upstream, setUpstream] = useState<string>(ALL_UPSTREAMS);
  const groups = upstreamGroups(provider.models);
  const activeUpstream = groups.some((group) => group.id === upstream) ? upstream : ALL_UPSTREAMS;
  const visible = filterModels(provider.models, { query, upstream: activeUpstream });
  const showUpstream = groups.length > 0 && activeUpstream === ALL_UPSTREAMS;

  if (provider.models.length === 0) {
    return (
      <div className="rounded-card bg-panel px-4 py-5 text-label text-fg-muted shadow-raised">
        {provider.status === "ready"
          ? `${provider.name} did not report any models.`
          : `Models appear once ${provider.name} is ready.`}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card bg-panel shadow-raised">
      <div className="space-y-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={`Search ${provider.models.length} models`}
            className="flex-1"
          />
          <span className="shrink-0 px-1 font-mono text-meta text-fg-muted" aria-live="polite">
            {visible.length === provider.models.length
              ? `${visible.length}`
              : `${visible.length} / ${provider.models.length}`}
          </span>
        </div>
        {groups.length > 0 && (
          <UpstreamPills
            groups={groups}
            total={provider.models.length}
            active={activeUpstream}
            onSelect={setUpstream}
          />
        )}
      </div>
      <div className="max-h-[440px] divide-y divide-line overflow-y-auto overscroll-contain">
        {visible.map((model) => (
          <ModelRow
            key={model.slug}
            model={model}
            showUpstream={showUpstream}
            starred={isFavorite(modelFavoriteKey(provider.id, model.slug))}
            isDefault={
              defaultModelSelection.providerId === provider.id &&
              defaultModelSelection.model === model.slug
            }
            onToggleFavorite={() => toggle(modelFavoriteKey(provider.id, model.slug))}
            onMakeDefault={() =>
              setDefaultModelSelection({
                providerId: provider.id,
                providerKind: provider.kind,
                model: model.slug,
                ...(model.defaultEffort !== undefined ? { effort: model.defaultEffort } : {}),
              })
            }
          />
        ))}
        {visible.length === 0 && (
          <div className="px-4 py-5 text-label text-fg-muted">
            No models match “{query.trim()}”
            {activeUpstream === ALL_UPSTREAMS ? "" : ` in ${upstreamLabel(activeUpstream)}`}.
          </div>
        )}
      </div>
    </div>
  );
}

import { StarIcon } from "@hugeicons/core-free-icons";
import type { ProviderModel, ProviderSnapshot } from "@scuttle/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { useDisabledModels } from "@/lib/disabledModels.ts";
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
      className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto py-0.5 pr-8 pl-1 [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]"
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
  enabled,
  starred,
  isDefault,
  onToggleEnabled,
  onToggleFavorite,
  onMakeDefault,
}: {
  readonly model: ProviderModel;
  readonly showUpstream: boolean;
  readonly enabled: boolean;
  readonly starred: boolean;
  readonly isDefault: boolean;
  readonly onToggleEnabled: (enabled: boolean) => void;
  readonly onToggleFavorite: () => void;
  readonly onMakeDefault: () => void;
}) {
  const name = modelDisplayName(model);

  return (
    <div className={cn("group flex items-center gap-2.5 px-4 py-2", !enabled && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body text-fg" title={model.slug}>
            {name}
          </span>
          {isDefault && enabled && (
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
      {enabled && !isDefault && (
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
        disabled={!enabled}
        aria-pressed={starred}
        aria-label={starred ? `Remove ${name} from favorites` : `Favorite ${name}`}
        onClick={onToggleFavorite}
        className={starred ? "text-warning hover:text-warning" : "text-fg-faint"}
      >
        <Icon icon={StarIcon} className={cn(starred && "fill-current")} />
      </Button>
      <Switch
        checked={enabled}
        aria-label={enabled ? `Disable ${name}` : `Enable ${name}`}
        onCheckedChange={onToggleEnabled}
      />
    </div>
  );
}

export function ModelList({ provider }: { readonly provider: ProviderSnapshot }) {
  const { defaultModelSelection, setDefaultModelSelection } = useWorkspace();
  const { isFavorite, toggle } = useFavoriteModels();
  const { isDisabled, setDisabled, setManyDisabled } = useDisabledModels();
  const [query, setQuery] = useState("");
  const [upstream, setUpstream] = useState<string>(ALL_UPSTREAMS);
  const groups = upstreamGroups(provider.models);
  const activeUpstream = groups.some((group) => group.id === upstream) ? upstream : ALL_UPSTREAMS;
  const visible = filterModels(provider.models, { query, upstream: activeUpstream });
  const showUpstream = groups.length > 0 && activeUpstream === ALL_UPSTREAMS;
  const visibleKeys = visible.map((model) => modelFavoriteKey(provider.id, model.slug));
  const enabledVisibleCount = visibleKeys.filter((key) => !isDisabled(key)).length;
  const allVisibleDisabled = visible.length > 0 && enabledVisibleCount === 0;

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
          {visible.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setManyDisabled(visibleKeys, !allVisibleDisabled)}
              className="shrink-0 text-meta text-fg-muted"
            >
              {allVisibleDisabled ? "Enable all" : "Disable all"}
            </Button>
          )}
          <span className="shrink-0 px-1 font-mono text-meta text-fg-muted" aria-live="polite">
            {enabledVisibleCount === visible.length
              ? `${visible.length}`
              : `${enabledVisibleCount}/${visible.length}`}
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
        {visible.map((model) => {
          const key = modelFavoriteKey(provider.id, model.slug);
          const enabled = !isDisabled(key);
          return (
            <ModelRow
              key={model.slug}
              model={model}
              showUpstream={showUpstream}
              enabled={enabled}
              starred={isFavorite(key)}
              isDefault={
                defaultModelSelection.providerId === provider.id &&
                defaultModelSelection.model === model.slug
              }
              onToggleEnabled={(nextEnabled) => setDisabled(key, !nextEnabled)}
              onToggleFavorite={() => toggle(key)}
              onMakeDefault={() =>
                setDefaultModelSelection({
                  providerId: provider.id,
                  providerKind: provider.kind,
                  model: model.slug,
                  ...(model.defaultEffort !== undefined ? { effort: model.defaultEffort } : {}),
                })
              }
            />
          );
        })}
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

import { StarIcon } from "@hugeicons/core-free-icons";
import type { ProviderModel, ProviderSnapshot } from "@scuttle/contracts";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { useDisabledModels } from "@/lib/disabledModels.ts";
import { modelFavoriteKey, useFavoriteModels } from "@/lib/modelFavorites.ts";
import { spring } from "@/lib/motion.ts";
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
  layoutId,
  onSelect,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly layoutId: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "relative inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-label outline-none transition-colors duration-(--dur-hover) ease-hover active:scale-[0.98] focus-visible:shadow-focus",
        active ? "text-fg" : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
      )}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={spring.snappy}
          aria-hidden
          className="absolute inset-0 rounded-full bg-fg/10 shadow-[inset_0_0_0_1px_var(--color-edge)]"
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-1.5">
        {label}
        <span className={cn("font-mono text-meta", active ? "text-fg-muted" : "text-fg-faint")}>
          {count}
        </span>
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
  const pillId = useId();
  const layoutId = `${pillId}-upstream`;
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
        layoutId={layoutId}
        onSelect={() => onSelect(ALL_UPSTREAMS)}
      />
      {groups.map((group) => (
        <UpstreamPill
          key={group.id}
          label={group.label}
          count={group.count}
          active={active === group.id}
          layoutId={layoutId}
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
  canMakeDefault,
  starred,
  isDefault,
  onToggleEnabled,
  onToggleFavorite,
  onMakeDefault,
}: {
  readonly model: ProviderModel;
  readonly showUpstream: boolean;
  readonly enabled: boolean;
  readonly canMakeDefault: boolean;
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
        <div className="flex min-h-6 items-center gap-2">
          <span className="truncate text-body text-fg" title={model.slug}>
            {name}
          </span>
          {isDefault && enabled && (
            <span className="shrink-0 rounded-chip bg-primary/16 px-1.5 py-0.5 text-meta font-medium text-input">
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
      {canMakeDefault && !isDefault && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onMakeDefault}
          className="cursor-pointer opacity-0 transition-opacity duration-(--dur-hover) group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
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
  const { defaultModelSelection, setDefaultModelSelection, reconcileDefaultModelSelection } =
    useWorkspace();
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
  const providerReady = provider.enabled && provider.status === "ready";
  const currentDefaultKey = modelFavoriteKey(
    defaultModelSelection.providerId,
    defaultModelSelection.model,
  );

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
              onClick={() => {
                const disableAll = !allVisibleDisabled;
                setManyDisabled(visibleKeys, disableAll);
                if (disableAll && visibleKeys.includes(currentDefaultKey)) {
                  reconcileDefaultModelSelection();
                }
              }}
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
      <div className="scrollbar-none max-h-[27.5rem] divide-y divide-line overflow-y-auto overscroll-contain">
        {visible.map((model) => {
          const key = modelFavoriteKey(provider.id, model.slug);
          const enabled = !isDisabled(key);
          const isDefault =
            defaultModelSelection.providerId === provider.id &&
            defaultModelSelection.model === model.slug;
          const effort = model.defaultEffort ?? model.efforts[0];
          return (
            <ModelRow
              key={model.slug}
              model={model}
              showUpstream={showUpstream}
              enabled={enabled}
              canMakeDefault={enabled && providerReady}
              starred={isFavorite(key)}
              isDefault={isDefault}
              onToggleEnabled={(nextEnabled) => {
                setDisabled(key, !nextEnabled);
                if (!nextEnabled && isDefault) {
                  reconcileDefaultModelSelection();
                }
              }}
              onToggleFavorite={() => toggle(key)}
              onMakeDefault={() =>
                setDefaultModelSelection({
                  providerId: provider.id,
                  providerKind: provider.kind,
                  model: model.slug,
                  ...(effort !== undefined ? { effort } : {}),
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

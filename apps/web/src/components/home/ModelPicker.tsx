import { Popover } from "@base-ui/react/popover";
import {
  Add01Icon,
  ArrowDown01Icon,
  Search01Icon,
  StarIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type {
  EffortLevel,
  ModelSelection,
  ProviderModel,
  ProviderSnapshot,
} from "@scuttle/contracts";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { EFFORT_LABELS } from "@/lib/format.ts";
import { modelFavoriteKey, useFavoriteModels } from "@/lib/modelFavorites.ts";
import { easeOut, spring } from "@/lib/motion.ts";
import { ReasoningSlider } from "./ReasoningSlider.tsx";

interface ModelPickerProps {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly selection: ModelSelection;
  readonly onChange: (next: ModelSelection) => void;
}

interface ModelEntry {
  readonly key: string;
  readonly provider: ProviderSnapshot;
  readonly model: ProviderModel;
}

const UNFILTERED_PER_PROVIDER = 8;

function statusDotClass(status: ProviderSnapshot["status"]): string {
  switch (status) {
    case "ready":
      return "bg-success";
    case "unauthenticated":
      return "bg-warning";
    case "unavailable":
      return "bg-danger";
    default:
      return "bg-fg-faint";
  }
}

export function ModelPicker({ providers, selection, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [byProvider, setByProvider] = useState(true);
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const { favorites, isFavorite, toggle } = useFavoriteModels();

  const enabledProviders = providers.filter((p) => p.enabled);
  const allEntries: ModelEntry[] = enabledProviders.flatMap((provider) =>
    provider.models.map((model) => ({
      key: modelFavoriteKey(provider.id, model.slug),
      provider,
      model,
    })),
  );

  const currentKey = modelFavoriteKey(selection.providerId, selection.model);
  const currentEntry =
    allEntries.find((entry) => entry.key === currentKey) ?? allEntries[0] ?? null;
  const activeEfforts = currentEntry?.model.efforts ?? [];
  const activeEffort =
    selection.effort && activeEfforts.includes(selection.effort)
      ? selection.effort
      : (currentEntry?.model.defaultEffort ?? activeEfforts[0]);

  const detailEntry =
    (inspectedKey ? allEntries.find((entry) => entry.key === inspectedKey) : undefined) ??
    currentEntry;

  const normalizedQuery = query.trim().toLowerCase();

  const matchesQuery = (entry: ModelEntry) =>
    normalizedQuery.length === 0 ||
    entry.model.name.toLowerCase().includes(normalizedQuery) ||
    entry.model.slug.toLowerCase().includes(normalizedQuery) ||
    entry.provider.name.toLowerCase().includes(normalizedQuery);

  const favoriteEntries = allEntries.filter(
    (entry) => favorites.includes(entry.key) && matchesQuery(entry),
  );

  const groupedSections = enabledProviders
    .map((provider) => {
      const matched = provider.models
        .map((model) => ({
          key: modelFavoriteKey(provider.id, model.slug),
          provider,
          model,
        }))
        .filter(matchesQuery);
      const visible = normalizedQuery
        ? matched.slice(0, 24)
        : matched.slice(0, UNFILTERED_PER_PROVIDER);
      if (
        !normalizedQuery &&
        provider.id === selection.providerId &&
        currentEntry &&
        !visible.some((item) => item.key === currentEntry.key)
      ) {
        visible.unshift(currentEntry);
      }
      return {
        provider,
        visible,
        hiddenCount: Math.max(0, matched.length - visible.length),
      };
    })
    .filter((section) => section.visible.length > 0);

  const flatEntries = allEntries.filter(matchesQuery).slice(0, 40);

  const selectEntry = (entry: ModelEntry, effortOverride?: EffortLevel, closeAfter = false) => {
    const nextEffort =
      effortOverride ??
      (selection.effort && entry.model.efforts.includes(selection.effort)
        ? selection.effort
        : (entry.model.defaultEffort ?? entry.model.efforts[0]));
    onChange({
      providerId: entry.provider.id,
      providerKind: entry.provider.kind,
      model: entry.model.slug,
      ...(nextEffort ? { effort: nextEffort } : {}),
    });
    setInspectedKey(entry.key);
    if (closeAfter) {
      setOpen(false);
    }
  };

  const detailEffort =
    detailEntry && detailEntry.key === currentKey && activeEffort
      ? activeEffort
      : (detailEntry?.model.defaultEffort ?? detailEntry?.model.efforts[0]);

  const renderRow = (entry: ModelEntry) => {
    const selected = entry.key === currentKey;
    const inspected = detailEntry?.key === entry.key;
    return (
      <button
        key={entry.key}
        type="button"
        onMouseEnter={() => setInspectedKey(entry.key)}
        onFocus={() => setInspectedKey(entry.key)}
        onClick={() => selectEntry(entry, undefined, entry.model.efforts.length === 0)}
        className={`relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-chip px-2 text-left text-button outline-none transition-colors duration-100 ${
          inspected ? "text-fg" : "text-fg-secondary hover:text-fg"
        }`}
      >
        {inspected && (
          <motion.span
            layoutId="model-picker-highlight"
            transition={spring.layout}
            className="pointer-events-none absolute inset-0 rounded-chip bg-white/[0.08]"
          />
        )}
        <BrandLogo brand={entry.provider.kind} className="relative size-3.5 shrink-0" />
        <span className="relative min-w-0 flex-1 truncate">{entry.model.name}</span>
        {selected && <Icon icon={Tick02Icon} className="relative size-3.5 shrink-0 text-fg" />}
      </button>
    );
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setInspectedKey(null);
        }
      }}
    >
      <Popover.Trigger
        className={buttonClass(
          "quiet",
          "md",
          "group/picker max-w-full gap-1.5 data-popup-open:bg-(--wash)",
        )}
      >
        <BrandLogo brand={selection.providerKind} className="size-3.5 shrink-0" />
        <span className="whitespace-nowrap font-medium text-fg">
          {currentEntry?.model.name ?? selection.model}
        </span>
        {activeEffort && (
          <span className="whitespace-nowrap text-fg-muted">{EFFORT_LABELS[activeEffort]}</span>
        )}
        <Icon
          icon={ArrowDown01Icon}
          className="size-3 shrink-0 text-fg-muted transition-transform duration-150 ease-out group-data-popup-open/picker:rotate-180"
        />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50 outline-none">
          <Popover.Popup className="outline-none">
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring.snappy}
              className="flex items-end gap-2"
            >
              <div className="w-[272px] overflow-hidden rounded-card bg-menu shadow-menu">
                <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-2">
                  <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search models"
                    className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-muted"
                  />
                  <button
                    type="button"
                    onClick={() => setByProvider((prev) => !prev)}
                    className="shrink-0 cursor-pointer rounded-chip px-1.5 py-0.5 text-meta text-fg-muted transition-colors hover:bg-(--wash) hover:text-fg"
                  >
                    {byProvider ? "By provider" : "All"}
                  </button>
                </div>

                <LayoutGroup id="model-picker-rows">
                  <div className="max-h-80 overflow-y-auto p-1.5">
                    {favoriteEntries.length > 0 && (
                      <div className="mb-1.5">
                        <div className="px-2 pt-1 pb-1 text-meta font-medium text-fg-muted">
                          Favorites
                        </div>
                        {favoriteEntries.map(renderRow)}
                      </div>
                    )}

                    {byProvider ? (
                      groupedSections.map(({ provider, visible, hiddenCount }, idx) => (
                        <div
                          key={provider.id}
                          className={idx > 0 ? "mt-1.5 border-t border-edge pt-1.5" : ""}
                        >
                          <div className="flex items-center justify-between gap-2 px-2 py-1 text-meta font-medium text-fg-muted">
                            <span className="truncate">{provider.name}</span>
                            {provider.status !== "ready" && (
                              <span className="text-[10px] font-normal text-warning">
                                {provider.status === "unauthenticated"
                                  ? "Sign in"
                                  : provider.status === "probing"
                                    ? "Checking"
                                    : "Unavailable"}
                              </span>
                            )}
                          </div>
                          {visible.map(renderRow)}
                          {hiddenCount > 0 && (
                            <div className="px-2 py-1 text-meta text-fg-faint">
                              +{hiddenCount} more — search to filter
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="space-y-0.5">{flatEntries.map(renderRow)}</div>
                    )}

                    {groupedSections.length === 0 && (
                      <div className="px-2 py-5 text-center text-label text-fg-muted">
                        No matching models.
                      </div>
                    )}
                  </div>
                </LayoutGroup>
              </div>

              {detailEntry && (
                <div className="hidden w-[238px] overflow-hidden rounded-card bg-menu p-3.5 shadow-menu sm:block">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={detailEntry.key}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.12, ease: easeOut }}
                      className="flex flex-col gap-3.5"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <BrandLogo
                            brand={detailEntry.provider.kind}
                            className="size-3.5 shrink-0"
                          />
                          <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">
                            {detailEntry.model.name}
                          </span>
                          <span
                            title={detailEntry.provider.status}
                            className={`size-1.5 shrink-0 rounded-full ${statusDotClass(detailEntry.provider.status)}`}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-meta text-fg-muted">
                          <span className="truncate">{detailEntry.provider.name}</span>
                          {detailEntry.provider.version && (
                            <>
                              <span className="text-fg-faint">·</span>
                              <span className="font-mono text-fg-faint">
                                v{detailEntry.provider.version}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {detailEntry.model.efforts.length > 0 && detailEffort && (
                        <div className="border-t border-edge pt-3">
                          <ReasoningSlider
                            efforts={detailEntry.model.efforts}
                            value={detailEffort}
                            onChange={(effort) => selectEntry(detailEntry, effort, false)}
                          />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => toggle(detailEntry.key)}
                        className={buttonClass(
                          "secondary",
                          "sm",
                          "w-full cursor-pointer justify-center gap-1.5",
                        )}
                      >
                        <Icon
                          icon={isFavorite(detailEntry.key) ? StarIcon : Add01Icon}
                          className={`size-3.5 ${isFavorite(detailEntry.key) ? "text-warning" : ""}`}
                        />
                        {isFavorite(detailEntry.key) ? "Favorited" : "Add to favorites"}
                      </button>
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

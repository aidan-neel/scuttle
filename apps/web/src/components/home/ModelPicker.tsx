import { Popover } from "@base-ui/react/popover";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Search01Icon,
  StarIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type {
  EffortLevel,
  ModelSelection,
  ProviderSnapshot,
  ProviderStatusKind,
} from "@scuttle/contracts";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { type WheelEvent, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { EFFORT_LABELS } from "@/lib/format.ts";
import { modelFavoriteKey, useFavoriteModels } from "@/lib/modelFavorites.ts";
import {
  ALL_FILTER as ALL,
  buildModelEntries,
  buildPickerView,
  type ChipItem,
  type ModelEntry,
  type UpstreamGroup,
} from "@/lib/modelGrouping.ts";
import { easeOut, spring } from "@/lib/motion.ts";
import { ReasoningSlider } from "./ReasoningSlider.tsx";

interface ModelPickerProps {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly selection: ModelSelection;
  readonly onChange: (next: ModelSelection) => void;
}

const STATUS_DOT: Record<ProviderStatusKind, string> = {
  ready: "bg-success",
  unauthenticated: "bg-warning",
  unavailable: "bg-danger",
  probing: "bg-fg-faint",
  disabled: "bg-fg-faint",
};

const STATUS_LABEL: Record<ProviderStatusKind, string> = {
  ready: "Ready",
  unauthenticated: "Sign in",
  unavailable: "Unavailable",
  probing: "Checking",
  disabled: "Disabled",
};

const scrollChipsWithWheel = (event: WheelEvent<HTMLDivElement>) => {
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    event.currentTarget.scrollLeft += event.deltaY;
  }
};

function FilterChips({
  id,
  items,
  active,
  onSelect,
}: {
  readonly id: string;
  readonly items: ReadonlyArray<ChipItem>;
  readonly active: string;
  readonly onSelect: (key: string) => void;
}) {
  return (
    <LayoutGroup id={id}>
      <div
        onWheel={scrollChipsWithWheel}
        className="flex items-center gap-0.5 overflow-x-auto px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const selected = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(item.key)}
              className={`relative flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-chip px-2 text-meta whitespace-nowrap outline-none transition-colors duration-100 focus-visible:shadow-focus ${
                selected ? "text-fg" : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              {selected && (
                <motion.span
                  layoutId={`${id}-active`}
                  transition={spring.layout}
                  className="pointer-events-none absolute inset-0 rounded-chip bg-white/[0.09] shadow-[inset_0_0_0_1px_rgb(255_255_255/6%)]"
                />
              )}
              {item.brand && <BrandLogo brand={item.brand} className="relative size-3 shrink-0" />}
              <span className="relative">{item.label}</span>
              {item.count !== undefined && (
                <span className="relative font-mono text-[10px] text-fg-faint">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export function ModelPicker({ providers, selection, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [harnessFilter, setHarnessFilter] = useState<string>(ALL);
  const [upstreamFilter, setUpstreamFilter] = useState<string>(ALL);
  const [toggledGroups, setToggledGroups] = useState<ReadonlySet<string>>(new Set());
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const { favorites, isFavorite, toggle } = useFavoriteModels();

  const enabledProviders = providers.filter((p) => p.enabled);
  const allEntries = buildModelEntries(enabledProviders);

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

  const { focusedProvider, focusedUpstreams, activeUpstream, favoriteEntries, sections, chips } =
    buildPickerView({
      providers: enabledProviders,
      entries: allEntries,
      favorites,
      harnessFilter,
      upstreamFilter,
      normalizedQuery,
    });

  const resetGroupToggles = () => setToggledGroups(new Set());

  const groupOpenByDefault = (group: UpstreamGroup) =>
    normalizedQuery.length > 0 ||
    activeUpstream !== ALL ||
    group.entries.some((entry) => entry.key === currentKey);

  const isGroupOpen = (group: UpstreamGroup) =>
    groupOpenByDefault(group) !== toggledGroups.has(group.key);

  const toggleGroup = (key: string) =>
    setToggledGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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

  const renderRow = (entry: ModelEntry, showUpstream: boolean) => {
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
        <span className="relative min-w-0 flex-1 truncate">{entry.displayName}</span>
        {showUpstream && entry.upstream && (
          <span className="relative shrink-0 text-meta text-fg-faint">{entry.upstream.label}</span>
        )}
        {selected && <Icon icon={Tick02Icon} className="relative size-3.5 shrink-0 text-fg" />}
      </button>
    );
  };

  const renderGroup = (group: UpstreamGroup) => {
    const groupOpen = isGroupOpen(group);
    return (
      <div key={group.key}>
        <button
          type="button"
          aria-expanded={groupOpen}
          onClick={() => toggleGroup(group.key)}
          className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-chip px-2 text-left text-meta font-medium text-fg-muted outline-none transition-colors duration-100 hover:bg-(--wash) hover:text-fg-secondary focus-visible:shadow-focus"
        >
          <Icon
            icon={ArrowRight01Icon}
            className={`size-3 shrink-0 transition-transform duration-150 ease-out ${groupOpen ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 flex-1 truncate">{group.upstream.label}</span>
          <span className="shrink-0 font-mono text-[10px] text-fg-faint">
            {group.entries.length}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {groupOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring.snappy}
              className="overflow-hidden pl-2"
            >
              {group.entries.map((entry) => renderRow(entry, false))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
          resetGroupToggles();
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
          {currentEntry?.displayName ?? selection.model}
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
              <div className="w-[300px] overflow-hidden rounded-card bg-menu shadow-menu">
                <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-2">
                  <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      resetGroupToggles();
                    }}
                    placeholder="Search models"
                    className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-muted"
                  />
                </div>

                {enabledProviders.length > 1 && (
                  <div className="border-b border-edge">
                    <FilterChips
                      id="model-picker-harness"
                      items={chips.harness}
                      active={focusedProvider ? focusedProvider.id : ALL}
                      onSelect={(key) => {
                        setHarnessFilter(key);
                        setUpstreamFilter(ALL);
                        resetGroupToggles();
                      }}
                    />
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {focusedUpstreams.length > 1 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={spring.snappy}
                      className="overflow-hidden border-b border-edge"
                    >
                      <FilterChips
                        id="model-picker-upstream"
                        items={chips.upstream}
                        active={activeUpstream}
                        onSelect={(key) => {
                          setUpstreamFilter(key);
                          resetGroupToggles();
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <LayoutGroup id="model-picker-rows">
                  <div className="max-h-80 overflow-y-auto p-1.5">
                    {favoriteEntries.length > 0 && (
                      <div className="mb-1.5">
                        <div className="px-2 pt-1 pb-1 text-meta font-medium text-fg-muted">
                          Favorites
                        </div>
                        {favoriteEntries.map((entry) => renderRow(entry, true))}
                      </div>
                    )}

                    {sections.map((section, idx) => (
                      <div
                        key={section.provider.id}
                        className={idx > 0 ? "mt-1.5 border-t border-edge pt-1.5" : ""}
                      >
                        {(!focusedProvider || section.provider.status !== "ready") && (
                          <div className="flex items-center justify-between gap-2 px-2 py-1 text-meta font-medium text-fg-muted">
                            <span className="truncate">{section.provider.name}</span>
                            {section.provider.status !== "ready" && (
                              <span className="text-[10px] font-normal text-warning">
                                {STATUS_LABEL[section.provider.status]}
                              </span>
                            )}
                          </div>
                        )}
                        {section.kind === "flat" ? (
                          section.entries.map((entry) => renderRow(entry, false))
                        ) : (
                          <>
                            {section.loose.map((entry) => renderRow(entry, false))}
                            {section.groups.map(renderGroup)}
                          </>
                        )}
                      </div>
                    ))}

                    {sections.length === 0 && favoriteEntries.length === 0 && (
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
                            {detailEntry.displayName}
                          </span>
                          <span
                            title={detailEntry.provider.status}
                            className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[detailEntry.provider.status]}`}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 text-meta text-fg-muted">
                          <span className="truncate">{detailEntry.provider.name}</span>
                          {detailEntry.upstream && (
                            <>
                              <span className="text-fg-faint">·</span>
                              <span className="truncate">{detailEntry.upstream.label}</span>
                            </>
                          )}
                          {detailEntry.provider.version && (
                            <>
                              <span className="text-fg-faint">·</span>
                              <span className="font-mono text-fg-faint">
                                v{detailEntry.provider.version}
                              </span>
                            </>
                          )}
                        </div>
                        {detailEntry.model.slug !== detailEntry.displayName && (
                          <div className="truncate font-mono text-[10px] text-fg-faint">
                            {detailEntry.model.slug}
                          </div>
                        )}
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

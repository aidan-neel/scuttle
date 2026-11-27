import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type {
  EffortLevel,
  ModelSelection,
  ProviderSnapshot,
  ProviderStatusKind,
} from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type WheelEvent, useLayoutEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { useDisabledModels } from "@/lib/disabledModels.ts";
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
import { spring } from "@/lib/motion.ts";
import { ModelDetailCard } from "./ModelDetailCard.tsx";

interface ModelPickerProps {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly selection: ModelSelection;
  readonly onChange: (next: ModelSelection) => void;
}

const MAX_LIST_HEIGHT_PX = 320;

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

function MorphingModelList({ children }: { readonly children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<{
    readonly height: number;
    readonly animate: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.min(MAX_LIST_HEIGHT_PX, Math.ceil(el.getBoundingClientRect().height));
      setState((prev) => {
        if (prev === null) return { height: next, animate: false };
        if (prev.height === next) return prev;
        return { height: next, animate: true };
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height: state ? state.height : MAX_LIST_HEIGHT_PX }}
      transition={state?.animate ? spring.snappy : { duration: 0 }}
      className="max-h-80 overflow-x-hidden overflow-y-auto"
    >
      <div ref={innerRef} className="p-1">
        {children}
      </div>
    </motion.div>
  );
}

function FilterChips({
  items,
  active,
  onSelect,
}: {
  readonly items: ReadonlyArray<ChipItem>;
  readonly active: string;
  readonly onSelect: (key: string) => void;
}) {
  return (
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
            className={`flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-chip px-2 text-meta whitespace-nowrap outline-none transition-colors duration-100 focus-visible:shadow-focus ${
              selected
                ? "bg-white/[0.09] text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/6%)]"
                : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary"
            }`}
          >
            {item.brand && <BrandLogo brand={item.brand} className="size-3 shrink-0" />}
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className="font-mono text-[11px] text-fg-faint">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
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
  const { isDisabled } = useDisabledModels();

  const enabledProviders = providers.filter(
    (p) => p.enabled && p.status === "ready" && p.models.length > 0,
  );
  const allEntries = buildModelEntries(enabledProviders).filter((entry) => !isDisabled(entry.key));

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
        className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-chip px-2 text-left text-label outline-none transition-colors duration-100 ${
          inspected
            ? "bg-white/[0.08] text-fg"
            : "text-fg-secondary hover:bg-(--wash) hover:text-fg"
        }`}
      >
        <BrandLogo brand={entry.provider.kind} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
        {showUpstream && entry.upstream && (
          <span className="shrink-0 text-meta text-fg-faint">{entry.upstream.label}</span>
        )}
        {selected && <Icon icon={Tick02Icon} className="size-3.5 shrink-0 text-fg" />}
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
          <span className="shrink-0 font-mono text-[11px] text-fg-faint">
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
              <div className="w-[308px] overflow-hidden rounded-card bg-menu shadow-menu">
                <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-2">
                  <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setInspectedKey(null);
                      resetGroupToggles();
                    }}
                    placeholder="Search models"
                    className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-muted"
                  />
                </div>

                {enabledProviders.length > 1 && (
                  <div className="border-b border-edge">
                    <FilterChips
                      items={chips.harness}
                      active={focusedProvider ? focusedProvider.id : ALL}
                      onSelect={(key) => {
                        setHarnessFilter(key);
                        setUpstreamFilter(ALL);
                        setInspectedKey(null);
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
                        items={chips.upstream}
                        active={activeUpstream}
                        onSelect={(key) => {
                          setUpstreamFilter(key);
                          setInspectedKey(null);
                          resetGroupToggles();
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <MorphingModelList>
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
                            <span className="text-[11px] font-normal text-warning">
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
                </MorphingModelList>
              </div>

              {detailEntry && (
                <ModelDetailCard
                  entry={detailEntry}
                  effort={detailEffort}
                  favorited={isFavorite(detailEntry.key)}
                  onEffortChange={(effort) => selectEntry(detailEntry, effort, false)}
                  onToggleFavorite={() => toggle(detailEntry.key)}
                />
              )}
            </motion.div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

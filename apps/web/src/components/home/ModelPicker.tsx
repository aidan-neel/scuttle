import { Popover } from "@base-ui/react/popover";
import {
  ArrowRight01Icon,
  PlugSocketIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type {
  EffortLevel,
  ModelSelection,
  ProviderKind,
  ProviderSnapshot,
  ProviderStatusKind,
} from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { PillChevron, pillTriggerClass } from "@/components/ui/Picker.tsx";
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
import { remToPx } from "@/lib/uiScale.ts";
import { cn } from "@/lib/utils";
import { ModelDetailCard } from "./ModelDetailCard.tsx";

interface ModelPickerProps {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly selection: ModelSelection | null;
  readonly onChange: (next: ModelSelection) => void;
  readonly align?: "start" | "end";
  readonly side?: "top" | "bottom";
  readonly placeholder?: string;
  readonly variant?: "ghost" | "field";
}

const MAX_LIST_HEIGHT_REM = 20;

const STATUS_LABEL: Record<ProviderStatusKind, string> = {
  ready: "Ready",
  unauthenticated: "Sign in",
  unavailable: "Unavailable",
  probing: "Checking",
  disabled: "Disabled",
};

function ProviderMark({
  kind,
  className,
}: {
  readonly kind: ProviderKind;
  readonly className?: string;
}) {
  return kind === "acp-registry" ? (
    <Icon icon={PlugSocketIcon} className={cn("shrink-0 text-fg-secondary", className)} />
  ) : (
    <BrandLogo brand={kind} {...(className !== undefined ? { className } : {})} />
  );
}

function MorphingModelList({ children }: { readonly children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<{ readonly height: number; readonly animate: boolean } | null>(
    null,
  );

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.min(
        Math.round(remToPx(MAX_LIST_HEIGHT_REM)),
        Math.ceil(el.getBoundingClientRect().height),
      );
      setState((prev) =>
        prev === null
          ? { height: next, animate: false }
          : prev.height === next
            ? prev
            : { height: next, animate: true },
      );
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
      animate={{ height: state ? state.height : Math.round(remToPx(MAX_LIST_HEIGHT_REM)) }}
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
  const pillId = useId();
  return (
    <div
      onWheel={(event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.currentTarget.scrollLeft += event.deltaY;
        }
      }}
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
            className={`relative flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-chip px-2 text-meta whitespace-nowrap outline-none transition-colors duration-100 active:scale-[0.98] focus-visible:shadow-focus ${
              selected ? "text-fg" : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary"
            }`}
          >
            {selected && (
              <motion.span
                layoutId={`${pillId}-chip`}
                transition={spring.snappy}
                aria-hidden
                className="absolute inset-0 rounded-chip bg-fg/[0.09] shadow-[inset_0_0_0_1px_var(--color-edge)]"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1">
              {item.brand && <ProviderMark kind={item.brand} className="size-3 shrink-0" />}
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span className="font-mono text-[0.6875rem] text-fg-faint">{item.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ModelPicker({
  providers,
  selection,
  onChange,
  align = "end",
  side = "top",
  placeholder = "Session default",
  variant = "ghost",
}: ModelPickerProps) {
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
  const multiAccountKinds = new Set<ProviderKind>(
    providers
      .filter((p, idx) => providers.findIndex((o) => o.kind === p.kind) !== idx)
      .map((p) => p.kind),
  );
  const allEntries = buildModelEntries(enabledProviders).filter((entry) => !isDisabled(entry.key));
  const currentKey = selection ? modelFavoriteKey(selection.providerId, selection.model) : "";
  const currentEntry = selection ? (allEntries.find((e) => e.key === currentKey) ?? null) : null;
  const currentProvider = selection
    ? (providers.find((p) => p.id === selection.providerId) ?? null)
    : null;
  const showTriggerAccount =
    selection !== null &&
    currentProvider !== null &&
    (multiAccountKinds.has(selection.providerKind) || selection.providerKind === "acp-registry");
  const activeEfforts = currentEntry?.model.efforts ?? [];
  const activeEffort =
    selection?.effort && activeEfforts.includes(selection.effort)
      ? selection.effort
      : (currentEntry?.model.defaultEffort ?? activeEfforts[0]);

  const detailEntry =
    (inspectedKey ? allEntries.find((entry) => entry.key === inspectedKey) : undefined) ??
    currentEntry ??
    allEntries[0] ??
    null;

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

  const resetFilterState = () => {
    setInspectedKey(null);
    setToggledGroups(new Set());
  };

  const groupOpenByDefault = (group: UpstreamGroup) =>
    normalizedQuery.length > 0 ||
    activeUpstream !== ALL ||
    group.entries.some((e) => e.key === currentKey);

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
      (selection?.effort && entry.model.efforts.includes(selection.effort)
        ? selection.effort
        : (entry.model.defaultEffort ?? entry.model.efforts[0]));
    onChange({
      providerId: entry.provider.id,
      providerKind: entry.provider.kind,
      model: entry.model.slug,
      ...(nextEffort ? { effort: nextEffort } : {}),
    });
    setInspectedKey(entry.key);
    if (closeAfter) setOpen(false);
  };

  const detailEffort =
    detailEntry && detailEntry.key === currentKey && activeEffort
      ? activeEffort
      : (detailEntry?.model.defaultEffort ?? detailEntry?.model.efforts[0]);

  const renderRow = (entry: ModelEntry, showUpstream: boolean, showAccount = false) => {
    const selected = entry.key === currentKey;
    const inspected = detailEntry?.key === entry.key;
    const displayAccount = showAccount && multiAccountKinds.has(entry.provider.kind);
    return (
      <button
        key={entry.key}
        type="button"
        onMouseEnter={() => setInspectedKey(entry.key)}
        onFocus={() => setInspectedKey(entry.key)}
        onClick={() => selectEntry(entry, undefined, entry.model.efforts.length === 0)}
        className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-chip px-2 text-left text-label outline-none transition-colors duration-100 ${
          inspected ? "bg-fg/[0.08] text-fg" : "text-fg-secondary hover:bg-(--wash) hover:text-fg"
        }`}
      >
        <ProviderMark kind={entry.provider.kind} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
        {displayAccount && (
          <span className="max-w-24 shrink-0 truncate rounded-chip bg-fg/[0.06] px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
            {entry.provider.name}
          </span>
        )}
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
          <span className="shrink-0 font-mono text-[0.6875rem] text-fg-faint">
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
          resetFilterState();
        }
      }}
    >
      <Popover.Trigger
        className={pillTriggerClass(cn("max-w-full", variant === "ghost" && "gap-1.5"), variant)}
      >
        {selection ? (
          <>
            <ProviderMark
              kind={selection.providerKind}
              className={cn("shrink-0", variant === "field" ? "size-3.5" : "size-3")}
            />
            <span
              className={cn(
                "truncate whitespace-nowrap",
                variant === "ghost" &&
                  "font-medium text-fg-secondary transition-colors duration-(--dur-hover) group-hover/pill:text-fg group-data-popup-open/pill:text-fg",
              )}
            >
              {currentEntry?.displayName ?? selection.model}
            </span>
            {showTriggerAccount && currentProvider && (
              <span className="max-w-28 shrink-0 truncate text-meta text-fg-muted">
                · {currentProvider.name}
              </span>
            )}
            {activeEffort && (
              <span className="shrink-0 whitespace-nowrap text-fg-muted">
                {EFFORT_LABELS[activeEffort]}
              </span>
            )}
          </>
        ) : (
          <span className="truncate whitespace-nowrap text-fg-muted transition-colors duration-(--dur-hover) group-hover/pill:text-fg">
            {placeholder}
          </span>
        )}
        <PillChevron />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner side={side} align={align} sideOffset={8} className="z-50 outline-none">
          <Popover.Popup className="outline-none">
            <motion.div
              initial={{ opacity: 0, y: side === "bottom" ? -6 : 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring.snappy}
              className={cn(
                "flex gap-2",
                side === "bottom" ? "items-start" : "items-end",
                align === "end" && "flex-row-reverse",
              )}
            >
              <div className="w-[19.25rem] overflow-hidden rounded-card bg-menu shadow-menu">
                <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-2">
                  <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      resetFilterState();
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
                        resetFilterState();
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
                          resetFilterState();
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
                      {favoriteEntries.map((entry) => renderRow(entry, true, true))}
                    </div>
                  )}
                  {sections.map((section, idx) => (
                    <div
                      key={section.provider.id}
                      className={idx > 0 ? "mt-1.5 border-t border-edge pt-1.5" : ""}
                    >
                      {(!focusedProvider ||
                        section.provider.status !== "ready" ||
                        multiAccountKinds.has(section.provider.kind)) && (
                        <div className="flex items-center justify-between gap-2 px-2 py-1 text-meta font-medium text-fg-muted">
                          <span className="truncate">{section.provider.name}</span>
                          {section.provider.status !== "ready" && (
                            <span className="text-[0.6875rem] font-normal text-warning">
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

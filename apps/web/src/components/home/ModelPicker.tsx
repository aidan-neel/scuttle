import { Menu } from "@base-ui/react/menu";
import { ArrowDown01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import type { EffortLevel, ModelSelection, ProviderSnapshot } from "@scuttle/contracts";
import { Fragment, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { MenuGroupLabel, MenuPopup, MenuRadioItem, MenuSeparator } from "@/components/ui/Menu.tsx";
import { MorphWidth } from "@/components/ui/MorphWidth.tsx";
import { SwapText } from "@/components/ui/SwapText.tsx";
import { EFFORT_LABELS } from "@/lib/format.ts";

interface ModelPickerProps {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly selection: ModelSelection;
  readonly onChange: (next: ModelSelection) => void;
}

const makeModelKey = (providerId: string, slug: string) => `${providerId}::${slug}`;
const UNFILTERED_MODEL_CAP = 12;

export function ModelPicker({ providers, selection, onChange }: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const enabledProviders = providers.filter((p) => p.enabled);
  const currentProvider =
    providers.find((p) => p.id === selection.providerId) ?? enabledProviders[0];
  const currentModel =
    currentProvider?.models.find((m) => m.slug === selection.model) ?? currentProvider?.models[0];
  const efforts = currentModel?.efforts ?? [];
  const activeEffort =
    selection.effort && efforts.includes(selection.effort)
      ? selection.effort
      : (currentModel?.defaultEffort ?? efforts[0]);

  const currentKey = makeModelKey(selection.providerId, selection.model);
  const totalModels = enabledProviders.reduce((sum, p) => sum + p.models.length, 0);
  const normalizedQuery = query.trim().toLowerCase();

  const selectModelKey = (key: unknown) => {
    if (typeof key !== "string") return;
    const sep = key.indexOf("::");
    if (sep < 0) return;
    const providerId = key.slice(0, sep);
    const slug = key.slice(sep + 2);
    const provider = providers.find((p) => p.id === providerId);
    const model = provider?.models.find((m) => m.slug === slug);
    if (!provider || !model) return;
    const effort =
      selection.effort && model.efforts.includes(selection.effort)
        ? selection.effort
        : (model.defaultEffort ?? model.efforts[0]);
    onChange({
      providerId: provider.id,
      providerKind: provider.kind,
      model: model.slug,
      ...(effort ? { effort } : {}),
    });
  };

  const selectEffort = (value: unknown) => {
    if (typeof value !== "string") return;
    const picked = efforts.find((e): e is EffortLevel => e === value);
    if (!picked) return;
    onChange({ ...selection, effort: picked });
  };

  const providerSections = enabledProviders
    .map((provider) => {
      const matched = normalizedQuery
        ? provider.models.filter(
            (m) =>
              m.name.toLowerCase().includes(normalizedQuery) ||
              m.slug.toLowerCase().includes(normalizedQuery) ||
              provider.name.toLowerCase().includes(normalizedQuery),
          )
        : provider.models;
      const visible = normalizedQuery
        ? matched.slice(0, 30)
        : matched.slice(0, UNFILTERED_MODEL_CAP);
      if (
        !normalizedQuery &&
        provider.id === selection.providerId &&
        currentModel &&
        !visible.some((m) => m.slug === currentModel.slug)
      ) {
        visible.unshift(currentModel);
      }
      return {
        provider,
        visible,
        hiddenCount: Math.max(0, matched.length - visible.length),
      };
    })
    .filter((section) => section.visible.length > 0);

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <Menu.Trigger
        className={buttonClass("quiet", "md", "group/picker data-popup-open:bg-(--wash)")}
      >
        <BrandLogo brand={selection.providerKind} className="size-3.5" />
        <span className="sr-only">Model: </span>
        <MorphWidth>
          <SwapText swapKey={currentKey} className="font-medium">
            {currentModel?.name ?? selection.model}
          </SwapText>
          {activeEffort && (
            <SwapText swapKey={activeEffort} className="ml-1.5 text-fg-muted">
              {EFFORT_LABELS[activeEffort]}
            </SwapText>
          )}
        </MorphWidth>
        <Icon
          icon={ArrowDown01Icon}
          className="size-3 text-fg-muted transition-transform duration-200 ease-out-quint group-data-popup-open/picker:rotate-180"
        />
      </Menu.Trigger>
      <MenuPopup label="Model" className="min-w-68 p-0">
        {totalModels > 15 && (
          <div className="flex items-center gap-2 border-b border-edge px-2.5 py-2">
            <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={`Filter ${totalModels} models…`}
              className="w-full bg-transparent text-label text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
        )}
        <div className="max-h-80 overflow-y-auto p-1">
          <Menu.RadioGroup value={currentKey} onValueChange={selectModelKey}>
            {providerSections.map(({ provider, visible, hiddenCount }, idx) => (
              <Fragment key={provider.id}>
                {idx > 0 && <MenuSeparator />}
                <Menu.Group>
                  <MenuGroupLabel>
                    <span className="flex items-center justify-between gap-2">
                      <span>{provider.name}</span>
                      {provider.status !== "ready" && (
                        <span className="text-[10px] font-normal text-warning">
                          {provider.status === "probing"
                            ? "Checking"
                            : provider.status === "unauthenticated"
                              ? "Sign in"
                              : "Unavailable"}
                        </span>
                      )}
                    </span>
                  </MenuGroupLabel>
                  {visible.map((model) => (
                    <MenuRadioItem
                      key={makeModelKey(provider.id, model.slug)}
                      value={makeModelKey(provider.id, model.slug)}
                    >
                      <BrandLogo brand={provider.kind} className="size-3.5" />
                      <span className="truncate">{model.name}</span>
                    </MenuRadioItem>
                  ))}
                  {hiddenCount > 0 && (
                    <div className="px-2 py-1 text-meta text-fg-faint">
                      +{hiddenCount} more — type to filter
                    </div>
                  )}
                </Menu.Group>
              </Fragment>
            ))}
            {providerSections.length === 0 && (
              <div className="px-2 py-4 text-center text-label text-fg-muted">
                No matching models.
              </div>
            )}
          </Menu.RadioGroup>
          {efforts.length > 0 && activeEffort && (
            <>
              <MenuSeparator />
              <Menu.Group>
                <MenuGroupLabel>Effort</MenuGroupLabel>
                <Menu.RadioGroup value={activeEffort} onValueChange={selectEffort}>
                  {efforts.map((effort) => (
                    <MenuRadioItem key={effort} value={effort}>
                      {EFFORT_LABELS[effort]}
                    </MenuRadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Group>
            </>
          )}
        </div>
      </MenuPopup>
    </Menu.Root>
  );
}

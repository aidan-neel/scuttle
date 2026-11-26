import {
  AiBrain01Icon,
  ArrowShrinkIcon,
  CpuIcon,
  Idea01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import type {
  EffortLevel,
  InteractionMode,
  ModelSelection,
  ProviderSnapshot,
} from "@scuttle/contracts";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { useDisabledModels } from "@/lib/disabledModels.ts";
import { EFFORT_LABELS } from "@/lib/format.ts";
import { modelFavoriteKey } from "@/lib/modelFavorites.ts";
import { buildModelEntries, entryMatches, type ModelEntry } from "@/lib/modelGrouping.ts";
import type { PaletteContent, PaletteItem } from "./ComposerPalette.tsx";

export type SlashView =
  | { readonly kind: "root" }
  | { readonly kind: "model" }
  | { readonly kind: "reasoning" };

export interface SlashOptions {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly modelSelection: ModelSelection;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
  readonly interactionMode: InteractionMode | undefined;
  readonly onInteractionModeChange: ((mode: InteractionMode) => void) | undefined;
  readonly onCompact: (() => void) | undefined;
  readonly onNewThread: () => void;
}

interface SlashContentOptions extends SlashOptions {
  readonly view: SlashView;
  readonly query: string;
  readonly drill: (view: SlashView) => void;
  readonly run: (action: () => void) => void;
}

interface SlashCommand extends PaletteItem {
  readonly command?: string;
}

const effortFor = (entry: ModelEntry, current: EffortLevel | undefined) =>
  current && entry.model.efforts.includes(current)
    ? current
    : (entry.model.defaultEffort ?? entry.model.efforts[0]);

export function useSlashContent({
  providers,
  modelSelection,
  onModelSelectionChange,
  interactionMode,
  onInteractionModeChange,
  onCompact,
  onNewThread,
  view,
  query,
  drill,
  run,
}: SlashContentOptions): PaletteContent {
  const { isDisabled } = useDisabledModels();
  const entries = buildModelEntries(
    providers.filter((p) => p.enabled && p.status === "ready" && p.models.length > 0),
  ).filter((entry) => !isDisabled(entry.key));
  const currentKey = modelFavoriteKey(modelSelection.providerId, modelSelection.model);
  const currentEntry = entries.find((entry) => entry.key === currentKey);
  const efforts = currentEntry?.model.efforts ?? [];
  const currentEffort = currentEntry ? effortFor(currentEntry, modelSelection.effort) : undefined;
  const normalizedQuery = query.toLowerCase();
  const back = () => drill({ kind: "root" });

  const selectModel = (entry: ModelEntry) => {
    const effort = effortFor(entry, modelSelection.effort);
    onModelSelectionChange({
      providerId: entry.provider.id,
      providerKind: entry.provider.kind,
      model: entry.model.slug,
      ...(effort ? { effort } : {}),
    });
  };

  switch (view.kind) {
    case "root": {
      const planOn = interactionMode === "plan";
      const commands: ReadonlyArray<SlashCommand> = [
        ...(onInteractionModeChange
          ? [
              {
                id: "plan",
                label: "Plan mode",
                command: "/plan",
                hint: "/plan",
                icon: Idea01Icon,
                ...(planOn ? { badge: "On" } : {}),
                onSelect: () => run(() => onInteractionModeChange(planOn ? "default" : "plan")),
              },
            ]
          : []),
        ...(entries.length > 0
          ? [
              {
                id: "model",
                label: "Model",
                icon: CpuIcon,
                ...(currentEntry ? { hint: currentEntry.displayName } : {}),
                drill: true,
                onSelect: () => drill({ kind: "model" }),
              },
            ]
          : []),
        ...(efforts.length > 0
          ? [
              {
                id: "reasoning",
                label: "Reasoning",
                icon: AiBrain01Icon,
                ...(currentEffort ? { hint: EFFORT_LABELS[currentEffort] } : {}),
                drill: true,
                onSelect: () => drill({ kind: "reasoning" }),
              },
            ]
          : []),
        {
          id: "new",
          label: "New thread",
          command: "/new",
          hint: "/new",
          icon: PencilEdit02Icon,
          onSelect: () => run(onNewThread),
        },
        ...(onCompact
          ? [
              {
                id: "compact",
                label: "Compact",
                command: "/compact",
                hint: "/compact",
                icon: ArrowShrinkIcon,
                onSelect: () => run(onCompact),
              },
            ]
          : []),
      ];
      return {
        label: "Commands",
        sections: [
          {
            items: commands.filter(
              (item) =>
                item.label.toLowerCase().includes(normalizedQuery) ||
                (item.command?.slice(1).startsWith(normalizedQuery) ?? false),
            ),
          },
        ],
        emptyText: "No matching commands",
      };
    }
    case "model":
      return {
        label: "Model",
        title: "Model",
        onBack: back,
        sections: [
          {
            items: entries
              .filter((entry) => entryMatches(entry, normalizedQuery))
              .map((entry) => ({
                id: `model:${entry.key}`,
                label: entry.displayName,
                leading: <BrandLogo brand={entry.provider.kind} className="size-3.5 shrink-0" />,
                hint: entry.provider.name,
                ...(entry.key === currentKey ? { badge: "Current" } : {}),
                onSelect: () => run(() => selectModel(entry)),
              })),
          },
        ],
        emptyText: "No matching models",
      };
    case "reasoning":
      return {
        label: "Reasoning",
        title: currentEntry ? `Reasoning · ${currentEntry.displayName}` : "Reasoning",
        onBack: back,
        sections: [
          {
            items: efforts
              .filter((effort) => EFFORT_LABELS[effort].toLowerCase().includes(normalizedQuery))
              .map((effort) => ({
                id: `effort:${effort}`,
                label: EFFORT_LABELS[effort],
                icon: AiBrain01Icon,
                ...(effort === currentEffort ? { badge: "Current" } : {}),
                onSelect: () => run(() => onModelSelectionChange({ ...modelSelection, effort })),
              })),
          },
        ],
        emptyText: "No matching levels",
      };
  }
}

import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import type { ModelSelection, ModelTierSource, ProviderSnapshot } from "@scuttle/contracts";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { SettingsGroup } from "./primitives.tsx";

export type PanelScopeKind = "global" | "project" | "agent";

const pickNextSeat = (
  providers: ReadonlyArray<ProviderSnapshot>,
  existing: ReadonlyArray<ModelSelection>,
  fallback: ModelSelection,
): ModelSelection => {
  const usedKinds = new Set(existing.map((s) => s.providerKind));
  const ready = providers.filter((p) => p.enabled && p.status === "ready" && p.models.length > 0);
  const candidate = ready.find((p) => !usedKinds.has(p.kind)) ?? ready[0];
  const model =
    candidate?.models.find((m) => m.slug === candidate.defaultModel) ??
    candidate?.models.find((m) => m.isDefault) ??
    candidate?.models[0];
  if (!candidate || !model) return fallback;
  const effort = model.defaultEffort ?? model.efforts[0];
  return {
    providerId: candidate.id,
    providerKind: candidate.kind,
    model: model.slug,
    ...(effort ? { effort } : {}),
  };
};

const inheritedBadge = (
  source: ModelTierSource,
  scopeKind: PanelScopeKind,
  projectName?: string,
): string | null => {
  if (source === scopeKind || source === "inherit") return null;
  if (source === "global") return "Global";
  if (source === "project") return projectName ?? "Project";
  return "Agent";
};

function SeatGroupRow({
  title,
  description,
  seats,
  source,
  scopeKind,
  projectName,
  overridden,
  providers,
  fallbackSelection,
  onChange,
  onReset,
}: {
  readonly title: string;
  readonly description: string;
  readonly seats: ReadonlyArray<ModelSelection>;
  readonly source: ModelTierSource;
  readonly scopeKind: PanelScopeKind;
  readonly projectName: string | undefined;
  readonly overridden: boolean;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly fallbackSelection: ModelSelection;
  readonly onChange: (next: ReadonlyArray<ModelSelection>) => void;
  readonly onReset: () => void;
}) {
  const badge = inheritedBadge(source, scopeKind, projectName);
  const distinctProviders = new Set(seats.map((seat) => seat.providerKind)).size;
  const hasDuplicateVendor = seats.length > 1 && distinctProviders < seats.length;

  return (
    <div className="space-y-2.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-fg">{title}</span>
            {badge !== null && seats.length > 0 && (
              <span className="rounded-chip bg-fg/6 px-1.5 py-0.5 text-meta text-fg-muted">
                {badge}
              </span>
            )}
            {hasDuplicateVendor && (
              <span className="text-meta text-warning">Use different providers</span>
            )}
          </div>
          <p className="mt-0.5 text-label text-fg-muted">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {overridden && (
            <Button variant="ghost" size="sm" onClick={onReset} className="text-meta text-fg-muted">
              {scopeKind === "global" ? "Clear" : "Reset"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([...seats, pickNextSeat(providers, seats, fallbackSelection)])}
          >
            <Icon icon={Add01Icon} />
            Add seat
          </Button>
        </div>
      </div>

      {seats.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {seats.map((seat, idx) => (
            <div
              key={`${seat.providerId}-${seat.model}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-row bg-fg/[0.03] py-1 pr-1.5 pl-1.5 shadow-[inset_0_0_0_1px_var(--color-edge)]"
            >
              <ModelPicker
                providers={providers}
                selection={seat}
                align="start"
                onChange={(next) => {
                  const copy = [...seats];
                  copy[idx] = next;
                  onChange(copy);
                }}
              />
              <button
                type="button"
                aria-label={`Remove seat ${idx + 1} from ${title}`}
                onClick={() => onChange(seats.filter((_, i) => i !== idx))}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-chip text-fg-faint outline-none transition-colors hover:bg-(--wash) hover:text-fg focus-visible:shadow-focus"
              >
                <Icon icon={Cancel01Icon} className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ReviewPanelsGroupProps {
  readonly scopeKind: PanelScopeKind;
  readonly projectName: string | undefined;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly fallbackSelection: ModelSelection;
  readonly panelSeats: ReadonlyArray<ModelSelection>;
  readonly panelSource: ModelTierSource;
  readonly panelOverridden: boolean;
  readonly onPanelChange: (next: ReadonlyArray<ModelSelection>) => void;
  readonly onPanelReset: () => void;
  readonly councilSeats: ReadonlyArray<ModelSelection>;
  readonly councilSource: ModelTierSource;
  readonly councilOverridden: boolean;
  readonly onCouncilChange: (next: ReadonlyArray<ModelSelection>) => void;
  readonly onCouncilReset: () => void;
}

export function ReviewPanelsGroup({
  scopeKind,
  projectName,
  providers,
  fallbackSelection,
  panelSeats,
  panelSource,
  panelOverridden,
  onPanelChange,
  onPanelReset,
  councilSeats,
  councilSource,
  councilOverridden,
  onCouncilChange,
  onCouncilReset,
}: ReviewPanelsGroupProps) {
  return (
    <SettingsGroup title="Review panels">
      <SeatGroupRow
        title="Panel"
        description="Two models from different providers for reviews."
        seats={panelSeats}
        source={panelSource}
        scopeKind={scopeKind}
        projectName={projectName}
        overridden={panelOverridden}
        providers={providers}
        fallbackSelection={fallbackSelection}
        onChange={onPanelChange}
        onReset={onPanelReset}
      />
      <SeatGroupRow
        title="Council"
        description="Three models from different providers for /scuttle:council."
        seats={councilSeats}
        source={councilSource}
        scopeKind={scopeKind}
        projectName={projectName}
        overridden={councilOverridden}
        providers={providers}
        fallbackSelection={fallbackSelection}
        onChange={onCouncilChange}
        onReset={onCouncilReset}
      />
    </SettingsGroup>
  );
}

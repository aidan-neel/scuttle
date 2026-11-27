import { Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  MODEL_TIER_SIZES,
  type ModelTierConfig,
  type ModelTierScope,
  type ModelTierSize,
  type ModelTierSource,
  REASONING_BUDGETS,
  type ReasoningBudget,
  resolveEffectiveModelTiers,
} from "@scuttle/contracts";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { Picker } from "@/components/ui/Picker.tsx";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SettingsGroup } from "./primitives.tsx";
import { ReviewPanelsGroup } from "./ReviewPanelsGroup.tsx";

export type StackScopeKind = "global" | "project" | "agent";

interface ModelStackSectionProps {
  readonly initialScope?: StackScopeKind | undefined;
  readonly initialProjectId?: string | undefined;
  readonly initialAgentId?: string | undefined;
}

const SIZE_INFO: Record<ModelTierSize, { readonly label: string; readonly description: string }> = {
  nano: { label: "Nano", description: "Fast lookups and quick checks" },
  small: { label: "Small", description: "Routine edits and test runs" },
  medium: { label: "Medium", description: "Everyday coding tasks" },
  large: { label: "Large", description: "Multi-file work and debugging" },
  xlarge: { label: "Extra Large", description: "Hard architecture and deep fixes" },
  max: { label: "Max", description: "Heaviest reasoning" },
  design: { label: "Design", description: "UI and visual design" },
};

const BUDGET_LABEL: Record<ReasoningBudget, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  unlimited: "Unlimited",
};

const sourceLabel = (
  source: ModelTierSource,
  currentScope: StackScopeKind,
  projectName?: string,
): string | null => {
  if (source === currentScope || source === "inherit") return null;
  if (source === "global") return "Global";
  if (source === "project") return projectName ?? "Project";
  return "Agent";
};

export function ModelStackSection({
  initialScope = "global",
  initialProjectId,
  initialAgentId,
}: ModelStackSectionProps) {
  const { providers, projects, agents, modelTiers, defaultModelSelection, updateModelTiers } =
    useWorkspace();
  const pillId = useId();

  const [scopeKind, setScopeKind] = useState<StackScopeKind>(initialScope);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjectId ?? projects[0]?.id ?? "",
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    initialAgentId ?? agents[0]?.id ?? "",
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;
  const activeAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null;

  const activeScope: ModelTierScope | null =
    scopeKind === "global"
      ? { kind: "global" }
      : scopeKind === "project"
        ? activeProject
          ? { kind: "project", projectId: activeProject.id }
          : null
        : activeAgent
          ? { kind: "agent", agentId: activeAgent.id }
          : null;

  const currentLayer: ModelTierConfig =
    activeScope === null
      ? {}
      : activeScope.kind === "global"
        ? modelTiers.global
        : activeScope.kind === "project"
          ? (modelTiers.projects[activeScope.projectId] ?? {})
          : (modelTiers.agents[activeScope.agentId] ?? {});

  const resolved = resolveEffectiveModelTiers(
    modelTiers,
    activeScope?.kind === "project"
      ? { projectId: activeScope.projectId }
      : activeScope?.kind === "agent" && activeAgent
        ? { projectId: activeAgent.projectId, agentId: activeAgent.id }
        : undefined,
  );

  const effectiveProjectName =
    activeScope?.kind === "agent"
      ? activeAgent?.projectName
      : activeScope?.kind === "project"
        ? activeProject?.name
        : undefined;

  const hasAnyOverrides = Object.keys(currentLayer).length > 0;
  const budgetSource = sourceLabel(resolved.budget.source, scopeKind, effectiveProjectName);

  const persist = (nextConfig: ModelTierConfig) => {
    if (activeScope === null) return;
    setSaveError(null);
    void updateModelTiers(activeScope, nextConfig).catch((error: unknown) => {
      setSaveError(error instanceof Error ? error.message : "Could not save model stack.");
    });
  };

  const patchLayer = <K extends keyof ModelTierConfig>(
    key: K,
    value: ModelTierConfig[K] | undefined,
  ) => {
    const next: Record<string, unknown> = { ...currentLayer };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    persist(next as ModelTierConfig);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Configuration scope" className="flex items-center gap-1">
          {(["global", "project", "agent"] as const).map((kind) => {
            const active = scopeKind === kind;
            const label = kind === "global" ? "Global" : kind === "project" ? "Project" : "Agent";
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                onClick={() => setScopeKind(kind)}
                className={cn(
                  "relative inline-flex h-8 cursor-pointer items-center rounded-control px-3 text-label outline-none transition-colors duration-(--dur-hover) ease-hover active:scale-[0.98] focus-visible:shadow-focus",
                  active ? "text-fg" : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
                )}
              >
                {active && (
                  <motion.span
                    layoutId={`${pillId}-scope`}
                    transition={spring.snappy}
                    aria-hidden
                    className="absolute inset-0 rounded-control bg-panel shadow-raised"
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>

        {scopeKind === "project" && activeProject && (
          <Picker
            label="Project scope"
            value={activeProject.id}
            options={projects.map((p) => ({
              value: p.id,
              label: p.name,
              icon: <Identicon name={p.name} size="sm" className="size-3" />,
            }))}
            onValueChange={setSelectedProjectId}
          />
        )}

        {scopeKind === "agent" && activeAgent && (
          <Picker
            label="Agent scope"
            value={activeAgent.id}
            options={agents.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.projectName})`,
              icon: (
                <Identicon name={a.name} style={a.identiconStyle} size="sm" className="size-3" />
              ),
            }))}
            onValueChange={setSelectedAgentId}
          />
        )}

        <span className="flex-1" />

        {hasAnyOverrides && activeScope && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => persist({})}
            className="text-meta text-fg-muted"
          >
            {scopeKind === "global" ? "Clear all" : "Reset overrides"}
          </Button>
        )}
      </div>

      {saveError && (
        <div className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-label text-danger">
          {saveError}
        </div>
      )}

      {activeScope === null ? (
        <div className="rounded-card bg-panel px-4 py-5 text-label text-fg-muted shadow-raised">
          {scopeKind === "project"
            ? "Add a project first to set per-project models."
            : "Create an agent first to set per-agent models."}
        </div>
      ) : (
        <>
          <p className="px-0.5 text-label text-fg-muted">
            {scopeKind === "global"
              ? "Defaults for skills and delegated runs. Blank slots use the active thread model."
              : scopeKind === "project" && activeProject
                ? `Overrides Global for ${activeProject.name}.`
                : activeAgent
                  ? `Overrides Global and ${activeAgent.projectName} for ${activeAgent.name}.`
                  : null}
          </p>

          <SettingsGroup title="Reasoning">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-body text-fg">Effort budget</span>
                  {budgetSource !== null && resolved.budget.value !== undefined && (
                    <span className="rounded-chip bg-fg/6 px-1.5 py-0.5 text-meta text-fg-muted">
                      {budgetSource}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-label text-fg-muted">
                  Default thinking budget for skills.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {scopeKind !== "global" && currentLayer.budget !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patchLayer("budget", undefined)}
                    className="text-meta text-fg-muted"
                  >
                    Inherit
                  </Button>
                )}
                <div
                  role="group"
                  aria-label="Effort budget"
                  className="inline-flex rounded-control bg-chrome/70 p-0.5 shadow-[inset_0_0_0_1px_var(--color-edge)]"
                >
                  {REASONING_BUDGETS.map((budget) => {
                    const selected = resolved.budget.value === budget;
                    const explicit = currentLayer.budget === budget;
                    return (
                      <button
                        key={budget}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => patchLayer("budget", explicit ? undefined : budget)}
                        className={cn(
                          "relative h-6 cursor-pointer rounded-[5px] px-2 text-meta outline-none transition-colors duration-(--dur-hover) active:scale-[0.98] focus-visible:shadow-focus",
                          selected
                            ? explicit
                              ? "font-medium text-fg"
                              : "text-fg-secondary"
                            : "text-fg-muted hover:text-fg",
                        )}
                      >
                        {selected && (
                          <motion.span
                            layoutId={`${pillId}-budget`}
                            transition={spring.snappy}
                            aria-hidden
                            className={cn(
                              "absolute inset-0 rounded-[5px]",
                              explicit ? "bg-fg/12" : "bg-fg/7",
                            )}
                          />
                        )}
                        <span className="relative z-10">{BUDGET_LABEL[budget]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </SettingsGroup>

          <SettingsGroup title="Model sizes">
            {MODEL_TIER_SIZES.map((size) => {
              const info = SIZE_INFO[size];
              const slot = resolved.sizes[size];
              const isExplicit = currentLayer[size] !== undefined;
              const inheritedTag = sourceLabel(slot.source, scopeKind, effectiveProjectName);
              return (
                <div
                  key={size}
                  className="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex items-center gap-2">
                      <span className="text-body text-fg">{info.label}</span>
                      {inheritedTag !== null && slot.value !== undefined && (
                        <span className="rounded-chip bg-fg/6 px-1.5 py-0.5 text-meta text-fg-muted">
                          {inheritedTag}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-label text-fg-muted">{info.description}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ModelPicker
                      providers={providers}
                      selection={slot.value ?? null}
                      placeholder={scopeKind === "global" ? "Thread model" : "Inherit"}
                      align="end"
                      onChange={(next) => patchLayer(size, next)}
                    />
                    {isExplicit && (
                      <button
                        type="button"
                        aria-label={`Reset ${size}`}
                        title={
                          scopeKind === "global" ? `Clear ${size}` : `Reset ${size} to inherited`
                        }
                        onClick={() => patchLayer(size, undefined)}
                        className="flex size-6 cursor-pointer items-center justify-center rounded-chip text-fg-faint outline-none transition-colors hover:bg-(--wash) hover:text-fg focus-visible:shadow-focus"
                      >
                        <Icon icon={Cancel01Icon} className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </SettingsGroup>

          <ReviewPanelsGroup
            key={`${scopeKind}-${activeProject?.id ?? ""}-${activeAgent?.id ?? ""}`}
            scopeKind={scopeKind}
            projectName={effectiveProjectName}
            providers={providers}
            fallbackSelection={defaultModelSelection}
            panelSeats={resolved.panel.value ?? []}
            panelSource={resolved.panel.source}
            panelOverridden={currentLayer.panel !== undefined}
            onPanelChange={(next) => patchLayer("panel", next.length > 0 ? [...next] : undefined)}
            onPanelReset={() => patchLayer("panel", undefined)}
            councilSeats={resolved.council.value ?? []}
            councilSource={resolved.council.source}
            councilOverridden={currentLayer.council !== undefined}
            onCouncilChange={(next) =>
              patchLayer("council", next.length > 0 ? [...next] : undefined)
            }
            onCouncilReset={() => patchLayer("council", undefined)}
          />
        </>
      )}
    </div>
  );
}

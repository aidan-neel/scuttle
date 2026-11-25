import {
  Add01Icon,
  Delete02Icon,
  RefreshIcon,
  Search01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import type { ProviderSnapshot } from "@scuttle/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AddProjectDialog } from "@/components/shell/AddProjectDialog.tsx";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { modelFavoriteKey, useFavoriteModels } from "@/lib/modelFavorites.ts";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function statusDotClass(status: ProviderSnapshot["status"]): string {
  switch (status) {
    case "ready":
      return "bg-success";
    case "unauthenticated":
      return "bg-warning";
    case "unavailable":
      return "bg-danger";
    case "probing":
      return "bg-input";
    case "disabled":
      return "bg-fg-faint";
  }
}

function providerSummary(provider: ProviderSnapshot): string {
  switch (provider.status) {
    case "ready":
      return `Ready · ${provider.models.length} model${provider.models.length === 1 ? "" : "s"}`;
    case "probing":
      return "Checking availability…";
    case "unauthenticated":
      return "Sign in required";
    case "unavailable":
      return "CLI not installed";
    case "disabled":
      return "Disabled";
  }
}

function SettingsSection({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-label font-medium text-fg-secondary">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-card bg-panel shadow-raised">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  control,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly control?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-body text-fg">{title}</div>
        {description && <div className="mt-0.5 text-label text-fg-muted">{description}</div>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}

function ProviderDetail({ provider }: { readonly provider: ProviderSnapshot }) {
  const { updateProvider } = useWorkspace();
  const { isFavorite, toggle } = useFavoriteModels();
  const [binaryPath, setBinaryPath] = useState(provider.binaryPath);
  const [launchArgs, setLaunchArgs] = useState(provider.launchArgs);
  const [modelQuery, setModelQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = binaryPath !== provider.binaryPath || launchArgs !== provider.launchArgs;

  const saveRuntime = async () => {
    setSaving(true);
    try {
      await updateProvider(provider.id, { binaryPath, launchArgs });
    } finally {
      setSaving(false);
    }
  };

  const recheck = async () => {
    setSaving(true);
    try {
      await updateProvider(provider.id, {});
    } finally {
      setSaving(false);
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const visibleModels = (
    q.length === 0
      ? provider.models
      : provider.models.filter(
          (m) => m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q),
        )
  ).slice(0, 16);

  return (
    <div className="space-y-4">
      <SettingsSection
        title={provider.name}
        action={
          <div className="flex items-center gap-2">
            {provider.version && (
              <span className="font-mono text-meta text-fg-muted">v{provider.version}</span>
            )}
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void recheck()}>
              <Icon icon={RefreshIcon} />
              Re-check
            </Button>
          </div>
        }
      >
        <SettingsRow
          title="Status"
          description={
            provider.status !== "ready" && provider.status !== "disabled"
              ? (provider.message ?? provider.setupHint)
              : undefined
          }
          control={
            <span className="inline-flex items-center gap-2 text-label text-fg-secondary">
              <span className={`size-2 rounded-full ${statusDotClass(provider.status)}`} />
              {providerSummary(provider)}
            </span>
          }
        />
        <SettingsRow
          title="Binary override"
          description="Leave empty to auto-detect on PATH."
          control={
            <input
              type="text"
              value={binaryPath}
              onChange={(event) => setBinaryPath(event.target.value)}
              placeholder="Auto-detected"
              spellCheck={false}
              className="h-8 w-56 rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
            />
          }
        />
        <SettingsRow
          title="Launch arguments"
          description="Optional CLI flags appended when starting sessions."
          control={
            <input
              type="text"
              value={launchArgs}
              onChange={(event) => setLaunchArgs(event.target.value)}
              placeholder="None"
              spellCheck={false}
              className="h-8 w-56 rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
            />
          }
        />
        {dirty && (
          <div className="flex items-center justify-end gap-2 px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBinaryPath(provider.binaryPath);
                setLaunchArgs(provider.launchArgs);
              }}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={() => void saveRuntime()}
            >
              Save changes
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={`Models (${provider.models.length})`}
        action={
          provider.models.length > 8 ? (
            <div className="flex items-center gap-1.5 rounded-control bg-panel px-2 py-1 shadow-raised">
              <Icon icon={Search01Icon} className="size-3 text-fg-muted" />
              <input
                type="text"
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder="Filter models"
                className="w-36 bg-transparent text-meta text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
          ) : undefined
        }
      >
        {visibleModels.map((model) => {
          const favKey = modelFavoriteKey(provider.id, model.slug);
          const starred = isFavorite(favKey);
          return (
            <div key={model.slug} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="truncate text-body text-fg">{model.name}</span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  starred ? `Remove ${model.name} from favorites` : `Favorite ${model.name}`
                }
                onClick={() => toggle(favKey)}
                className={starred ? "text-warning" : "text-fg-faint hover:text-fg-secondary"}
              >
                <Icon icon={StarIcon} />
              </Button>
            </div>
          );
        })}
        {provider.models.length > visibleModels.length && (
          <div className="px-4 py-2 text-meta text-fg-muted">
            Showing {visibleModels.length} of {provider.models.length} models. Filter to find more.
          </div>
        )}
      </SettingsSection>
    </div>
  );
}

function SettingsPage() {
  const { providers, projects, refreshProviders, updateProvider, deleteProject } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const isDesktop = getDesktopBridge() !== null;

  const activeProvider = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProviders();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-composer space-y-8 px-4 py-12">
        <div className="space-y-1">
          <h1 className="text-title font-semibold tracking-tight text-fg">Settings</h1>
          <p className="text-body text-fg-muted">
            Manage agent harnesses, connected repositories, and runtime defaults.
          </p>
        </div>

        <SettingsSection
          title="Providers"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              <Icon icon={RefreshIcon} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </Button>
          }
        >
          {providers.map((provider) => {
            const selected = activeProvider?.id === provider.id;
            return (
              <div
                key={provider.id}
                className={`group relative flex items-center gap-3 px-4 py-3 transition-colors duration-100 ${
                  selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(provider.id)}
                  className="absolute inset-0 cursor-pointer outline-none focus-visible:shadow-focus"
                >
                  <span className="sr-only">Select {provider.name}</span>
                </button>
                <span
                  className={`pointer-events-none relative flex min-w-0 flex-1 items-center gap-3 ${
                    !provider.enabled && !selected ? "opacity-60 group-hover:opacity-100" : ""
                  }`}
                >
                  <BrandLogo brand={provider.kind} className="size-4.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-medium text-fg">
                        {provider.name}
                      </span>
                      {provider.version && (
                        <span className="shrink-0 font-mono text-meta text-fg-muted">
                          v{provider.version}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-label text-fg-muted">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${statusDotClass(provider.status)}`}
                      />
                      <span className="truncate">{providerSummary(provider)}</span>
                    </span>
                  </span>
                </span>
                <div className="relative z-10 shrink-0">
                  <Switch
                    checked={provider.enabled}
                    aria-label={`Enable ${provider.name}`}
                    onCheckedChange={(enabled) => void updateProvider(provider.id, { enabled })}
                  />
                </div>
              </div>
            );
          })}
        </SettingsSection>

        {activeProvider && <ProviderDetail key={activeProvider.id} provider={activeProvider} />}

        <SettingsSection
          title="Projects"
          action={
            <Button variant="ghost" size="sm" onClick={() => setAddProjectOpen(true)}>
              <Icon icon={Add01Icon} />
              Add project
            </Button>
          }
        >
          {projects.map((project) => (
            <div key={project.id} className="flex items-center gap-3 px-4 py-3">
              <Identicon name={project.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-body font-medium text-fg">{project.name}</span>
                  {project.isGitRepo && (
                    <span className="rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                      {project.defaultBranch}
                    </span>
                  )}
                </div>
                <div className="text-label text-fg-muted">
                  {project.isGitRepo ? "Git repository" : "Local folder"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${project.name}`}
                onClick={() => void deleteProject(project.id)}
              >
                <Icon icon={Delete02Icon} />
              </Button>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="px-4 py-5 text-label text-fg-muted">No projects registered yet.</div>
          )}
        </SettingsSection>

        <SettingsSection title="Environment">
          <SettingsRow
            title="Runtime"
            control={
              <span className="font-mono text-label text-fg-secondary">
                {isDesktop ? "Electrobun" : "Web browser"}
              </span>
            }
          />
        </SettingsSection>

        <AddProjectDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} />
      </div>
    </div>
  );
}

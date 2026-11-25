import { Add01Icon, Delete02Icon, RefreshIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { ProviderSnapshot } from "@scuttle/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useState } from "react";
import { AddProjectDialog } from "@/components/shell/AddProjectDialog.tsx";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { easeOut } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function StatusPill({ status }: { readonly status: ProviderSnapshot["status"] }) {
  switch (status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1 rounded-chip bg-success/14 px-2 py-0.5 text-meta font-medium text-success">
          <Icon icon={Tick02Icon} className="size-3" />
          Ready
        </span>
      );
    case "probing":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-chip bg-white/7 px-2 py-0.5 text-meta text-fg-muted">
          <DotSpinner variant="loading" label="Checking" />
          Checking
        </span>
      );
    case "unauthenticated":
      return (
        <span className="inline-flex items-center rounded-chip bg-warning/15 px-2 py-0.5 text-meta font-medium text-warning">
          Sign in required
        </span>
      );
    case "unavailable":
      return (
        <span className="inline-flex items-center rounded-chip bg-danger/15 px-2 py-0.5 text-meta font-medium text-danger">
          Not found
        </span>
      );
    case "disabled":
      return (
        <span className="inline-flex items-center rounded-chip bg-white/6 px-2 py-0.5 text-meta text-fg-muted">
          Disabled
        </span>
      );
  }
}

function ProviderCard({ provider }: { readonly provider: ProviderSnapshot }) {
  const { updateProvider } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [binaryPath, setBinaryPath] = useState(provider.binaryPath);
  const [launchArgs, setLaunchArgs] = useState(provider.launchArgs);
  const [saving, setSaving] = useState(false);

  const toggleEnabled = async () => {
    setSaving(true);
    try {
      await updateProvider(provider.id, { enabled: !provider.enabled });
    } finally {
      setSaving(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await updateProvider(provider.id, { binaryPath, launchArgs });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-card bg-panel p-4 shadow-raised">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-raised shadow-raised">
          <BrandLogo brand={provider.kind} className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-body font-medium text-fg">{provider.name}</span>
            <StatusPill status={provider.status} />
            {provider.version && (
              <span className="font-mono text-meta text-fg-muted">v{provider.version}</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-label text-fg-muted">
            {provider.message ??
              (provider.resolvedPath
                ? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} · ${provider.resolvedPath}`
                : provider.setupHint)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? "Hide" : "Configure"}
        </Button>
        <Button
          variant={provider.enabled ? "secondary" : "primary"}
          size="sm"
          disabled={saving}
          onClick={() => void toggleEnabled()}
        >
          {provider.enabled ? "Disable" : "Enable"}
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-line pt-3.5">
          {provider.setupHint && (
            <p className="text-label text-fg-secondary">{provider.setupHint}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-meta font-medium text-fg-muted">
                Binary path override
              </span>
              <input
                type="text"
                value={binaryPath}
                onChange={(event) => setBinaryPath(event.target.value)}
                placeholder={provider.resolvedPath ?? "Auto-detect on PATH"}
                className="h-8 w-full rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-meta font-medium text-fg-muted">Extra launch args</span>
              <input
                type="text"
                value={launchArgs}
                onChange={(event) => setLaunchArgs(event.target.value)}
                placeholder="e.g. --profile work"
                className="h-8 w-full rounded-control bg-chrome px-2.5 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-meta text-fg-muted">
              Discovered models:{" "}
              {provider.models
                .slice(0, 6)
                .map((m) => m.name)
                .join(", ")}
              {provider.models.length > 6 ? ` +${provider.models.length - 6} more` : ""}
            </span>
            <Button variant="primary" size="sm" disabled={saving} onClick={() => void saveConfig()}>
              Save &amp; re-check
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPage() {
  const { providers, projects, refreshProviders, deleteProject } = useWorkspace();
  const [refreshing, setRefreshing] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const isDesktop = getDesktopBridge() !== null;

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
      <motion.section
        initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.4, ease: easeOut }}
        className="mx-auto w-full max-w-composer space-y-8 px-4 py-12"
      >
        <div className="space-y-1">
          <h1 className="text-title font-semibold tracking-tight">Settings</h1>
          <p className="text-body text-fg-muted">
            Configure multi-harness agent providers, local repositories, and runtime defaults.
          </p>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-body font-medium text-fg">Agent Harnesses</h2>
              <p className="text-label text-fg-muted">
                Scuttle auto-detects installed CLIs and routes each thread to your chosen harness.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              <Icon icon={RefreshIcon} className={refreshing ? "animate-spin" : ""} />
              Re-check all
            </Button>
          </div>
          <div className="space-y-2.5">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-body font-medium text-fg">Projects</h2>
              <p className="text-label text-fg-muted">
                Local folders and Git repositories available for threads and worktrees.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setAddProjectOpen(true)}>
              <Icon icon={Add01Icon} />
              Add project
            </Button>
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-card bg-panel shadow-raised">
            {projects.map((project) => (
              <div key={project.id} className="flex items-center gap-3 px-4 py-3">
                <Identicon name={project.name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body font-medium text-fg">{project.name}</span>
                    {project.isGitRepo && (
                      <span className="rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                        {project.defaultBranch}
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-meta text-fg-muted">{project.path}</p>
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
              <p className="px-4 py-5 text-label text-fg-muted">No projects registered yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-card bg-panel p-4 text-body text-fg-secondary shadow-raised">
          Desktop bridge:{" "}
          <span className="font-mono text-fg">{isDesktop ? "Electrobun" : "Web browser"}</span>
        </section>

        <AddProjectDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} />
      </motion.section>
    </div>
  );
}

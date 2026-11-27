import { Add01Icon, Delete02Icon, PlugSocketIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { createScuttleApiClient } from "@scuttle/client-runtime";
import type { ProviderSnapshot } from "@scuttle/contracts";
import { useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import { AcpRegistryBrowser } from "./AcpRegistryBrowser.tsx";
import {
  AddProviderInstanceDialog,
  formatEnvLines,
  parseEnvLines,
} from "./AddProviderInstanceDialog.tsx";
import { ModelList } from "./ModelList.tsx";
import {
  providerSummary,
  SettingsGroup,
  SettingsRow,
  StatusDot,
  TextField,
} from "./primitives.tsx";

const apiClient = createScuttleApiClient();

function ProviderBrandIcon({ provider }: { readonly provider: ProviderSnapshot }) {
  if (provider.kind === "acp-registry") {
    return <Icon icon={PlugSocketIcon} className="size-4.5 shrink-0 text-fg-secondary" />;
  }
  return <BrandLogo brand={provider.kind} className="size-4.5 shrink-0" />;
}

const isRemovableInstance = (provider: ProviderSnapshot): boolean =>
  provider.isBuiltIn === false || provider.kind === "acp-registry" || provider.id !== provider.kind;

function ProviderRow({
  provider,
  selected,
  onSelect,
}: {
  readonly provider: ProviderSnapshot;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { updateProvider } = useWorkspace();
  const secondary = isRemovableInstance(provider);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 px-4 py-3 transition-colors duration-(--dur-hover)",
        selected ? "bg-fg/[0.05]" : "hover:bg-fg/[0.025]",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 cursor-pointer outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-edge-strong)]"
      >
        <span className="sr-only">Show {provider.name} settings</span>
      </button>
      <span
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-1 items-center gap-3",
          !provider.enabled && !selected && "opacity-60 group-hover:opacity-100",
        )}
      >
        <ProviderBrandIcon provider={provider} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-fg">{provider.name}</span>
            {provider.version !== undefined && (
              <span className="shrink-0 font-mono text-meta text-fg-muted">
                v{provider.version}
              </span>
            )}
            {secondary && (
              <span className="shrink-0 rounded-chip bg-fg/[0.06] px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted">
                {provider.acpDistribution ?? "isolated"}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-label text-fg-muted">
            <StatusDot status={provider.status} className="size-1.5" />
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
}

function ProviderRuntime({
  provider,
  onDeleted,
}: {
  readonly provider: ProviderSnapshot;
  readonly onDeleted: () => Promise<void>;
}) {
  const { updateProvider } = useWorkspace();
  const [binaryPath, setBinaryPath] = useState(provider.binaryPath);
  const [launchArgs, setLaunchArgs] = useState(provider.launchArgs);
  const [homePath, setHomePath] = useState(provider.homePath ?? "");
  const [shadowHomePath, setShadowHomePath] = useState(provider.shadowHomePath ?? "");
  const [envText, setEnvText] = useState(() => formatEnvLines(provider.env));
  const [busy, setBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const initialEnvText = formatEnvLines(provider.env);
  const dirty =
    binaryPath !== provider.binaryPath ||
    launchArgs !== provider.launchArgs ||
    homePath !== (provider.homePath ?? "") ||
    shadowHomePath !== (provider.shadowHomePath ?? "") ||
    envText !== initialEnvText;

  const run = (patch: Parameters<typeof updateProvider>[1]) => {
    setBusy(true);
    void updateProvider(provider.id, patch).finally(() => {
      setBusy(false);
    });
  };

  const needsAttention = provider.status === "unauthenticated" || provider.status === "unavailable";
  const removable = isRemovableInstance(provider);

  return (
    <>
      <SettingsGroup
        title={`${provider.name} runtime`}
        action={
          <div className="flex items-center gap-1">
            {removable && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDeleteOpen(true)}
                className="text-danger hover:text-danger"
              >
                <Icon icon={Delete02Icon} />
                Delete
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run({})}>
              <Icon icon={RefreshIcon} className={cn(busy && "animate-spin")} />
              Re-check
            </Button>
          </div>
        }
      >
        <SettingsRow
          title="Status"
          description={needsAttention ? (provider.message ?? provider.setupHint) : undefined}
          control={
            <span className="inline-flex items-center gap-2 text-label text-fg-secondary">
              <StatusDot status={provider.status} className="size-2" />
              {providerSummary(provider)}
            </span>
          }
        />
        <SettingsRow
          title="Binary override"
          description="Leave empty to auto-detect on PATH."
          control={
            <TextField
              label={`${provider.name} binary override`}
              value={binaryPath}
              onChange={setBinaryPath}
              placeholder="Auto-detected"
            />
          }
        />
        <SettingsRow
          title="Launch arguments"
          description="Extra CLI flags added when a session starts."
          control={
            <TextField
              label={`${provider.name} launch arguments`}
              value={launchArgs}
              onChange={setLaunchArgs}
              placeholder="None"
            />
          }
        />
        <SettingsRow
          title="Home path"
          description="Shared config/auth directory override (e.g. ~/.claude-work)."
          control={
            <TextField
              label={`${provider.name} home path`}
              value={homePath}
              onChange={setHomePath}
              placeholder="Default"
            />
          }
        />
        <SettingsRow
          title="Shadow home"
          description="Isolated credential/state directory for this instance."
          control={
            <TextField
              label={`${provider.name} shadow home`}
              value={shadowHomePath}
              onChange={setShadowHomePath}
              placeholder="Default"
            />
          }
        />
        <div className="space-y-1.5 px-4 py-3">
          <div className="text-body text-fg">Environment variables</div>
          <div className="text-label text-fg-muted">One KEY=VALUE entry per line.</div>
          <textarea
            rows={2}
            aria-label={`${provider.name} environment variables`}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder="None"
            spellCheck={false}
            className="w-full resize-none rounded-control bg-chrome p-2.5 font-mono text-meta text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus"
          />
        </div>
        {dirty && (
          <div className="flex items-center justify-end gap-2 bg-fg/[0.02] px-4 py-2.5">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setBinaryPath(provider.binaryPath);
                setLaunchArgs(provider.launchArgs);
                setHomePath(provider.homePath ?? "");
                setShadowHomePath(provider.shadowHomePath ?? "");
                setEnvText(initialEnvText);
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={busy}
              onClick={() => {
                const parsedEnv = parseEnvLines(envText);
                void run({
                  binaryPath,
                  launchArgs,
                  homePath: homePath.trim() || null,
                  shadowHomePath: shadowHomePath.trim() || null,
                  env: Object.keys(parsedEnv).length > 0 ? parsedEnv : null,
                });
              }}
            >
              Save changes
            </Button>
          </div>
        )}
      </SettingsGroup>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${provider.name}?`}
        description="Removes this provider account from Scuttle. Existing files in its shadow directory are left untouched."
        confirmLabel="Delete account"
        onConfirm={async () => {
          await apiClient.deleteProviderInstance(provider.id);
          await onDeleted();
        }}
      />
    </>
  );
}

export function ProvidersSection() {
  const { providers, refreshProviders, refreshWorkspace } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const active = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  const refresh = () => {
    setRefreshing(true);
    void refreshProviders().finally(() => {
      setRefreshing(false);
    });
  };

  const handleInstanceAdded = async (snapshot: ProviderSnapshot) => {
    await refreshWorkspace();
    setSelectedId(snapshot.id);
  };

  return (
    <>
      <SettingsGroup
        title="Installed harnesses"
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
              <Icon icon={Add01Icon} />
              Add account
            </Button>
            <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void refresh()}>
              <Icon icon={RefreshIcon} className={cn(refreshing && "animate-spin")} />
              Refresh all
            </Button>
          </div>
        }
      >
        {providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            selected={active?.id === provider.id}
            onSelect={() => setSelectedId(provider.id)}
          />
        ))}
        {providers.length === 0 && (
          <div className="px-4 py-5 text-label text-fg-muted">Looking for agent harnesses…</div>
        )}
      </SettingsGroup>

      {active !== null && (
        <div key={active.id} className="space-y-8">
          <ProviderRuntime
            provider={active}
            onDeleted={async () => {
              setSelectedId(null);
              await refreshWorkspace();
            }}
          />
          <section className="space-y-2">
            <h2 className="px-0.5 text-label font-medium text-fg-secondary">
              {active.name} models
            </h2>
            <ModelList provider={active} />
          </section>
        </div>
      )}

      <AcpRegistryBrowser onInstalled={handleInstanceAdded} />

      <AddProviderInstanceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={handleInstanceAdded}
      />
    </>
  );
}

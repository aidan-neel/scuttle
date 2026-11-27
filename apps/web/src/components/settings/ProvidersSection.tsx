import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { ProviderSnapshot } from "@scuttle/contracts";
import { useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import { ModelList } from "./ModelList.tsx";
import {
  providerSummary,
  SettingsGroup,
  SettingsRow,
  StatusDot,
  TextField,
} from "./primitives.tsx";

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
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 px-4 py-3 transition-colors duration-(--dur-hover)",
        selected ? "bg-white/[0.05]" : "hover:bg-white/[0.025]",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 cursor-pointer outline-none focus-visible:shadow-[inset_0_0_0_2px_rgb(235_235_236/42%)]"
      >
        <span className="sr-only">Show {provider.name} settings</span>
      </button>
      <span
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-1 items-center gap-3",
          !provider.enabled && !selected && "opacity-60 group-hover:opacity-100",
        )}
      >
        <BrandLogo brand={provider.kind} className="size-4.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-fg">{provider.name}</span>
            {provider.version !== undefined && (
              <span className="shrink-0 font-mono text-meta text-fg-muted">
                v{provider.version}
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

function ProviderRuntime({ provider }: { readonly provider: ProviderSnapshot }) {
  const { updateProvider } = useWorkspace();
  const [binaryPath, setBinaryPath] = useState(provider.binaryPath);
  const [launchArgs, setLaunchArgs] = useState(provider.launchArgs);
  const [busy, setBusy] = useState(false);
  const dirty = binaryPath !== provider.binaryPath || launchArgs !== provider.launchArgs;

  const run = (patch: Parameters<typeof updateProvider>[1]) => {
    setBusy(true);
    void updateProvider(provider.id, patch).finally(() => {
      setBusy(false);
    });
  };

  const needsAttention = provider.status === "unauthenticated" || provider.status === "unavailable";

  return (
    <SettingsGroup
      title={`${provider.name} runtime`}
      action={
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run({})}>
          <Icon icon={RefreshIcon} className={cn(busy && "animate-spin")} />
          Re-check
        </Button>
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
      {dirty && (
        <div className="flex items-center justify-end gap-2 bg-white/[0.02] px-4 py-2.5">
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setBinaryPath(provider.binaryPath);
              setLaunchArgs(provider.launchArgs);
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onClick={() => void run({ binaryPath, launchArgs })}
          >
            Save changes
          </Button>
        </div>
      )}
    </SettingsGroup>
  );
}

export function ProvidersSection() {
  const { providers, refreshProviders } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const active = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  const refresh = () => {
    setRefreshing(true);
    void refreshProviders().finally(() => {
      setRefreshing(false);
    });
  };

  return (
    <>
      <SettingsGroup
        title="Installed harnesses"
        action={
          <Button variant="ghost" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            <Icon icon={RefreshIcon} className={cn(refreshing && "animate-spin")} />
            Refresh all
          </Button>
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
          <ProviderRuntime provider={active} />
          <section className="space-y-2">
            <h2 className="px-0.5 text-label font-medium text-fg-secondary">
              {active.name} models
            </h2>
            <ModelList provider={active} />
          </section>
        </div>
      )}
    </>
  );
}

import {
  Download04Icon,
  PlugSocketIcon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { createScuttleApiClient, describeApiError } from "@scuttle/client-runtime";
import type { AcpRegistryAgentSummary, ProviderSnapshot } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { SearchField, SettingsGroup } from "./primitives.tsx";

const apiClient = createScuttleApiClient();

interface AcpRegistryBrowserProps {
  readonly onInstalled: (snapshot: ProviderSnapshot) => void | Promise<void>;
}

function AgentIcon({ icon, name }: { readonly icon?: string; readonly name: string }) {
  const [broken, setBroken] = useState(false);
  if (icon && !broken) {
    return (
      <img
        src={icon}
        alt={name}
        onError={() => setBroken(true)}
        className="size-5 shrink-0 rounded-chip object-contain"
      />
    );
  }
  return <Icon icon={PlugSocketIcon} className="size-4.5 shrink-0 text-fg-muted" />;
}

export function AcpRegistryBrowser({ onInstalled }: AcpRegistryBrowserProps) {
  const [agents, setAgents] = useState<ReadonlyArray<AcpRegistryAgentSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadRegistry = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const list = await apiClient.listAcpRegistry(refresh ? { refresh: true } : undefined);
      setAgents(list);
    } catch (err) {
      setError(describeApiError(err, "Failed to load ACP registry."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadRegistry(false);
  }, []);

  const install = async (agent: AcpRegistryAgentSummary) => {
    if (installingId !== null) return;
    setInstallingId(agent.id);
    setError(null);
    try {
      const snapshot = await apiClient.installAcpAgent({ agentId: agent.id });
      await onInstalled(snapshot);
      await loadRegistry(false);
    } catch (err) {
      setError(describeApiError(err, "Failed to load ACP registry."));
    } finally {
      setInstallingId(null);
    }
  };

  const normalized = query.trim().toLowerCase();
  const visible = agents.filter(
    (agent) =>
      normalized.length === 0 ||
      agent.name.toLowerCase().includes(normalized) ||
      agent.id.toLowerCase().includes(normalized) ||
      agent.description.toLowerCase().includes(normalized),
  );

  return (
    <SettingsGroup
      title="ACP Registry"
      action={
        <Button
          variant="ghost"
          size="sm"
          disabled={refreshing || loading}
          onClick={() => void loadRegistry(true)}
        >
          <Icon icon={RefreshIcon} className={cn(refreshing && "animate-spin")} />
          Refresh registry
        </Button>
      }
    >
      <div className="px-3 py-2.5">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search ACP agents (e.g. Devin, Copilot…)"
        />
        {error && (
          <p role="alert" className="mt-2 px-1 text-label text-danger">
            {error}
          </p>
        )}
      </div>

      {loading && agents.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-5 text-label text-fg-muted">
          <DotSpinner variant="working" label="Loading ACP Registry" />
          Loading official ACP Registry…
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="px-4 py-5 text-label text-fg-muted">
          {agents.length === 0
            ? "No ACP Registry agents available."
            : `No registry agents match “${query.trim()}”.`}
        </div>
      )}

      {visible.map((agent) => {
        const busy = installingId === agent.id;
        return (
          <div key={agent.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-chip bg-fg/[0.05]">
                <AgentIcon
                  {...(agent.icon !== undefined ? { icon: agent.icon } : {})}
                  name={agent.name}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body font-medium text-fg">{agent.name}</span>
                  <span className="font-mono text-meta text-fg-muted">v{agent.version}</span>
                  {agent.distributions.map((dist) => (
                    <span
                      key={dist}
                      className="rounded-chip bg-fg/[0.06] px-1.5 py-0.5 font-mono text-[0.6875rem] text-fg-muted"
                    >
                      {dist}
                    </span>
                  ))}
                </div>
                <p className="mt-0.5 line-clamp-2 text-label text-fg-muted">{agent.description}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {agent.installed && (
                <span className="inline-flex items-center gap-1 rounded-chip bg-success/15 px-2 py-1 text-meta font-medium text-success">
                  <Icon icon={Tick02Icon} className="size-3" />
                  Installed
                </span>
              )}
              <Button
                variant={agent.installed ? "ghost" : "secondary"}
                size="sm"
                disabled={installingId !== null || agent.distributions.length === 0}
                onClick={() => void install(agent)}
              >
                {busy ? (
                  <DotSpinner variant="working" label={`Installing ${agent.name}`} />
                ) : (
                  <Icon icon={Download04Icon} />
                )}
                {agent.installed ? "Add account" : "Install"}
              </Button>
            </div>
          </div>
        );
      })}
    </SettingsGroup>
  );
}

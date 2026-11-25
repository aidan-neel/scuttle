import { RefreshIcon } from "@hugeicons/core-free-icons";
import type { DesktopInfo } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { useServerConnection } from "@/lib/useServerConnection.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SettingsGroup, SettingsRow } from "./primitives.tsx";

const PLATFORM_LABELS: Record<DesktopInfo["platform"], string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

const formatUptime = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", `${mins}m`]
    .filter((part) => part.length > 0)
    .join(" ");
};

function Value({ children, mono }: { readonly children: string; readonly mono?: boolean }) {
  return (
    <span className={cn("text-label text-fg-secondary", mono === true && "font-mono")}>
      {children}
    </span>
  );
}

function Indicator({
  tone,
  label,
}: {
  readonly tone: "ok" | "bad" | "idle";
  readonly label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-label text-fg-secondary">
      <span
        className={cn(
          "size-2 rounded-full",
          tone === "ok" ? "bg-success" : tone === "bad" ? "bg-danger" : "bg-fg-faint",
        )}
      />
      {label}
    </span>
  );
}

function useDesktopInfo(): DesktopInfo | null {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge === null) return;
    let active = true;
    void bridge.getDesktopInfo().then((next) => {
      if (active) setInfo(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return info;
}

function ServerStatus() {
  const connection = useServerConnection();
  switch (connection.kind) {
    case "idle":
    case "connecting":
      return (
        <SettingsRow
          title="Connection"
          control={
            <span className="inline-flex items-center gap-2 text-label text-fg-muted">
              <DotSpinner variant="loading" label="Connecting" className="size-2.5 text-warning" />
              Connecting
            </span>
          }
        />
      );
    case "disconnected":
      return (
        <SettingsRow
          title="Connection"
          description="Scuttle could not reach its local server. Restart Scuttle, then re-check."
          control={<Indicator tone="bad" label="Unreachable" />}
        />
      );
    case "connected":
      return (
        <>
          <SettingsRow title="Connection" control={<Indicator tone="ok" label="Connected" />} />
          <SettingsRow
            title="Server version"
            control={<Value mono>{connection.health.version}</Value>}
          />
          <SettingsRow
            title="Uptime"
            control={<Value>{formatUptime(connection.health.uptimeMs)}</Value>}
          />
          <SettingsRow
            title="Database"
            control={
              <Indicator
                tone={connection.health.databaseReady ? "ok" : "bad"}
                label={connection.health.databaseReady ? "Ready" : "Not ready"}
              />
            }
          />
        </>
      );
  }
}

export function EnvironmentSection() {
  const desktop = useDesktopInfo();
  const isDesktop = getDesktopBridge() !== null;
  const { providers } = useWorkspace();
  const [probe, setProbe] = useState(0);
  const enabled = providers.filter((p) => p.enabled);
  const ready = enabled.filter((p) => p.status === "ready");

  return (
    <>
      <SettingsGroup title="App">
        <SettingsRow
          title="Runtime"
          control={<Value>{isDesktop ? "Desktop app" : "Web browser"}</Value>}
        />
        {desktop !== null && (
          <>
            <SettingsRow
              title="Platform"
              control={<Value>{PLATFORM_LABELS[desktop.platform]}</Value>}
            />
            <SettingsRow title="App version" control={<Value mono>{desktop.appVersion}</Value>} />
          </>
        )}
        <SettingsRow
          title="Agent harnesses"
          description="Enabled harnesses that passed their last check."
          control={<Value>{`${ready.length} of ${enabled.length} ready`}</Value>}
        />
      </SettingsGroup>
      <SettingsGroup
        title="Local server"
        action={
          <Button variant="ghost" size="sm" onClick={() => setProbe((n) => n + 1)}>
            <Icon icon={RefreshIcon} />
            Re-check
          </Button>
        }
      >
        <ServerStatus key={probe} />
      </SettingsGroup>
    </>
  );
}

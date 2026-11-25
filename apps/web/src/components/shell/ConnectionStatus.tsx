import type { ConnectionState } from "@scuttle/client-runtime";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";

const LABELS: Record<ConnectionState["kind"], string> = {
  idle: "Local server",
  connecting: "Connecting",
  connected: "Local server",
  disconnected: "Server offline",
};

const DOTS: Record<Exclude<ConnectionState["kind"], "connecting">, string> = {
  idle: "bg-fg-faint",
  connected: "bg-success",
  disconnected: "bg-danger",
};

export function ConnectionStatus({ connection }: { connection: ConnectionState }) {
  return (
    <span
      role="status"
      className="flex min-w-0 flex-1 items-center gap-1.5 text-label text-fg-muted"
    >
      {connection.kind === "connecting" ? (
        <DotSpinner variant="loading" label="Connecting" className="size-2.5 text-warning" />
      ) : (
        <span
          className={`size-1.5 shrink-0 rounded-full transition-colors duration-300 ${DOTS[connection.kind]}`}
        />
      )}
      <span className="truncate">{LABELS[connection.kind]}</span>
    </span>
  );
}

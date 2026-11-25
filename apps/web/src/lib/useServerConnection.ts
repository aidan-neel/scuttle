import { type ConnectionState, fetchServerHealth } from "@scuttle/client-runtime";
import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";
import { getDesktopBridge } from "./desktopBridge.ts";

export function useServerConnection(): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>({ kind: "idle" });

  useEffect(() => {
    let active = true;
    const probe = async () => {
      setConnection({ kind: "connecting", attempt: 1 });
      const bridge = getDesktopBridge();
      const baseUrl = bridge === null ? undefined : (await bridge.getDesktopInfo()).serverUrl;
      const exit = await Effect.runPromiseExit(fetchServerHealth(baseUrl));
      if (!active) return;
      setConnection(
        exit._tag === "Success"
          ? { kind: "connected", health: exit.value }
          : { kind: "disconnected", reason: "Server unreachable", attempt: 1 },
      );
    };
    void probe();
    return () => {
      active = false;
    };
  }, []);

  return connection;
}

import { type ServerPushEvent, ServerWsMessage } from "@scuttle/contracts";
import * as Schema from "effect/Schema";
import { resolveWebSocketUrl } from "./connection.ts";

const decodeWsMessage = Schema.decodeUnknownOption(ServerWsMessage);

export interface WsSupervisorOptions {
  readonly baseUrl?: string;
  readonly onEvent: (event: ServerPushEvent) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
}

export interface WsSupervisorHandle {
  readonly close: () => void;
}

const isPushEvent = (message: ServerWsMessage): message is ServerPushEvent =>
  message.kind !== "pong" && message.kind !== "health" && message.kind !== "error";

export const createWsSupervisor = (options: WsSupervisorOptions): WsSupervisorHandle => {
  let disposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;

  const clearTimers = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const connect = () => {
    if (disposed) return;
    clearTimers();
    const url = resolveWebSocketUrl(options.baseUrl);
    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener("open", () => {
      if (disposed) {
        ws.close();
        return;
      }
      attempt = 0;
      options.onOpen?.();
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ kind: "ping", id: crypto.randomUUID() }));
        }
      }, 25_000);
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const decoded = decodeWsMessage(parsed);
      if (decoded._tag === "Some" && isPushEvent(decoded.value)) {
        options.onEvent(decoded.value);
      }
    });

    ws.addEventListener("close", () => {
      clearTimers();
      if (socket === ws) {
        socket = null;
      }
      options.onClose?.();
      if (disposed) return;
      attempt += 1;
      const delayMs = Math.min(8_000, 400 * 2 ** Math.min(attempt - 1, 4));
      reconnectTimer = setTimeout(connect, delayMs);
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  };

  connect();

  return {
    close: () => {
      disposed = true;
      clearTimers();
      if (socket !== null) {
        socket.close();
        socket = null;
      }
    },
  };
};

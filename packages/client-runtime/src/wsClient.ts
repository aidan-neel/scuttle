import { type ServerPushEvent, ServerWsMessage, TurnDeltaEvent } from "@scuttle/contracts";
import * as Schema from "effect/Schema";
import { resolveWebSocketUrl } from "./connection.ts";

const decodeTurnDelta = Schema.decodeUnknownOption(TurnDeltaEvent);
const decodeWsMessage = Schema.decodeUnknownOption(ServerWsMessage);

export interface WsOpenInfo {
  readonly isReconnect: boolean;
}

export interface WsSupervisorOptions {
  readonly baseUrl?: string;
  readonly onEvent?: (event: ServerPushEvent) => void;
  readonly onEvents?: (events: ReadonlyArray<ServerPushEvent>) => void;
  readonly onOpen?: (info: WsOpenInfo) => void;
  readonly onClose?: () => void;
}

export interface WsSupervisorHandle {
  readonly flush: () => void;
  readonly close: () => void;
}

const isPushEvent = (message: ServerWsMessage): message is ServerPushEvent =>
  message.kind !== "pong" && message.kind !== "health" && message.kind !== "error";

const isTurnDeltaCandidate = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "turn.delta";

export const decodeServerPushEvent = (parsed: unknown): ServerPushEvent | null => {
  if (isTurnDeltaCandidate(parsed)) {
    const delta = decodeTurnDelta(parsed);
    if (delta._tag === "Some") {
      return delta.value;
    }
  }
  const decoded = decodeWsMessage(parsed);
  return decoded._tag === "Some" && isPushEvent(decoded.value) ? decoded.value : null;
};

type ScheduledFlush =
  | {
      readonly kind: "raf";
      readonly id: number;
      readonly safetyTimer: ReturnType<typeof setTimeout>;
    }
  | { readonly kind: "timeout"; readonly timer: ReturnType<typeof setTimeout> };

export const createWsSupervisor = (options: WsSupervisorOptions): WsSupervisorHandle => {
  let disposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;
  let hasOpenedBefore = false;
  let pendingEvents: Array<ServerPushEvent> = [];
  let scheduledFlush: ScheduledFlush | null = null;

  const cancelScheduledFlush = () => {
    if (scheduledFlush === null) return;
    if (scheduledFlush.kind === "raf") {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(scheduledFlush.id);
      }
      clearTimeout(scheduledFlush.safetyTimer);
    } else {
      clearTimeout(scheduledFlush.timer);
    }
    scheduledFlush = null;
  };

  const flush = () => {
    cancelScheduledFlush();
    if (disposed || pendingEvents.length === 0) {
      pendingEvents = [];
      return;
    }
    const batch = pendingEvents;
    pendingEvents = [];
    options.onEvents?.(batch);
  };

  const enqueueEvent = (event: ServerPushEvent) => {
    pendingEvents.push(event);
    if (scheduledFlush !== null) return;
    const isHidden = typeof document !== "undefined" && document.hidden;
    if (!isHidden && typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(() => flush());
      const safetyTimer = setTimeout(() => flush(), 100);
      scheduledFlush = { kind: "raf", id, safetyTimer };
    } else {
      const timer = setTimeout(() => flush(), 50);
      scheduledFlush = { kind: "timeout", timer };
    }
  };

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
      const isReconnect = hasOpenedBefore;
      hasOpenedBefore = true;
      options.onOpen?.({ isReconnect });
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
      const pushEvent = decodeServerPushEvent(parsed);
      if (pushEvent === null) return;
      options.onEvent?.(pushEvent);
      if (options.onEvents !== undefined) {
        enqueueEvent(pushEvent);
      }
    });

    ws.addEventListener("close", () => {
      cancelScheduledFlush();
      flush();
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
    flush,
    close: () => {
      disposed = true;
      cancelScheduledFlush();
      pendingEvents = [];
      clearTimers();
      if (socket !== null) {
        socket.close();
        socket = null;
      }
    },
  };
};

import type { ServerPushEvent } from "@scuttle/contracts";

export const WORKSPACE_FALLBACK_DELAY_MS = 250;
export const WORKSPACE_RETRY_BASE_MS = 1_000;
export const WORKSPACE_RETRY_MAX_MS = 8_000;
export const WORKSPACE_MAX_BUFFERED_EVENTS = 500;

export interface WorkspaceSyncOptions {
  readonly fetchWorkspace: () => Promise<boolean>;
  readonly onDispatchBatch: (events: ReadonlyArray<ServerPushEvent>) => void;
  readonly fallbackDelayMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly maxBufferedEvents?: number;
}

export interface WorkspaceSyncController {
  readonly start: () => void;
  readonly handleWsOpen: (info: { readonly isReconnect: boolean }) => void;
  readonly handleWsEvents: (events: ReadonlyArray<ServerPushEvent>) => void;
  readonly refresh: () => Promise<void>;
  readonly dispose: () => void;
}

export const createWorkspaceSync = (options: WorkspaceSyncOptions): WorkspaceSyncController => {
  const fallbackDelayMs = options.fallbackDelayMs ?? WORKSPACE_FALLBACK_DELAY_MS;
  const retryBaseMs = options.retryBaseMs ?? WORKSPACE_RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? WORKSPACE_RETRY_MAX_MS;
  const maxBufferedEvents = options.maxBufferedEvents ?? WORKSPACE_MAX_BUFFERED_EVENTS;

  let disposed = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchInFlight = false;
  let hasLoadedOnce = false;
  let loadedAfterWsOpen = false;
  let wsOpened = false;
  let pendingRefresh = false;
  let pendingFromWsOpen = false;
  let retryAttempt = 0;
  let bufferedEvents: Array<ServerPushEvent> = [];
  let bufferOverflowedDuringFetch = false;
  let waiters: Array<() => void> = [];

  const clearFallbackTimer = () => {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const clearRetryTimer = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const resolveWaiters = () => {
    if (waiters.length === 0) return;
    const toResolve = waiters;
    waiters = [];
    for (const resolve of toResolve) {
      resolve();
    }
  };

  const scheduleRetry = () => {
    if (disposed || hasLoadedOnce || retryTimer !== null) return;
    const delayMs = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(retryAttempt, 4));
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (disposed || hasLoadedOnce) return;
      void runLoad(wsOpened);
    }, delayMs);
  };

  const runLoad = async (fromWsOpen: boolean): Promise<void> => {
    if (disposed) {
      resolveWaiters();
      return;
    }
    if (fetchInFlight) {
      pendingRefresh = true;
      if (fromWsOpen) pendingFromWsOpen = true;
      return;
    }

    clearRetryTimer();
    fetchInFlight = true;
    if (!hasLoadedOnce) {
      bufferedEvents = [];
      bufferOverflowedDuringFetch = false;
    }

    let needsOverflowRefresh = false;
    try {
      const ok = await options.fetchWorkspace();
      if (disposed) return;
      if (ok) {
        clearFallbackTimer();
        clearRetryTimer();
        retryAttempt = 0;
        hasLoadedOnce = true;
        if (fromWsOpen) {
          loadedAfterWsOpen = true;
        }
        if (bufferOverflowedDuringFetch) {
          bufferedEvents = [];
          bufferOverflowedDuringFetch = false;
          needsOverflowRefresh = true;
        } else if (bufferedEvents.length > 0) {
          const drained = bufferedEvents;
          bufferedEvents = [];
          options.onDispatchBatch(drained);
        }
      } else if (!hasLoadedOnce) {
        bufferedEvents = [];
        bufferOverflowedDuringFetch = false;
        scheduleRetry();
      }
    } finally {
      fetchInFlight = false;
      if (!disposed && (pendingRefresh || needsOverflowRefresh)) {
        const nextFromWsOpen = pendingFromWsOpen || wsOpened;
        pendingRefresh = false;
        pendingFromWsOpen = false;
        void runLoad(nextFromWsOpen);
      } else {
        resolveWaiters();
      }
    }
  };

  return {
    start: () => {
      if (disposed || hasLoadedOnce || fetchInFlight || fallbackTimer !== null) return;
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (disposed || hasLoadedOnce || fetchInFlight) return;
        void runLoad(wsOpened);
      }, fallbackDelayMs);
    },
    handleWsOpen: ({ isReconnect }) => {
      if (disposed) return;
      wsOpened = true;
      clearFallbackTimer();
      clearRetryTimer();
      if (isReconnect || !loadedAfterWsOpen) {
        void runLoad(true);
      }
    },
    handleWsEvents: (events) => {
      if (disposed || events.length === 0) return;
      if (hasLoadedOnce) {
        options.onDispatchBatch(events);
        return;
      }
      if (!fetchInFlight) return;
      if (bufferOverflowedDuringFetch) return;
      if (bufferedEvents.length + events.length > maxBufferedEvents) {
        bufferedEvents = [];
        bufferOverflowedDuringFetch = true;
        return;
      }
      bufferedEvents.push(...events);
    },
    refresh: () => {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        void runLoad(wsOpened);
      });
    },
    dispose: () => {
      disposed = true;
      clearFallbackTimer();
      clearRetryTimer();
      bufferedEvents = [];
      bufferOverflowedDuringFetch = false;
      resolveWaiters();
    },
  };
};

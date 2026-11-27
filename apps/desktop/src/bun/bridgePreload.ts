export interface BridgePreloadOptions {
  readonly platform: "darwin" | "linux" | "win32";
  readonly appVersion: string;
  readonly serverUrl: string;
  readonly initialMaximized?: boolean;
}

export const resolveDesktopPlatform = (raw: string): "darwin" | "linux" | "win32" => {
  if (raw === "darwin" || raw === "win32") {
    return raw;
  }
  return "linux";
};

export const buildDesktopBridgePreload = (options: BridgePreloadOptions): string => {
  const payload = JSON.stringify({
    platform: options.platform,
    appVersion: options.appVersion,
    serverUrl: options.serverUrl,
  });
  const initialMaximized = options.initialMaximized === true;
  return `(() => {
    const info = ${payload};
    const zeroInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    let windowState = { maximized: ${initialMaximized}, insets: zeroInsets };
    const listeners = new Set();

    const clampInset = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

    const postToHost = (message) => {
      if (typeof window.__electrobunSendToHost === "function") {
        window.__electrobunSendToHost(message);
        return true;
      }
      return false;
    };

    Object.defineProperty(window, "__scuttleDesktopEmit", {
      value: (event) => {
        if (!event || typeof event !== "object") return;
        if (event.kind === "window-state" && typeof event.maximized === "boolean") {
          const rawInsets = event.insets && typeof event.insets === "object" ? event.insets : zeroInsets;
          windowState = {
            maximized: event.maximized,
            insets: {
              top: clampInset(rawInsets.top),
              right: clampInset(rawInsets.right),
              bottom: clampInset(rawInsets.bottom),
              left: clampInset(rawInsets.left),
            },
          };
          for (const listener of listeners) {
            try {
              listener(windowState);
            } catch {}
          }
        }
      },
      configurable: false,
      enumerable: false,
      writable: false,
    });

    Object.defineProperty(window, "scuttleDesktop", {
      value: Object.freeze({
        getDesktopInfo: () => Promise.resolve(info),
        openExternal: (url) => {
          if (!postToHost({ kind: "open-external", url })) {
            window.open(url, "_blank", "noopener,noreferrer");
          }
          return Promise.resolve();
        },
        minimizeWindow: () => {
          postToHost({ kind: "window.minimize" });
          return Promise.resolve();
        },
        toggleMaximizeWindow: () => {
          postToHost({ kind: "window.toggleMaximize" });
          return Promise.resolve();
        },
        closeWindow: () => {
          postToHost({ kind: "window.close" });
          return Promise.resolve();
        },
        getWindowState: () => {
          postToHost({ kind: "window.sync" });
          return Promise.resolve(windowState);
        },
        onWindowStateChange: (listener) => {
          listeners.add(listener);
          postToHost({ kind: "window.sync" });
          return () => {
            listeners.delete(listener);
          };
        },
      }),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  })();`;
};

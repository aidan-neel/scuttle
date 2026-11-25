export interface BridgePreloadOptions {
  readonly platform: "darwin" | "linux" | "win32";
  readonly appVersion: string;
  readonly serverUrl: string;
}

export const resolveDesktopPlatform = (raw: string): "darwin" | "linux" | "win32" => {
  if (raw === "darwin" || raw === "win32") {
    return raw;
  }
  return "linux";
};

export const buildDesktopBridgePreload = (options: BridgePreloadOptions): string => {
  const payload = JSON.stringify(options);
  return `(() => {
    const info = ${payload};
    Object.defineProperty(window, "scuttleDesktop", {
      value: Object.freeze({
        getDesktopInfo: () => Promise.resolve(info),
        openExternal: (url) => {
          window.open(url, "_blank", "noopener,noreferrer");
          return Promise.resolve();
        },
      }),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  })();`;
};

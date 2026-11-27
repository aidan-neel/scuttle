import type { DesktopPlatform, DesktopWindowInsets, DesktopWindowState } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";

const ZERO_INSETS: DesktopWindowInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const INITIAL_WINDOW_STATE: DesktopWindowState = { maximized: false, insets: ZERO_INSETS };

export interface DesktopChromeState {
  readonly isDesktop: boolean;
  readonly platform: DesktopPlatform | null;
  readonly showWindowControls: boolean;
  readonly isMacInset: boolean;
  readonly windowState: DesktopWindowState;
}

export function useDesktopChrome(): DesktopChromeState {
  const bridge = getDesktopBridge();
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);
  const [windowState, setWindowState] = useState<DesktopWindowState>(INITIAL_WINDOW_STATE);

  useEffect(() => {
    if (bridge === null) return;
    let active = true;
    void bridge.getDesktopInfo().then((info) => {
      if (active) setPlatform(info.platform);
    });
    void bridge.getWindowState?.().then((state) => {
      if (active) setWindowState(state);
    });
    const unsubscribe = bridge.onWindowStateChange?.((state) => {
      if (active) setWindowState(state);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [bridge]);

  const isDesktop = bridge !== null;
  const hasControlsApi =
    bridge !== null &&
    typeof bridge.minimizeWindow === "function" &&
    typeof bridge.toggleMaximizeWindow === "function" &&
    typeof bridge.closeWindow === "function";

  return {
    isDesktop,
    platform,
    showWindowControls: hasControlsApi && platform !== null && platform !== "darwin",
    isMacInset: isDesktop && platform === "darwin",
    windowState,
  };
}

export function DesktopDragStrip() {
  const bridge = getDesktopBridge();
  if (bridge === null) return null;

  return (
    <div
      aria-hidden
      onDoubleClick={() => {
        void bridge.toggleMaximizeWindow?.();
      }}
      className="desktop-drag absolute inset-x-0 top-0 z-20 h-11"
    />
  );
}

export function WindowControls({ maximized }: { readonly maximized: boolean }) {
  const bridge = getDesktopBridge();
  if (bridge === null) return null;

  return (
    <div
      role="group"
      aria-label="Window controls"
      className="desktop-no-drag absolute top-0 right-0 z-40 flex h-11 items-stretch"
    >
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => void bridge.minimizeWindow?.()}
        className="flex h-full w-[2.875rem] cursor-pointer items-center justify-center text-fg-muted outline-none transition-colors duration-(--dur-hover) ease-hover hover:bg-fg/[0.06] hover:text-fg focus-visible:shadow-focus active:bg-fg/[0.1]"
      >
        <svg aria-hidden viewBox="0 0 10 10" fill="none" className="size-2.5">
          <path d="M1 5.5H9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void bridge.toggleMaximizeWindow?.()}
        className="flex h-full w-[2.875rem] cursor-pointer items-center justify-center text-fg-muted outline-none transition-colors duration-(--dur-hover) ease-hover hover:bg-fg/[0.06] hover:text-fg focus-visible:shadow-focus active:bg-fg/[0.1]"
      >
        {maximized ? (
          <svg aria-hidden viewBox="0 0 10 10" fill="none" className="size-2.5">
            <path d="M2.5 3.5V1.5H8.5V7.5H6.5" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1.5" y="3.5" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        ) : (
          <svg aria-hidden viewBox="0 0 10 10" fill="none" className="size-2.5">
            <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => void bridge.closeWindow?.()}
        className="flex h-full w-[2.875rem] cursor-pointer items-center justify-center text-fg-muted outline-none transition-colors duration-(--dur-hover) ease-hover hover:bg-[#c42b1c] hover:text-white focus-visible:shadow-focus active:bg-[#b22719]"
      >
        <svg aria-hidden viewBox="0 0 10 10" fill="none" className="size-2.5">
          <path
            d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

import type { DesktopBridge } from "@scuttle/contracts";

declare global {
  interface Window {
    readonly scuttleDesktop?: DesktopBridge;
  }
}

export const getDesktopBridge = (): DesktopBridge | null => window.scuttleDesktop ?? null;

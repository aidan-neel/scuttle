import { createScuttleGitApi, type ScuttleGitApi } from "@scuttle/client-runtime";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";

let pending: Promise<ScuttleGitApi> | null = null;

export const getGitApi = (): Promise<ScuttleGitApi> => {
  pending ??= (async () => {
    const bridge = getDesktopBridge();
    const baseUrl = bridge === null ? undefined : (await bridge.getDesktopInfo()).serverUrl;
    return createScuttleGitApi(baseUrl);
  })();
  return pending;
};

export const openExternalUrl = (url: string): void => {
  const bridge = getDesktopBridge();
  if (bridge !== null) {
    void bridge.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

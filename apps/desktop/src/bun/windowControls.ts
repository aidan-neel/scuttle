import Electrobun, { type BrowserWindow, type Display, Screen, Utils } from "electrobun/bun";
import { applyDesktopWindowIcon } from "./windowIcon.ts";

type HostCommand =
  | { readonly kind: "window.minimize" }
  | { readonly kind: "window.toggleMaximize" }
  | { readonly kind: "window.close" }
  | { readonly kind: "window.sync" }
  | { readonly kind: "open-external"; readonly url: string };

interface WindowInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const ZERO_INSETS: WindowInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const parseHostCommand = (raw: unknown): HostCommand | null => {
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) {
    return null;
  }
  const kind = (raw as { readonly kind?: unknown }).kind;
  if (
    kind === "window.minimize" ||
    kind === "window.toggleMaximize" ||
    kind === "window.close" ||
    kind === "window.sync"
  ) {
    return { kind };
  }
  if (kind === "open-external") {
    const url = (raw as { readonly url?: unknown }).url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return { kind, url };
    }
  }
  return null;
};

const findDisplayForFrame = (frame: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): Display => {
  const displays = Screen.getAllDisplays();
  if (displays.length === 0) {
    return Screen.getPrimaryDisplay();
  }
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  const containing = displays.find(
    (d) =>
      centerX >= d.bounds.x &&
      centerX < d.bounds.x + d.bounds.width &&
      centerY >= d.bounds.y &&
      centerY < d.bounds.y + d.bounds.height,
  );
  return containing ?? Screen.getPrimaryDisplay();
};

// On Windows, Electrobun's hiddenInset window omits WS_CAPTION and WS_POPUP, so
// SW_MAXIMIZE expands the client area to the full monitor bounds rather than
// rcWork, pushing the bottom (or whichever edge holds the taskbar) behind it.
// Report the work-area overflow in logical DIPs so the shell pads cleanly clear.
const resolveMaximizedWorkAreaInsets = (mainWindow: BrowserWindow): WindowInsets => {
  if (process.platform !== "win32") {
    return ZERO_INSETS;
  }
  if (!mainWindow.isMaximized() || mainWindow.isFullScreen()) {
    return ZERO_INSETS;
  }
  const frame = mainWindow.getFrame();
  const display = findDisplayForFrame(frame);
  const { bounds, workArea } = display;
  if (bounds.width <= 0 || bounds.height <= 0 || workArea.width <= 0 || workArea.height <= 0) {
    return ZERO_INSETS;
  }
  return {
    top: Math.max(0, Math.round(workArea.y - bounds.y)),
    left: Math.max(0, Math.round(workArea.x - bounds.x)),
    right: Math.max(0, Math.round(bounds.x + bounds.width - (workArea.x + workArea.width))),
    bottom: Math.max(0, Math.round(bounds.y + bounds.height - (workArea.y + workArea.height))),
  };
};

export const DESKTOP_WINDOW_CHROME = {
  titleBarStyle: "hiddenInset" as const,
  trafficLightOffset: { x: 14, y: 14 },
};

export const attachWindowControls = (mainWindow: BrowserWindow): void => {
  applyDesktopWindowIcon(mainWindow);

  const pushWindowState = () => {
    let maximized = false;
    let insets = ZERO_INSETS;
    try {
      maximized = mainWindow.isMaximized();
      insets = resolveMaximizedWorkAreaInsets(mainWindow);
    } catch {
      return;
    }
    const payload = JSON.stringify({
      kind: "window-state",
      maximized,
      insets,
    });
    mainWindow.webview?.executeJavascript(`window.__scuttleDesktopEmit?.(${payload});`);
  };

  mainWindow.on("resize", () => {
    pushWindowState();
  });

  mainWindow.on("move", () => {
    pushWindowState();
  });

  mainWindow.webview?.on("dom-ready", () => {
    pushWindowState();
  });

  Electrobun.events.on(`host-message-${mainWindow.webviewId}`, (event: unknown) => {
    const detail = (event as { readonly data?: { readonly detail?: unknown } } | null)?.data
      ?.detail;
    const command = parseHostCommand(detail);
    if (command === null) return;

    switch (command.kind) {
      case "window.minimize":
        mainWindow.minimize();
        break;
      case "window.toggleMaximize":
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
        pushWindowState();
        setTimeout(pushWindowState, 60);
        break;
      case "window.close":
        mainWindow.requestClose();
        break;
      case "window.sync":
        pushWindowState();
        break;
      case "open-external":
        Utils.openExternal(command.url);
        break;
    }
  });
};

import { dlopen, FFIType, type Pointer, ptr } from "bun:ffi";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { BrowserWindow } from "electrobun/bun";

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x00000010;
const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const GCLP_HICON = -14;
const GCLP_HICONSM = -34;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXSMICON = 49;
const SM_CYSMICON = 50;

const toUtf16NullTerminated = (value: string): Uint8Array => Buffer.from(`${value}\0`, "utf16le");

export const resolveDesktopIconPath = (platform: NodeJS.Platform): string | null => {
  const execDir = NodePath.dirname(process.execPath);
  const candidates =
    platform === "win32"
      ? [
          NodePath.resolve(execDir, "../Resources/app.ico"),
          NodePath.resolve(import.meta.dir, "../../../app.ico"),
          NodePath.resolve(import.meta.dir, "../../assets/icon.ico"),
          NodePath.resolve(process.cwd(), "../Resources/app.ico"),
          NodePath.resolve(process.cwd(), "assets/icon.ico"),
        ]
      : platform === "linux"
        ? [
            NodePath.resolve(execDir, "../Resources/app.png"),
            NodePath.resolve(execDir, "../Resources/appIcon.png"),
            NodePath.resolve(import.meta.dir, "../../assets/icon.png"),
            NodePath.resolve(process.cwd(), "assets/icon.png"),
          ]
        : [];

  for (const candidate of candidates) {
    if (NodeFS.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

export const initDesktopAppIdentity = (appUserModelId: string): void => {
  if (process.platform !== "win32" || appUserModelId.trim().length === 0) {
    return;
  }
  try {
    const shell32 = dlopen("shell32.dll", {
      SetCurrentProcessExplicitAppUserModelID: {
        args: [FFIType.ptr],
        returns: FFIType.i32,
      },
    });
    const wide = toUtf16NullTerminated(appUserModelId);
    shell32.symbols.SetCurrentProcessExplicitAppUserModelID(ptr(wide));
  } catch {
    // Non-fatal if shell32 is unavailable.
  }
};

type NativeHandle = Pointer | bigint;

let cachedWinIcons: {
  readonly path: string;
  readonly hBig: NativeHandle | null;
  readonly hSmall: NativeHandle | null;
} | null = null;

const applyWindowsIconsToHwnds = (iconPath: string, hintPtr: NativeHandle | null): boolean => {
  const user32 = dlopen("user32.dll", {
    GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    LoadImageW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32],
      returns: FFIType.ptr,
    },
    IsWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    FindWindowExW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    SendMessageW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr],
      returns: FFIType.i64,
    },
    SetClassLongPtrW: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.ptr,
    },
  });
  const kernel32 = dlopen("kernel32.dll", {
    GetCurrentProcessId: { args: [], returns: FFIType.u32 },
  });

  if (cachedWinIcons === null || cachedWinIcons.path !== iconPath) {
    const cxBig = user32.symbols.GetSystemMetrics(SM_CXICON) || 32;
    const cyBig = user32.symbols.GetSystemMetrics(SM_CYICON) || 32;
    const cxSmall = user32.symbols.GetSystemMetrics(SM_CXSMICON) || 16;
    const cySmall = user32.symbols.GetSystemMetrics(SM_CYSMICON) || 16;
    const widePath = toUtf16NullTerminated(iconPath);
    const pathPtr = ptr(widePath);
    cachedWinIcons = {
      path: iconPath,
      hBig: user32.symbols.LoadImageW(null, pathPtr, IMAGE_ICON, cxBig, cyBig, LR_LOADFROMFILE),
      hSmall: user32.symbols.LoadImageW(
        null,
        pathPtr,
        IMAGE_ICON,
        cxSmall,
        cySmall,
        LR_LOADFROMFILE,
      ),
    };
  }
  const icons = cachedWinIcons;
  if (icons.hBig === null && icons.hSmall === null) {
    return false;
  }

  const hwnds = new Set<NativeHandle>();
  if (hintPtr !== null && user32.symbols.IsWindow(hintPtr) !== 0) {
    hwnds.add(hintPtr);
  }

  const currentPid = kernel32.symbols.GetCurrentProcessId();
  const pidBuf = new Uint32Array(1);
  const pidPtr = ptr(pidBuf);
  let cursor: NativeHandle | null = null;
  for (let i = 0; i < 4096; i += 1) {
    const next = user32.symbols.FindWindowExW(null, cursor, null, null);
    if (next === null) break;
    cursor = next;
    pidBuf[0] = 0;
    user32.symbols.GetWindowThreadProcessId(next, pidPtr);
    if (pidBuf[0] === currentPid) {
      hwnds.add(next);
    }
  }

  if (hwnds.size === 0) {
    return false;
  }

  for (const hwnd of hwnds) {
    if (icons.hBig !== null) {
      user32.symbols.SendMessageW(hwnd, WM_SETICON, ICON_BIG, icons.hBig);
      user32.symbols.SetClassLongPtrW(hwnd, GCLP_HICON, icons.hBig);
    }
    if (icons.hSmall !== null) {
      user32.symbols.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, icons.hSmall);
      user32.symbols.SetClassLongPtrW(hwnd, GCLP_HICONSM, icons.hSmall);
    }
  }
  return true;
};

const applyLinuxWindowIcon = (iconPath: string, winPtr: Pointer | null): void => {
  if (winPtr === null) return;
  const candidates = [
    NodePath.join(process.cwd(), "libNativeWrapper.so"),
    NodePath.join(NodePath.dirname(process.execPath), "libNativeWrapper.so"),
  ];
  for (const libPath of candidates) {
    if (!NodeFS.existsSync(libPath)) continue;
    try {
      const lib = dlopen(libPath, {
        setWindowIcon: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
      });
      lib.symbols.setWindowIcon(winPtr, Buffer.from(`${iconPath}\0`, "utf8"));
      return;
    } catch {
      // Try next candidate.
    }
  }
};

export const applyDesktopWindowIcon = (mainWindow: BrowserWindow): void => {
  if (process.platform !== "win32" && process.platform !== "linux") {
    return;
  }
  const iconPath = resolveDesktopIconPath(process.platform);
  if (iconPath === null) {
    return;
  }

  const run = () => {
    try {
      const winPtr = mainWindow.ptr;
      if (process.platform === "win32") {
        applyWindowsIconsToHwnds(iconPath, winPtr);
      } else {
        applyLinuxWindowIcon(iconPath, winPtr);
      }
    } catch {
      // Never crash startup over icon decoration.
    }
  };

  run();
  if (process.platform === "win32") {
    setTimeout(run, 150);
    setTimeout(run, 600);
  }
};

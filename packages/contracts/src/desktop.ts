import * as Schema from "effect/Schema";

export const DesktopPlatform = Schema.Literals(["darwin", "linux", "win32"]);
export type DesktopPlatform = typeof DesktopPlatform.Type;

export const DesktopInfo = Schema.Struct({
  platform: DesktopPlatform,
  appVersion: Schema.String,
  serverUrl: Schema.String,
});
export type DesktopInfo = typeof DesktopInfo.Type;

export interface DesktopWindowInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface DesktopWindowState {
  readonly maximized: boolean;
  readonly insets: DesktopWindowInsets;
}

export interface DesktopBridge {
  readonly getDesktopInfo: () => Promise<DesktopInfo>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly minimizeWindow?: () => Promise<void>;
  readonly toggleMaximizeWindow?: () => Promise<void>;
  readonly closeWindow?: () => Promise<void>;
  readonly getWindowState?: () => Promise<DesktopWindowState>;
  readonly onWindowStateChange?: (listener: (state: DesktopWindowState) => void) => () => void;
}

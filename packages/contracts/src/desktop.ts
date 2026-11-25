import * as Schema from "effect/Schema";

export const DesktopPlatform = Schema.Literals(["darwin", "linux", "win32"]);
export type DesktopPlatform = typeof DesktopPlatform.Type;

export const DesktopInfo = Schema.Struct({
  platform: DesktopPlatform,
  appVersion: Schema.String,
  serverUrl: Schema.String,
});
export type DesktopInfo = typeof DesktopInfo.Type;

export interface DesktopBridge {
  readonly getDesktopInfo: () => Promise<DesktopInfo>;
  readonly openExternal: (url: string) => Promise<void>;
}

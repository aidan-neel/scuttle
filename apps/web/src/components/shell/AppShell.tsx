import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, animate, motion, MotionConfig, useMotionValue } from "motion/react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { SkulletProvider } from "skullet/react";
import { useTheme } from "@/components/settings/preferences.ts";
import { DEFAULT_SECTION, parseSectionId } from "@/components/settings/sections.ts";
import { ScuttleLogo, ScuttleMark } from "@/components/ui/ScuttleLogo.tsx";
import { easeOut, spring } from "@/lib/motion";
import { isSoftwareRenderer } from "@/lib/renderMode.ts";
import {
  clampSidebarWidth,
  readSidebarWidth,
  SIDEBAR,
  writeSidebarWidth,
} from "@/lib/sidebarWidth.ts";
import { remToPx } from "@/lib/uiScale.ts";
import { useServerConnection } from "@/lib/useServerConnection.ts";
import { useWorkspaceSelector, WorkspaceProvider } from "@/lib/workspace.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { DesktopDragStrip, useDesktopChrome, WindowControls } from "./WindowControls.tsx";
import { WorkspaceHeaderProvider } from "./WorkspaceHeaderContext.tsx";
import { WorkspaceTabBar } from "./WorkspaceTabBar.tsx";

export const COMPOSER_ID = "composer-prompt";

const RAIL_WIDTH_REM = 2.75;

function WorkspaceBootSplash() {
  const loading = useWorkspaceSelector((s) => s.loading);
  const software = isSoftwareRenderer();

  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          role="status"
          aria-label="Loading workspace"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: easeOut }}
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-canvas"
        >
          <ScuttleMark
            className={
              software ? "size-11 opacity-90" : "size-11 animate-pulse motion-reduce:animate-none"
            }
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const connection = useServerConnection();
  const theme = useTheme();
  const desktopChrome = useDesktopChrome();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const isSettings =
    location.pathname === "/settings" || location.pathname.startsWith("/settings/");
  const [tabBarVisible, setTabBarVisible] = useState(false);
  const hasRouteHeader =
    tabBarVisible ||
    location.pathname.startsWith("/threads/") ||
    location.pathname.startsWith("/agents/") ||
    location.pathname === "/issues";
  const settingsPathSegment = location.pathname.startsWith("/settings/")
    ? location.pathname.slice("/settings/".length).split("/")[0]
    : undefined;
  const settingsSection = parseSectionId(settingsPathSegment) ?? DEFAULT_SECTION;

  const { insets } = desktopChrome.windowState;
  const chromeStyle = {
    "--desktop-controls-inset": desktopChrome.showWindowControls ? "9.125rem" : "0px",
    "--desktop-controls-top-inset": desktopChrome.showWindowControls ? "2.75rem" : "0px",
    "--desktop-mac-top-inset": desktopChrome.isMacInset ? "32px" : "0px",
    ...(insets.top > 0 ? { paddingTop: `${insets.top}px` } : {}),
    ...(insets.right > 0 ? { paddingRight: `${insets.right}px` } : {}),
    ...(insets.bottom > 0 ? { paddingBottom: `${insets.bottom}px` } : {}),
    ...(insets.left > 0 ? { paddingLeft: `${insets.left}px` } : {}),
  } as CSSProperties;

  const [lastAppPath, setLastAppPath] = useState("/");
  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) {
      setLastAppPath(location.pathname);
    }
  }, [location.pathname]);

  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(readSidebarWidth);
  const frameWidth = useMotionValue(width);
  const contentWidth = useMotionValue(width);

  const toggle = (next: boolean) => {
    setOpen(next);
    void animate(frameWidth, next ? width : remToPx(RAIL_WIDTH_REM), spring.snappy);
  };

  const resize = (next: number) => {
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    frameWidth.set(clamped);
    contentWidth.set(clamped);
  };

  const resetWidth = () => {
    resize(SIDEBAR.initial);
    writeSidebarWidth(SIDEBAR.initial);
  };

  const newThread = () => {
    void navigate({ to: "/" }).then(() => document.getElementById(COMPOSER_ID)?.focus());
  };

  return (
    <MotionConfig reducedMotion="user">
      <SkulletProvider
        mode={theme.appearance}
        reveal="smart"
        theme={{
          dark: {
            base: "rgb(255 255 255 / 0.07)",
            highlight: "rgb(255 255 255 / 0.15)",
          },
          light: {
            base: "rgb(15 23 42 / 0.06)",
            highlight: "rgb(15 23 42 / 0.12)",
          },
          radius: "0.375rem",
          animation: isSoftwareRenderer() ? "none" : "shimmer",
          speed: "slow",
        }}
      >
        <WorkspaceProvider>
          <WorkspaceHeaderProvider>
            <div style={chromeStyle} className="flex h-dvh bg-chrome text-fg">
              <motion.aside
                style={{ width: frameWidth }}
                className="relative z-10 hidden shrink-0 overflow-x-clip bg-sidebar shadow-sidebar md:block"
              >
                <Sidebar
                  connection={connection}
                  open={open}
                  contentWidth={contentWidth}
                  isSettings={isSettings}
                  settingsSection={settingsSection}
                  backTo={lastAppPath}
                  onCollapse={() => toggle(false)}
                  onExpand={() => toggle(true)}
                  onNewThread={newThread}
                />
                {open && (
                  <ResizeHandle
                    width={width}
                    onResize={resize}
                    onResizeEnd={() => writeSidebarWidth(frameWidth.get())}
                    onReset={resetWidth}
                  />
                )}
              </motion.aside>
              <main className="relative flex min-w-0 flex-1 flex-col">
                {desktopChrome.showWindowControls && (
                  <WindowControls maximized={desktopChrome.windowState.maximized} />
                )}
                {!isSettings && (
                  <div className="desktop-drag relative z-10 flex h-11 shrink-0 items-center bg-sidebar pr-[calc(0.5rem+var(--desktop-controls-inset))] pl-2 shadow-[inset_0_-1px_0_rgb(0_0_0/55%),0_1px_0_var(--color-edge)] md:hidden">
                    <Link
                      to="/"
                      className="flex h-9 items-center rounded-control px-2 outline-none focus-visible:shadow-focus"
                    >
                      <ScuttleLogo className="text-fg" />
                    </Link>
                  </div>
                )}
                <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
                  <WorkspaceTabBar
                    pathname={location.pathname}
                    onNewThread={newThread}
                    onVisibilityChange={setTabBarVisible}
                  />
                  {desktopChrome.isDesktop && !hasRouteHeader && <DesktopDragStrip />}
                  {children}
                  <WorkspaceBootSplash />
                </div>
              </main>
            </div>
          </WorkspaceHeaderProvider>
        </WorkspaceProvider>
      </SkulletProvider>
    </MotionConfig>
  );
}

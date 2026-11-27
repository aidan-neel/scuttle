import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { animate, motion, MotionConfig, useMotionValue } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { DEFAULT_SECTION, parseSectionId } from "@/components/settings/sections.ts";
import { ScuttleLogo } from "@/components/ui/ScuttleLogo.tsx";
import { spring } from "@/lib/motion";
import {
  clampSidebarWidth,
  readSidebarWidth,
  SIDEBAR,
  writeSidebarWidth,
} from "@/lib/sidebarWidth.ts";
import { useServerConnection } from "@/lib/useServerConnection.ts";
import { WorkspaceProvider } from "@/lib/workspace.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { Sidebar } from "./Sidebar.tsx";

export const COMPOSER_ID = "composer-prompt";

const RAIL_WIDTH = 44;

export function AppShell({ children }: { children: ReactNode }) {
  const connection = useServerConnection();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const isSettings = location.pathname === "/settings";
  const settingsSection =
    parseSectionId(
      typeof location.search === "object" &&
        location.search !== null &&
        "section" in location.search
        ? location.search.section
        : undefined,
    ) ?? DEFAULT_SECTION;

  const [lastAppPath, setLastAppPath] = useState("/");
  useEffect(() => {
    if (location.pathname !== "/settings") {
      setLastAppPath(location.pathname);
    }
  }, [location.pathname]);

  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(readSidebarWidth);
  const frameWidth = useMotionValue(width);
  const contentWidth = useMotionValue(width);

  const toggle = (next: boolean) => {
    setOpen(next);
    void animate(frameWidth, next ? width : RAIL_WIDTH, spring.snappy);
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
      <WorkspaceProvider>
        <div className="flex h-dvh bg-chrome text-fg">
          <motion.aside
            style={{ width: frameWidth }}
            className="relative hidden shrink-0 overflow-x-clip md:block"
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
          <main className="flex min-w-0 flex-1 flex-col p-2 md:pl-0">
            {!isSettings && (
              <Link
                to="/"
                className="mb-2 flex h-9 items-center self-start rounded-control px-2 outline-none focus-visible:shadow-focus md:hidden"
              >
                <ScuttleLogo className="text-fg" />
              </Link>
            )}
            <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-canvas bg-canvas shadow-canvas">
              {children}
            </div>
          </main>
        </div>
      </WorkspaceProvider>
    </MotionConfig>
  );
}

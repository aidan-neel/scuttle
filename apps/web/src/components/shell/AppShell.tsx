import { PencilEdit02Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { animate, AnimatePresence, motion, MotionConfig, useMotionValue } from "motion/react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
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

export function AppShell({ children }: { children: ReactNode }) {
  const connection = useServerConnection();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(readSidebarWidth);
  const frameWidth = useMotionValue(width);
  const contentWidth = useMotionValue(width);

  const toggle = (next: boolean) => {
    setOpen(next);
    void animate(frameWidth, next ? width : SIDEBAR.collapsed, spring.smooth);
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
              onCollapse={() => toggle(false)}
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
            <Link
              to="/"
              className="mb-2 flex h-9 items-center self-start rounded-control px-2 outline-none focus-visible:shadow-focus md:hidden"
            >
              <span className="text-[14px] font-semibold tracking-tight">Scuttle</span>
            </Link>
            <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-canvas bg-canvas shadow-canvas">
              <AnimatePresence>
                {!open && (
                  <motion.div
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0, transition: { ...spring.smooth, delay: 0.08 } }}
                    exit={{ opacity: 0, x: -6, transition: { duration: 0.12 } }}
                    className="absolute top-2.5 left-2.5 z-10 hidden items-center gap-0.5 md:flex"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Expand sidebar"
                      onClick={() => toggle(true)}
                    >
                      <Icon icon={SidebarLeftIcon} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="New thread" onClick={newThread}>
                      <Icon icon={PencilEdit02Icon} />
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {children}
            </div>
          </main>
        </div>
      </WorkspaceProvider>
    </MotionConfig>
  );
}

import {
  ArrowLeft02Icon,
  CheckListIcon,
  PencilEdit02Icon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import type { ConnectionState } from "@scuttle/client-runtime";
import type { ProjectId } from "@scuttle/shared/ids";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, type MotionValue } from "motion/react";
import { useRef, useState } from "react";
import type { SectionId } from "@/components/settings/sections.ts";
import { SettingsSidebarNav } from "@/components/settings/SettingsNav.tsx";
import { Button, buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ScuttleLogo } from "@/components/ui/ScuttleLogo.tsx";
import { easeOut } from "@/lib/motion";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { AgentList } from "./AgentList.tsx";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { CreateAgentDialog } from "./CreateAgentDialog.tsx";
import { SearchDialog } from "./SearchDialog.tsx";
import { type SettledNotice, SettleToast } from "./SettleToast.tsx";
import { ThreadList } from "./ThreadList.tsx";

interface SidebarProps {
  readonly connection: ConnectionState;
  readonly open: boolean;
  readonly contentWidth: MotionValue<number>;
  readonly isSettings: boolean;
  readonly settingsSection: SectionId;
  readonly backTo: string;
  readonly onCollapse: () => void;
  readonly onExpand: () => void;
  readonly onNewThread: () => void;
}

export function Sidebar({
  connection,
  open,
  contentWidth,
  isSettings,
  settingsSection,
  backTo,
  onCollapse,
  onExpand,
  onNewThread,
}: SidebarProps) {
  const projects = useWorkspaceSelector((s) => s.projects);
  const needsYouCount = useWorkspaceSelector(
    (s) => s.issues.filter((issue) => issue.state === "needs_you").length,
  );
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isIssues = pathname === "/issues";
  const { settleThread } = useWorkspaceActions();
  const navigate = useNavigate();
  const [projectFilter, setProjectFilter] = useState<ProjectId | null>(null);
  const filterProjectId = projects.some((project) => project.id === projectFilter)
    ? projectFilter
    : null;
  const [notice, setNotice] = useState<SettledNotice | null>(null);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  const leaveSettings = () => {
    void navigate({ to: backTo });
  };

  return (
    <>
      <motion.div
        inert={!open}
        animate={{ opacity: open ? 1 : 0, x: open ? 0 : -8 }}
        transition={{ duration: open ? 0.14 : 0.09, ease: easeOut }}
        style={{ width: contentWidth }}
        className="flex h-full shrink-0 flex-col px-2 pt-[var(--desktop-mac-top-inset)] pb-3"
      >
        {isSettings ? (
          <div className="desktop-drag flex h-11 shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={leaveSettings}
              className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-row px-2 text-left text-[0.9375rem] font-medium tracking-tight text-fg-secondary outline-none transition-colors duration-(--dur-hover) ease-hover hover:bg-(--wash) hover:text-fg focus-visible:shadow-focus"
            >
              <Icon icon={ArrowLeft02Icon} className="size-4 shrink-0" />
              <span className="truncate">Settings</span>
            </button>
            <Button variant="ghost" size="icon" aria-label="Collapse sidebar" onClick={onCollapse}>
              <Icon icon={SidebarLeftIcon} />
            </Button>
          </div>
        ) : (
          <div className="desktop-drag flex h-11 shrink-0 items-center gap-1 pr-1 pl-2">
            <Link
              to="/"
              className="flex items-center rounded-control outline-none focus-visible:shadow-focus"
            >
              <ScuttleLogo className="text-fg" />
            </Link>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search (Ctrl+K)"
              onClick={() => setSearchOpen(true)}
            >
              <Icon icon={Search01Icon} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="New thread" onClick={onNewThread}>
              <Icon icon={PencilEdit02Icon} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Collapse sidebar" onClick={onCollapse}>
              <Icon icon={SidebarLeftIcon} />
            </Button>
          </div>
        )}

        {isSettings ? (
          <div className="mt-0.5 flex min-h-0 flex-1 flex-col">
            <SettingsSidebarNav active={settingsSection} />
          </div>
        ) : (
          <div className="relative mt-5 flex min-h-0 flex-1 flex-col">
            <nav
              ref={navRef}
              aria-label="Workspace"
              className="scrollbar-none flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pt-2 pb-6"
            >
              <AgentList
                filterProjectId={filterProjectId}
                onFilterChange={setProjectFilter}
                onCreateAgent={() => setCreateAgentOpen(true)}
              />
              <ThreadList
                filterProjectId={filterProjectId}
                onFilterChange={setProjectFilter}
                onNewThread={onNewThread}
                onSettled={setNotice}
                scrollRef={navRef}
              />
            </nav>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-sidebar to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-sidebar to-transparent"
            />
          </div>
        )}

        <div className="relative mt-2">
          <SettleToast
            notice={notice}
            onUndo={(id) => {
              void settleThread(id, false);
              setNotice(null);
            }}
            onDismiss={() => setNotice(null)}
          />
        </div>

        <div className="mt-2 flex h-9 items-center gap-2 pr-1 pl-2">
          <span className="grid size-6 place-items-center rounded-chip bg-avatar text-meta font-medium text-on-avatar">
            S
          </span>
          <ConnectionStatus connection={connection} />
          <Link
            to="/issues"
            aria-label="Issues"
            title={needsYouCount > 0 ? `Issues (${needsYouCount} need you)` : "Issues"}
            className={buttonClass(
              "ghost",
              "icon",
              isIssues ? "relative bg-fg/7 text-fg" : "relative",
            )}
          >
            <Icon icon={CheckListIcon} />
            {needsYouCount > 0 && (
              <span className="absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-danger px-0.5 font-mono text-[0.5625rem] leading-none font-semibold text-white">
                {needsYouCount > 9 ? "9+" : needsYouCount}
              </span>
            )}
          </Link>
          {isSettings ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close settings"
              onClick={leaveSettings}
              className="bg-fg/7 text-fg"
            >
              <Icon icon={Settings01Icon} />
            </Button>
          ) : (
            <Link
              to="/settings/$section"
              params={{ section: "general" }}
              aria-label="Settings"
              className={buttonClass("ghost", "icon", "group/settings")}
            >
              <Icon
                icon={Settings01Icon}
                className="transition-transform duration-500 ease-out-quint group-hover/settings:rotate-45"
              />
            </Link>
          )}
        </div>
      </motion.div>

      <motion.div
        inert={open}
        initial={false}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{ duration: 0.12, ease: easeOut, delay: open ? 0 : 0.04 }}
        className={`absolute inset-y-0 left-0 z-30 flex w-11 flex-col items-center gap-1 pt-[calc(0.375rem+var(--desktop-mac-top-inset))] pb-4 ${open ? "pointer-events-none" : ""}`}
      >
        <Button variant="ghost" size="icon" aria-label="Expand sidebar" onClick={onExpand}>
          <Icon icon={SidebarLeftIcon} />
        </Button>
        {isSettings ? (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={leaveSettings}>
            <Icon icon={ArrowLeft02Icon} />
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="icon" aria-label="New thread" onClick={onNewThread}>
              <Icon icon={PencilEdit02Icon} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search (Ctrl+K)"
              onClick={() => setSearchOpen(true)}
            >
              <Icon icon={Search01Icon} />
            </Button>
            <Link
              to="/issues"
              aria-label="Issues"
              title={needsYouCount > 0 ? `Issues (${needsYouCount} need you)` : "Issues"}
              className={buttonClass(
                "ghost",
                "icon",
                isIssues ? "relative bg-fg/7 text-fg" : "relative",
              )}
            >
              <Icon icon={CheckListIcon} />
              {needsYouCount > 0 && (
                <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-danger" />
              )}
            </Link>
          </>
        )}
        {isSettings ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close settings"
            onClick={leaveSettings}
            className="mt-auto bg-fg/7 text-fg"
          >
            <Icon icon={Settings01Icon} />
          </Button>
        ) : (
          <Link
            to="/settings/$section"
            params={{ section: "general" }}
            aria-label="Settings"
            className={buttonClass("ghost", "icon", "group/settings mt-auto")}
          >
            <Icon
              icon={Settings01Icon}
              className="transition-transform duration-500 ease-out-quint group-hover/settings:rotate-45"
            />
          </Link>
        )}
      </motion.div>

      <CreateAgentDialog open={createAgentOpen} onOpenChange={setCreateAgentOpen} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

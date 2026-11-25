import {
  PencilEdit02Icon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import type { ConnectionState } from "@scuttle/client-runtime";
import type { ProjectId } from "@scuttle/shared/ids";
import { Link } from "@tanstack/react-router";
import { motion, type MotionValue } from "motion/react";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";
import { AddProjectDialog } from "./AddProjectDialog.tsx";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { ProjectList } from "./ProjectList.tsx";
import { SearchDialog } from "./SearchDialog.tsx";
import { type SettledNotice, SettleToast } from "./SettleToast.tsx";
import { ThreadList } from "./ThreadList.tsx";

interface SidebarProps {
  readonly connection: ConnectionState;
  readonly open: boolean;
  readonly contentWidth: MotionValue<number>;
  readonly onCollapse: () => void;
  readonly onExpand: () => void;
  readonly onNewThread: () => void;
}

export function Sidebar({
  connection,
  open,
  contentWidth,
  onCollapse,
  onExpand,
  onNewThread,
}: SidebarProps) {
  const { projects, settleThread } = useWorkspace();
  const [projectFilter, setProjectFilter] = useState<ProjectId | null>(null);
  const filterProjectId = projects.some((project) => project.id === projectFilter)
    ? projectFilter
    : null;
  const [notice, setNotice] = useState<SettledNotice | null>(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <motion.div
        inert={!open}
        animate={{ opacity: open ? 1 : 0, x: open ? 0 : -12 }}
        transition={{ duration: open ? 0.25 : 0.15, ease: easeOut }}
        style={{ width: contentWidth }}
        className="flex h-full shrink-0 flex-col px-2 py-3"
      >
        <div className="flex h-9 items-center gap-1 pr-1 pl-2">
          <Link
            to="/"
            className="flex flex-1 items-center rounded-control outline-none focus-visible:shadow-focus"
          >
            <span className="text-[14px] font-semibold tracking-tight text-fg">Scuttle</span>
          </Link>
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

        <nav
          aria-label="Workspace"
          className="scrollbar-none mt-5 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto mask-[linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-24px),transparent)]"
        >
          <ProjectList
            filterProjectId={filterProjectId}
            onFilterChange={setProjectFilter}
            onAddProject={() => setAddProjectOpen(true)}
          />
          <ThreadList
            filterProjectId={filterProjectId}
            onFilterChange={setProjectFilter}
            onNewThread={onNewThread}
            onSettled={setNotice}
          />
        </nav>

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

        <div className="mt-2 flex h-9 items-center gap-2.5 pr-1 pl-2">
          <span className="grid size-6 place-items-center rounded-chip bg-avatar text-meta font-medium text-on-avatar">
            S
          </span>
          <ConnectionStatus connection={connection} />
          <Link
            to="/settings"
            aria-label="Settings"
            className={buttonClass("ghost", "icon", "group/settings")}
          >
            <Icon
              icon={Settings01Icon}
              className="transition-transform duration-500 ease-out-quint group-hover/settings:rotate-45"
            />
          </Link>
        </div>
      </motion.div>

      <motion.div
        inert={open}
        initial={false}
        animate={{ opacity: open ? 0 : 1 }}
        transition={{ duration: 0.18, ease: easeOut, delay: open ? 0 : 0.1 }}
        className={`absolute inset-y-0 left-0 z-30 flex w-11 flex-col items-center gap-1 py-4 ${open ? "pointer-events-none" : ""}`}
      >
        <Button variant="ghost" size="icon" aria-label="Expand sidebar" onClick={onExpand}>
          <Icon icon={SidebarLeftIcon} />
        </Button>
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
          to="/settings"
          aria-label="Settings"
          className={buttonClass("ghost", "icon", "group/settings mt-auto")}
        >
          <Icon
            icon={Settings01Icon}
            className="transition-transform duration-500 ease-out-quint group-hover/settings:rotate-45"
          />
        </Link>
      </motion.div>

      <AddProjectDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

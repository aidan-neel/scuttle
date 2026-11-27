import { ContextMenu } from "@base-ui/react/context-menu";
import {
  ArrowRight01Icon,
  Delete02Icon,
  Message01Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import type { Thread } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { ContextMenuItem, ContextMenuPopup, ContextMenuSeparator } from "@/components/ui/Menu.tsx";
import { SwapText } from "@/components/ui/SwapText.tsx";
import { easeOut, spring } from "@/lib/motion";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";

export function SettledSection({ projectId }: { readonly projectId: ProjectId | null }) {
  const threads = useWorkspaceSelector((s) => s.threads);
  const agentThreadIds = useWorkspaceSelector((s) => s.agentThreadIds);
  const { settleThread, deleteThread } = useWorkspaceActions();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const done = threads.filter(
    (thread) =>
      thread.settledAt !== undefined &&
      !agentThreadIds.has(thread.id) &&
      (projectId === null || thread.projectId === projectId),
  );

  return (
    <>
      {done.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex h-7 w-full items-center gap-1.5 rounded-chip pr-2 pl-2 text-left text-label text-fg-muted outline-none transition-colors duration-100 ease-out hover:text-fg-secondary focus-visible:shadow-focus"
          >
            <span>Settled</span>
            <SwapText swapKey={done.length} className="tabular-nums">
              {done.length}
            </SwapText>
            <Icon
              icon={ArrowRight01Icon}
              className={`size-3 transition-transform duration-150 ease-out ${expanded ? "rotate-90" : ""}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1, transition: spring.smooth }}
                exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: easeOut } }}
                className="scrollbar-none flex max-h-56 flex-col gap-px overflow-y-auto"
              >
                {done.map((thread) => {
                  const openThread = () =>
                    void navigate({ to: "/threads/$threadId", params: { threadId: thread.id } });
                  return (
                    <li key={thread.id}>
                      <ContextMenu.Root>
                        <ContextMenu.Trigger className="group/settled flex items-center gap-1 rounded-chip pr-1 pl-2 transition-colors duration-100 hover:bg-white/4">
                          <button
                            type="button"
                            onClick={openThread}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-chip py-1.5 text-left outline-none focus-visible:shadow-focus"
                          >
                            <Identicon name={thread.projectName} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-label text-fg-secondary">
                              {thread.title}
                            </span>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Unsettle ${thread.title}`}
                            onClick={() => void settleThread(thread.id, false)}
                            className="opacity-0 transition-opacity duration-150 ease-out group-hover/settled:opacity-100 focus-visible:opacity-100"
                          >
                            <Icon icon={Undo02Icon} />
                          </Button>
                        </ContextMenu.Trigger>
                        <ContextMenuPopup label={`${thread.title} actions`}>
                          <ContextMenuItem onClick={openThread}>
                            <Icon icon={Message01Icon} className="text-fg-muted" />
                            Open thread
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => void settleThread(thread.id, false)}>
                            <Icon icon={Undo02Icon} className="text-fg-muted" />
                            Unsettle thread
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem danger onClick={() => setDeleting(thread)}>
                            <Icon icon={Delete02Icon} />
                            Delete thread
                          </ContextMenuItem>
                        </ContextMenuPopup>
                      </ContextMenu.Root>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete thread?"
        description={`“${deleting?.title ?? "This thread"}” and its conversation history will be permanently deleted.`}
        confirmLabel="Delete thread"
        onConfirm={async () => {
          if (deleting === null) return;
          await deleteThread(deleting.id);
          if (pathname === `/threads/${deleting.id}`) void navigate({ to: "/" });
        }}
      />
    </>
  );
}

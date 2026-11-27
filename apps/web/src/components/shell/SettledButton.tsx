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
import { type MouseEvent, type TouchEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { ContextMenuItem, ContextMenuPopup, ContextMenuSeparator } from "@/components/ui/Menu.tsx";
import { SwapText } from "@/components/ui/SwapText.tsx";
import { remToPx } from "@/lib/uiScale.ts";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { useListWindow } from "./useListWindow.ts";

const SETTLED_ROW_HEIGHT_REM = 2;

const resolveThreadId = (target: EventTarget | null) =>
  target instanceof Element
    ? (target.closest("[data-thread-id]")?.getAttribute("data-thread-id") ?? null)
    : null;

export function SettledSection({ projectId }: { readonly projectId: ProjectId | null }) {
  const threads = useWorkspaceSelector((s) => s.threads);
  const agentThreadIds = useWorkspaceSelector((s) => s.agentThreadIds);
  const { settleThread, deleteThread } = useWorkspaceActions();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const done = threads.filter(
    (thread) =>
      thread.settledAt !== undefined &&
      !agentThreadIds.has(thread.id) &&
      (projectId === null || thread.projectId === projectId),
  );
  const { startIndex, endIndex, paddingTop, paddingBottom } = useListWindow({
    count: done.length,
    rowStride: remToPx(SETTLED_ROW_HEIGHT_REM) + 1,
    scrollRef,
    listRef,
    overscan: 6,
    enabled: expanded && done.length > 0,
  });
  const visibleDone = done.slice(startIndex, endIndex);
  const menuThread = menuThreadId ? (done.find((t) => t.id === menuThreadId) ?? null) : null;

  const openThreadById = (threadId: Thread["id"]) => {
    void navigate({ to: "/threads/$threadId", params: { threadId } });
  };

  const handleContextMenu = (event: MouseEvent) => {
    setMenuThreadId(resolveThreadId(event.target));
  };

  const handleTouchStart = (event: TouchEvent) => {
    setMenuThreadId(resolveThreadId(event.target));
  };

  const handleMenuOpenChange = (
    nextOpen: boolean,
    details: ContextMenu.Root.ChangeEventDetails,
  ) => {
    if (!nextOpen) {
      setMenuThreadId(null);
      return;
    }
    const targetId = resolveThreadId(details.event.target);
    if (targetId === null) {
      details.cancel();
      return;
    }
    setMenuThreadId(targetId);
  };

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
          {expanded && (
            <ContextMenu.Root onOpenChange={handleMenuOpenChange}>
              <ContextMenu.Trigger
                className="block"
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
              >
                <div ref={scrollRef} className="scrollbar-none max-h-56 overflow-y-auto">
                  <ul
                    ref={listRef}
                    style={{ paddingTop, paddingBottom }}
                    className="flex flex-col gap-px"
                  >
                    {visibleDone.map((thread) => (
                      <li
                        key={thread.id}
                        data-thread-id={thread.id}
                        className="group/settled flex h-8 shrink-0 items-center gap-1 rounded-chip pr-1 pl-2 transition-colors duration-100 hover:bg-fg/4"
                      >
                        <button
                          type="button"
                          onClick={() => openThreadById(thread.id)}
                          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-chip text-left outline-none focus-visible:shadow-focus"
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
                      </li>
                    ))}
                  </ul>
                </div>
              </ContextMenu.Trigger>
              {menuThread !== null && (
                <ContextMenuPopup label={`${menuThread.title} actions`}>
                  <ContextMenuItem onClick={() => openThreadById(menuThread.id)}>
                    <Icon icon={Message01Icon} className="text-fg-muted" />
                    Open thread
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void settleThread(menuThread.id, false)}>
                    <Icon icon={Undo02Icon} className="text-fg-muted" />
                    Unsettle thread
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem danger onClick={() => setDeleting(menuThread)}>
                    <Icon icon={Delete02Icon} />
                    Delete thread
                  </ContextMenuItem>
                </ContextMenuPopup>
              )}
            </ContextMenu.Root>
          )}
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

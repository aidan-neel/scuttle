import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Copy01Icon,
  Delete02Icon,
  Message01Icon,
  StopIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { Thread } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type MouseEvent, type RefObject, type TouchEvent, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ContextMenuItem, ContextMenuPopup, ContextMenuSeparator } from "@/components/ui/Menu.tsx";
import { compareIsoAsc, compareIsoDesc } from "@/lib/collections.ts";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { SectionHeader, type SectionMenuEntry } from "./SectionHeader.tsx";
import { SettledSection } from "./SettledButton.tsx";
import type { SettledNotice } from "./SettleToast.tsx";
import { ThreadRow } from "./ThreadRow.tsx";
import { useListWindow } from "./useListWindow.ts";

type ThreadSort = "recent" | "oldest";

const ROW_STRIDE = 57;

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
] as const satisfies ReadonlyArray<{ value: ThreadSort; label: string }>;

const sortThreads = (threads: ReadonlyArray<Thread>, sort: ThreadSort) =>
  threads.toSorted((a, b) =>
    sort === "oldest"
      ? compareIsoAsc(a.updatedAt, b.updatedAt)
      : compareIsoDesc(a.updatedAt, b.updatedAt),
  );

const resolveThreadId = (target: EventTarget | null) =>
  target instanceof Element
    ? (target.closest("[data-thread-id]")?.getAttribute("data-thread-id") ?? null)
    : null;

interface ThreadListProps {
  readonly filterProjectId: ProjectId | null;
  readonly onFilterChange: (projectId: ProjectId | null) => void;
  readonly onNewThread: () => void;
  readonly onSettled: (notice: SettledNotice) => void;
  readonly scrollRef: RefObject<HTMLElement | null>;
}

export function ThreadList({
  filterProjectId,
  onFilterChange,
  onNewThread,
  onSettled,
  scrollRef,
}: ThreadListProps) {
  const threads = useWorkspaceSelector((s) => s.threads);
  const agentThreadIds = useWorkspaceSelector((s) => s.agentThreadIds);
  const selectedProjectId = useWorkspaceSelector((s) => s.selectedProjectId);
  const { settleThread, deleteThread, interruptTurn } = useWorkspaceActions();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [sort, setSort] = useState<ThreadSort>("recent");
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const open = sortThreads(
    threads.filter(
      (thread) =>
        thread.settledAt === undefined &&
        !agentThreadIds.has(thread.id) &&
        (filterProjectId === null || thread.projectId === filterProjectId),
    ),
    sort,
  );
  const idle = open.filter((thread) => thread.status.kind === "idle");
  const { startIndex, endIndex, paddingTop, paddingBottom } = useListWindow({
    count: open.length,
    rowStride: ROW_STRIDE,
    scrollRef,
    listRef,
    overscan: 8,
  });
  const visibleThreads = open.slice(startIndex, endIndex);
  const menuThread = menuThreadId ? (open.find((t) => t.id === menuThreadId) ?? null) : null;

  const openThreadById = (threadId: Thread["id"]) => {
    void navigate({
      to: "/threads/$threadId",
      params: { threadId },
    });
  };

  const settleThreadRow = (thread: Thread) => {
    void settleThread(thread.id, true);
    onSettled({ id: thread.id, title: thread.title });
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

  const menu: ReadonlyArray<SectionMenuEntry> = [
    { kind: "action", label: "New thread", onSelect: onNewThread },
    { kind: "separator" },
    {
      kind: "toggle",
      label: "Only selected project",
      checked: filterProjectId !== null,
      disabled: filterProjectId === null && selectedProjectId === null,
      onCheckedChange: (checked) => onFilterChange(checked ? selectedProjectId : null),
    },
    {
      kind: "choice",
      label: "Sort by",
      value: sort,
      options: SORT_OPTIONS,
      onValueChange: (value) => setSort(value === "oldest" ? "oldest" : "recent"),
    },
    { kind: "separator" },
    {
      kind: "action",
      label: "Settle all idle threads",
      disabled: idle.length === 0,
      onSelect: () => {
        for (const thread of idle) void settleThread(thread.id, true);
      },
    },
  ];

  const confirmDelete = async () => {
    if (deleting === null) return;
    await deleteThread(deleting.id);
    if (pathname === `/threads/${deleting.id}`) void navigate({ to: "/" });
  };

  const menuRunning =
    menuThread !== null &&
    (menuThread.status.kind === "running" || menuThread.status.kind === "needs-input");

  return (
    <section aria-labelledby="threads-heading">
      <SectionHeader
        id="threads-heading"
        title="Threads"
        addLabel="New thread"
        onAdd={onNewThread}
        menu={menu}
      />
      <ContextMenu.Root onOpenChange={handleMenuOpenChange}>
        <ContextMenu.Trigger
          className="block"
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
        >
          <ul
            ref={listRef}
            style={{ paddingTop, paddingBottom }}
            className="mt-0.5 flex flex-col gap-px"
          >
            {visibleThreads.map((thread) => (
              <li key={thread.id} data-thread-id={thread.id} className="h-[56px]">
                <ThreadRow
                  thread={thread}
                  selected={pathname === `/threads/${thread.id}`}
                  onSelect={openThreadById}
                  onSettle={settleThreadRow}
                />
              </li>
            ))}
            {open.length === 0 && (
              <li className="px-2 py-2 text-label text-fg-muted">
                {filterProjectId === null
                  ? "No active threads. Start one from the composer."
                  : "No active threads in this project."}
              </li>
            )}
          </ul>
        </ContextMenu.Trigger>
        {menuThread !== null && (
          <ContextMenuPopup label={`${menuThread.title} actions`}>
            <ContextMenuItem onClick={() => openThreadById(menuThread.id)}>
              <Icon icon={Message01Icon} className="text-fg-muted" />
              Open thread
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                void navigator.clipboard?.writeText(menuThread.title);
              }}
            >
              <Icon icon={Copy01Icon} className="text-fg-muted" />
              Copy title
            </ContextMenuItem>
            {menuRunning ? (
              <ContextMenuItem onClick={() => void interruptTurn(menuThread.id)}>
                <Icon icon={StopIcon} className="text-fg-muted" />
                Stop turn
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={() => settleThreadRow(menuThread)}>
                <Icon icon={Tick02Icon} className="text-fg-muted" />
                Settle thread
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem danger onClick={() => setDeleting(menuThread)}>
              <Icon icon={Delete02Icon} />
              Delete thread
            </ContextMenuItem>
          </ContextMenuPopup>
        )}
      </ContextMenu.Root>
      <SettledSection projectId={filterProjectId} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete thread?"
        description={`“${deleting?.title ?? "This thread"}” and its conversation history will be permanently deleted.`}
        confirmLabel="Delete thread"
        onConfirm={confirmDelete}
      />
    </section>
  );
}

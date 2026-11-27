import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Copy01Icon,
  Delete02Icon,
  Message01Icon,
  StopIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { DelegationLink, type Thread } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  type MouseEvent,
  type RefObject,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Skeleton } from "skullet/react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ContextMenuItem, ContextMenuPopup, ContextMenuSeparator } from "@/components/ui/Menu.tsx";
import { compareIsoAsc, compareIsoDesc } from "@/lib/collections.ts";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { remToPx } from "@/lib/uiScale.ts";
import { cn } from "@/lib/utils";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { SectionHeader, type SectionMenuEntry } from "./SectionHeader.tsx";
import { SettledSection } from "./SettledButton.tsx";
import type { SettledNotice } from "./SettleToast.tsx";
import { ThreadRow } from "./ThreadRow.tsx";
import { useListWindow } from "./useListWindow.ts";

type ThreadSort = "recent" | "oldest";

const ROW_HEIGHT_REM = 3.5;

const decodeLinks = Schema.decodeUnknownOption(Schema.Array(DelegationLink));

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

const CHILD_DOT: Record<DelegationLink["status"], string> = {
  running: "bg-input",
  waiting_parent: "bg-input",
  completed: "bg-success",
  failed: "bg-danger",
  canceled: "bg-fg-muted/60",
};

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
  const loading = useWorkspaceSelector((s) => s.loading);
  const agentThreadIds = useWorkspaceSelector((s) => s.agentThreadIds);
  const selectedProjectId = useWorkspaceSelector((s) => s.selectedProjectId);
  const { settleThread, deleteThread, interruptTurn } = useWorkspaceActions();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [sort, setSort] = useState<ThreadSort>("recent");
  const [deleting, setDeleting] = useState<Thread | null>(null);
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null);
  const [links, setLinks] = useState<ReadonlyArray<DelegationLink>>([]);
  const [collapsedParents, setCollapsedParents] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLUListElement | null>(null);

  const threadRefreshKey = `${threads.length}:${threads.filter((t) => t.status.kind === "running" || t.status.kind === "needs-input").length}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const bridge = getDesktopBridge();
        const base = bridge === null ? "" : (await bridge.getDesktopInfo()).serverUrl;
        const res = await fetch(`${base}/api/delegations`);
        if (!res.ok || !active) return;
        const decoded = decodeLinks(await res.json());
        if (active && decoded._tag === "Some") {
          setLinks(decoded.value);
        }
      } catch {
        // ignore transient fetch errors
      }
    })();
    return () => {
      active = false;
    };
  }, [threadRefreshKey]);

  const allOpen = sortThreads(
    threads.filter(
      (thread) =>
        thread.settledAt === undefined &&
        !agentThreadIds.has(thread.id) &&
        (filterProjectId === null || thread.projectId === filterProjectId),
    ),
    sort,
  );
  const openById = new Map<string, Thread>();
  for (const thread of allOpen) openById.set(thread.id, thread);

  const childrenByParent = new Map<string, { link: DelegationLink; thread: Thread }[]>();
  const hiddenChildIds = new Set<string>();
  for (const link of links) {
    if (!openById.has(link.parentThreadId)) continue;
    const childThread = openById.get(link.childThreadId);
    if (!childThread) continue;
    hiddenChildIds.add(childThread.id);
    const group = childrenByParent.get(link.parentThreadId) ?? [];
    group.push({ link, thread: childThread });
    childrenByParent.set(link.parentThreadId, group);
  }

  const open = allOpen.filter((thread) => !hiddenChildIds.has(thread.id));
  const hasAnyExpandedChildren = open.some(
    (thread) =>
      (childrenByParent.get(thread.id)?.length ?? 0) > 0 && !collapsedParents.has(thread.id),
  );
  const idle = allOpen.filter((thread) => thread.status.kind === "idle");
  const { startIndex, endIndex, paddingTop, paddingBottom } = useListWindow({
    count: open.length,
    rowStride: remToPx(ROW_HEIGHT_REM) + 1,
    scrollRef,
    listRef,
    overscan: 8,
    enabled: !hasAnyExpandedChildren,
  });
  const visibleThreads = hasAnyExpandedChildren ? open : open.slice(startIndex, endIndex);
  const menuThread = menuThreadId ? (allOpen.find((t) => t.id === menuThreadId) ?? null) : null;

  const openThreadById = (threadId: Thread["id"]) => {
    void navigate({ to: "/threads/$threadId", params: { threadId } });
  };

  const toggleParentExpanded = (parentId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
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
            style={{
              paddingTop: hasAnyExpandedChildren ? 0 : paddingTop,
              paddingBottom: hasAnyExpandedChildren ? 0 : paddingBottom,
            }}
            className="mt-0.5 flex flex-col gap-px"
          >
            {visibleThreads.map((thread) => {
              const children = childrenByParent.get(thread.id) ?? [];
              const expanded = children.length > 0 && !collapsedParents.has(thread.id);
              const runningChildren = children.filter(
                (c) =>
                  c.thread.status.kind === "running" ||
                  c.link.status === "running" ||
                  c.link.status === "waiting_parent",
              ).length;
              return (
                <li
                  key={thread.id}
                  data-thread-id={thread.id}
                  className={children.length > 0 ? undefined : "h-14"}
                >
                  <ThreadRow
                    thread={thread}
                    selected={pathname === `/threads/${thread.id}`}
                    onSelect={openThreadById}
                    onSettle={settleThreadRow}
                    subagentCount={children.length}
                    subagentRunningCount={runningChildren}
                    subagentsExpanded={expanded}
                    onToggleSubagents={() => toggleParentExpanded(thread.id)}
                  />
                  {expanded && (
                    <ul className="mt-0.5 mb-1 ml-3 flex flex-col gap-px border-l border-border/60 pl-2">
                      {children.map(({ link, thread: child }) => {
                        const childSelected = pathname === `/threads/${child.id}`;
                        const childActive =
                          child.status.kind === "running" ||
                          link.status === "running" ||
                          link.status === "waiting_parent";
                        const dotClass =
                          child.status.kind === "error" ? "bg-danger" : CHILD_DOT[link.status];
                        return (
                          <li key={child.id} data-thread-id={child.id}>
                            <button
                              type="button"
                              aria-current={childSelected}
                              onClick={() => openThreadById(child.id)}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-1.5 rounded-row px-2 py-1.5 text-left outline-none transition-colors duration-100 ease-out focus-visible:shadow-focus",
                                childSelected
                                  ? "bg-fg/7 text-fg"
                                  : "text-fg-secondary hover:bg-fg/4",
                              )}
                            >
                              {childActive ? (
                                <DotSpinner
                                  variant="working"
                                  label="Running"
                                  className="size-2.5 shrink-0 text-input"
                                />
                              ) : (
                                <span
                                  aria-hidden
                                  className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
                                />
                              )}
                              <span className="min-w-0 flex-1 truncate text-label">
                                {child.title}
                              </span>
                              <BrandLogo
                                brand={child.modelSelection.providerKind}
                                className="size-2.5 shrink-0"
                              />
                              <span className="max-w-16 shrink-0 truncate text-meta text-fg-muted">
                                {link.model}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {open.length === 0 &&
              (loading ? (
                <li>
                  <Skeleton loading id="sidebar-threads" label="Loading threads">
                    <div className="flex flex-col gap-px">
                      {[
                        "Migrate loading states to Skullet",
                        "Polish settings model stack copy",
                        "Add right sidebar skill viewer",
                      ].map((title) => (
                        <div key={title} className="flex h-14 flex-col justify-center px-2">
                          <span className="truncate text-body font-medium text-fg">{title}</span>
                          <span className="mt-0.5 flex items-center gap-2 text-meta text-fg-muted">
                            <span>scuttle</span>
                            <span>4m</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </Skeleton>
                </li>
              ) : (
                <li className="px-2 py-2 text-label text-fg-muted">
                  {filterProjectId === null
                    ? "No active threads. Start one from the composer."
                    : "No active threads in this project."}
                </li>
              ))}
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

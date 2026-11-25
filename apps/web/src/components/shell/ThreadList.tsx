import type { Thread } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { easeOut, spring } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SectionHeader, type SectionMenuEntry } from "./SectionHeader.tsx";
import { SettledSection } from "./SettledButton.tsx";
import type { SettledNotice } from "./SettleToast.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

type ThreadSort = "recent" | "oldest";

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
] as const satisfies ReadonlyArray<{ value: ThreadSort; label: string }>;

const sortThreads = (threads: ReadonlyArray<Thread>, sort: ThreadSort) =>
  threads.toSorted((a, b) =>
    sort === "oldest"
      ? a.updatedAt.localeCompare(b.updatedAt)
      : b.updatedAt.localeCompare(a.updatedAt),
  );

interface ThreadListProps {
  readonly filterProjectId: ProjectId | null;
  readonly onFilterChange: (projectId: ProjectId | null) => void;
  readonly onNewThread: () => void;
  readonly onSettled: (notice: SettledNotice) => void;
}

export function ThreadList({
  filterProjectId,
  onFilterChange,
  onNewThread,
  onSettled,
}: ThreadListProps) {
  const { threads, selectedProjectId, settleThread } = useWorkspace();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [sort, setSort] = useState<ThreadSort>("recent");
  const open = sortThreads(
    threads.filter(
      (thread) =>
        thread.settledAt === undefined &&
        (filterProjectId === null || thread.projectId === filterProjectId),
    ),
    sort,
  );
  const idle = open.filter((thread) => thread.status.kind === "idle");

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

  return (
    <section aria-labelledby="threads-heading">
      <SectionHeader
        id="threads-heading"
        title="Threads"
        addLabel="New thread"
        onAdd={onNewThread}
        menu={menu}
      />
      <LayoutGroup id="threads">
        <motion.ul
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.smooth, delay: 0.12 }}
          className="mt-0.5 flex flex-col gap-px"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {open.map((thread) => {
              const selected = pathname === `/threads/${thread.id}`;
              return (
                <motion.li
                  key={thread.id}
                  layout="position"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    y: 10,
                    scale: 0.97,
                    transition: { duration: 0.18, ease: easeOut },
                  }}
                  transition={spring.smooth}
                >
                  <ThreadRow
                    thread={thread}
                    selected={selected}
                    onSelect={() => {
                      void navigate({
                        to: "/threads/$threadId",
                        params: { threadId: thread.id },
                      });
                    }}
                    onSettle={() => {
                      void settleThread(thread.id, true);
                      onSettled({ id: thread.id, title: thread.title });
                    }}
                  />
                </motion.li>
              );
            })}
          </AnimatePresence>
          {open.length === 0 && (
            <li className="px-2 py-2 text-label text-fg-muted">
              {filterProjectId === null
                ? "No active threads. Start one from the composer."
                : "No active threads in this project."}
            </li>
          )}
        </motion.ul>
      </LayoutGroup>
      <SettledSection projectId={filterProjectId} />
    </section>
  );
}

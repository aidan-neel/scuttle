import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { easeOut, spring } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SectionHeader } from "./SectionHeader.tsx";
import type { SettledNotice } from "./SettleToast.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

interface ThreadListProps {
  readonly onNewThread: () => void;
  readonly onSettled: (notice: SettledNotice) => void;
}

export function ThreadList({ onNewThread, onSettled }: ThreadListProps) {
  const { threads, settleThread } = useWorkspace();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const open = threads.filter((thread) => thread.settledAt === undefined);

  return (
    <section aria-labelledby="threads-heading">
      <SectionHeader
        id="threads-heading"
        title="Threads"
        addLabel="New thread"
        onAdd={onNewThread}
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
              No active threads. Start one from the composer.
            </li>
          )}
        </motion.ul>
      </LayoutGroup>
    </section>
  );
}

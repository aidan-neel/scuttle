import { Popover } from "@base-ui/react/popover";
import { Archive02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Button, buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { SwapText } from "@/components/ui/SwapText.tsx";
import { easeOut, spring } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";

export function SettledButton() {
  const { threads, settleThread } = useWorkspace();
  const navigate = useNavigate();
  const done = threads.filter((thread) => thread.settledAt !== undefined);

  return (
    <Popover.Root>
      <Popover.Trigger
        className={buttonClass(
          "outline",
          "lg",
          "w-full justify-start text-fg-secondary hover:text-fg data-popup-open:bg-(--wash) data-popup-open:text-fg",
        )}
      >
        <Icon icon={Archive02Icon} className="text-fg-muted" />
        <span className="flex-1 text-left">Settled</span>
        <SwapText swapKey={done.length} className="text-label text-fg-muted tabular-nums">
          {done.length}
        </SwapText>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50 outline-none">
          <Popover.Popup className="w-(--anchor-width) min-w-64 origin-(--transform-origin) rounded-card bg-menu p-1 shadow-menu outline-none transition-[opacity,scale,translate] duration-200 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-120 data-starting-style:translate-y-1 data-starting-style:scale-96 data-starting-style:opacity-0">
            <Popover.Title className="px-2 pt-1.5 pb-1 text-meta font-medium text-fg-muted">
              Settled threads
            </Popover.Title>
            {done.length === 0 && (
              <p className="px-2 pt-1 pb-2.5 text-label text-fg-muted">
                Nothing settled. Hover a thread and press the check to file it here.
              </p>
            )}
            <ul className="scrollbar-none flex max-h-80 flex-col overflow-y-auto">
              <AnimatePresence mode="popLayout" initial={false}>
                {done.map((thread) => (
                  <motion.li
                    key={thread.id}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{
                      opacity: 0,
                      y: -8,
                      scale: 0.97,
                      transition: { duration: 0.16, ease: easeOut },
                    }}
                    transition={spring.smooth}
                    className="group/settled flex items-center gap-2 rounded-chip py-1 pr-1 pl-2 transition-colors duration-100 hover:bg-(--wash)"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({
                          to: "/threads/$threadId",
                          params: { threadId: thread.id },
                        })
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
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
                    >
                      <Icon icon={Undo02Icon} />
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

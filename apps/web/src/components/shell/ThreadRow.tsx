import {
  AlertCircleIcon,
  ComputerIcon,
  GitBranchIcon,
  HelpCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { Thread, ThreadStatus } from "@scuttle/contracts";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { formatRelativeAge } from "@/lib/format.ts";

const TITLE_TONE: Record<ThreadStatus["kind"], string> = {
  "needs-input": "font-medium text-fg",
  running: "text-fg",
  error: "text-danger/90",
  idle: "text-fg-secondary",
};

function StatusLabel({
  status,
  updatedAt,
}: {
  readonly status: ThreadStatus;
  readonly updatedAt: string;
}) {
  switch (status.kind) {
    case "needs-input":
      return (
        <span className="flex items-center gap-1 text-label text-input">
          <Icon icon={HelpCircleIcon} className="size-3.5" />
          Input
        </span>
      );
    case "running":
      return (
        <span className="flex items-center gap-1.5 text-label text-fg-muted">
          <DotSpinner variant="working" label="Working" className="text-input" />
          Running
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-label text-danger">
          <Icon icon={AlertCircleIcon} className="size-3.5" />
          Error
        </span>
      );
    case "idle":
      return (
        <span className="text-meta text-fg-muted tabular-nums">{formatRelativeAge(updatedAt)}</span>
      );
  }
}

interface ThreadRowProps {
  readonly thread: Thread;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onSettle: () => void;
}

export function ThreadRow({ thread, selected, onSelect, onSettle }: ThreadRowProps) {
  const local = thread.runtime === "local";

  return (
    <div className="group/row relative">
      <button
        type="button"
        aria-current={selected}
        onClick={onSelect}
        className={`flex w-full flex-col gap-[5px] rounded-row px-2 py-[9px] text-left outline-none transition-colors duration-100 ease-out focus-visible:shadow-focus ${
          selected ? "bg-white/7" : "group-hover/row:bg-white/4"
        }`}
      >
        <span className="flex h-5 items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-body ${TITLE_TONE[thread.status.kind]}`}>
            {thread.title}
          </span>
          <span className="shrink-0 transition-opacity duration-150 ease-out group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0">
            <StatusLabel status={thread.status} updatedAt={thread.updatedAt} />
          </span>
        </span>
        <span className="flex h-4 items-center gap-1.5">
          <Identicon name={thread.projectName} size="sm" />
          <span className="min-w-0 flex-1 truncate text-label text-fg-muted">
            {thread.projectName}
          </span>
          <BrandLogo brand={thread.modelSelection.providerKind} className="size-3" />
          <Icon
            icon={local ? ComputerIcon : GitBranchIcon}
            label={local ? "Runs locally" : "Runs in a worktree"}
            className="size-3.5 text-fg-muted"
          />
        </span>
      </button>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={`Settle ${thread.title}`}
        onClick={onSettle}
        className="absolute top-[8px] right-2 scale-90 opacity-0 transition-[opacity,scale,background-color,box-shadow,--button-top,--button-bottom] duration-150 ease-out-quint group-hover/row:scale-100 group-hover/row:opacity-100 group-has-[:focus-visible]/row:scale-100 group-has-[:focus-visible]/row:opacity-100"
      >
        <Icon icon={Tick02Icon} />
      </Button>
    </div>
  );
}

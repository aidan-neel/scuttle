import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ComputerIcon,
  GitBranchIcon,
  HelpCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { Thread, ThreadStatus } from "@scuttle/contracts";
import { memo } from "react";
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
        <span className="flex h-5 items-center gap-1 rounded-full bg-input/12 pr-2 pl-1.5 text-meta font-medium text-input">
          <Icon icon={HelpCircleIcon} className="size-3" />
          Needs input
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
  readonly onSelect: (threadId: Thread["id"]) => void;
  readonly onSettle: (thread: Thread) => void;
  readonly subagentCount?: number;
  readonly subagentRunningCount?: number;
  readonly subagentsExpanded?: boolean;
  readonly onToggleSubagents?: () => void;
}

export const ThreadRow = memo(function ThreadRow({
  thread,
  selected,
  onSelect,
  onSettle,
  subagentCount = 0,
  subagentRunningCount = 0,
  subagentsExpanded = false,
  onToggleSubagents,
}: ThreadRowProps) {
  const local = thread.runtime === "local";

  return (
    <div
      className={`group/row relative box-border flex h-14 flex-col justify-center gap-[0.3125rem] rounded-row px-2 transition-colors duration-100 ease-out ${
        selected ? "bg-fg/7" : "hover:bg-fg/4"
      }`}
    >
      <button
        type="button"
        aria-label={thread.title}
        aria-current={selected}
        onClick={() => onSelect(thread.id)}
        className="absolute inset-0 rounded-row outline-none focus-visible:shadow-focus"
      />
      <span className="pointer-events-none relative flex h-5 items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-body ${TITLE_TONE[thread.status.kind]}`}>
          {thread.title}
        </span>
        <span className="shrink-0 transition-opacity duration-150 ease-out group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0">
          <StatusLabel status={thread.status} updatedAt={thread.updatedAt} />
        </span>
      </span>
      <span className="pointer-events-none relative flex h-4 items-center gap-1.5">
        <Identicon name={thread.projectName} size="sm" />
        <span className="min-w-0 flex-1 truncate text-label text-fg-muted">
          {thread.projectName}
        </span>
        {subagentCount > 0 && onToggleSubagents !== undefined && (
          <button
            type="button"
            aria-expanded={subagentsExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSubagents();
            }}
            className="pointer-events-auto relative z-10 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-fg/7 px-1.5 py-0.5 text-meta font-medium text-fg-secondary tabular-nums transition-colors hover:bg-fg/12 focus-visible:shadow-focus"
          >
            {subagentRunningCount > 0 && (
              <span aria-hidden className="size-1.5 rounded-full bg-input" />
            )}
            <span>
              {subagentCount} {subagentCount === 1 ? "subagent" : "subagents"}
            </span>
            <Icon
              icon={subagentsExpanded ? ArrowDown01Icon : ArrowRight01Icon}
              className="size-2.5 text-fg-muted"
            />
          </button>
        )}
        <BrandLogo brand={thread.modelSelection.providerKind} className="size-3" />
        <Icon
          icon={local ? ComputerIcon : GitBranchIcon}
          label={local ? "Runs locally" : "Runs in a worktree"}
          className="size-3.5 text-fg-muted"
        />
      </span>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={`Settle ${thread.title}`}
        onClick={() => onSettle(thread)}
        className="absolute top-2 right-2 z-10 scale-90 opacity-0 transition-[opacity,scale,background-color,box-shadow,--button-top,--button-bottom] duration-150 ease-out-quint group-hover/row:scale-100 group-hover/row:opacity-100 group-has-[:focus-visible]/row:scale-100 group-has-[:focus-visible]/row:opacity-100"
      >
        <Icon icon={Tick02Icon} />
      </Button>
    </div>
  );
});

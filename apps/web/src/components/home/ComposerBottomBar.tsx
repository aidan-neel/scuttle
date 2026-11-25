import { ComputerIcon, GitBranchIcon } from "@hugeicons/core-free-icons";
import type { ThreadRuntime, ThreadStatus } from "@scuttle/contracts";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { ComposerContextPopover } from "./ComposerContextPopover.tsx";
import type { ComposerContextUsage } from "./contextUsage.ts";

export interface ComposerStatus {
  readonly runtime: ThreadRuntime;
  readonly branch: string;
  readonly state: ThreadStatus["kind"];
}

const RUNTIME_LABEL: Record<ThreadRuntime, string> = { local: "Local", worktree: "Worktree" };

const STATE_DOT: Record<ThreadStatus["kind"], { readonly tone: string; readonly label: string }> = {
  idle: { tone: "bg-success", label: "Ready" },
  running: { tone: "bg-success", label: "Working" },
  "needs-input": { tone: "bg-warning", label: "Needs input" },
  error: { tone: "bg-danger", label: "Error" },
};

interface ComposerBottomBarProps {
  readonly status: ComposerStatus | undefined;
  readonly contextUsage: ComposerContextUsage | undefined;
}

export function ComposerBottomBar({ status, contextUsage }: ComposerBottomBarProps) {
  const dot = status ? STATE_DOT[status.state] : null;
  return (
    <div className="flex h-7 items-center gap-2 px-2.5 pt-1">
      {status && dot && (
        <span
          title={`${RUNTIME_LABEL[status.runtime]} on ${status.branch} · ${dot.label}`}
          className="flex min-w-0 items-center gap-1.5 text-label text-fg-muted"
        >
          <Icon
            icon={status.runtime === "local" ? ComputerIcon : GitBranchIcon}
            className="size-3.5 shrink-0"
          />
          <span className="shrink-0">{RUNTIME_LABEL[status.runtime]}</span>
          <span className="text-fg-faint">·</span>
          <span className="min-w-0 truncate font-mono">{status.branch}</span>
          <span className={cn("size-1.5 shrink-0 rounded-full", dot.tone)} />
          <span className="sr-only">{dot.label}</span>
        </span>
      )}
      <span className="flex-1" />
      {contextUsage && <ComposerContextPopover usage={contextUsage} />}
    </div>
  );
}

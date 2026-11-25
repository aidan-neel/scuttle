import { ComputerIcon, GitBranchIcon } from "@hugeicons/core-free-icons";
import type { GitBranchInfo, ThreadRuntime, ThreadStatus } from "@scuttle/contracts";
import { Icon } from "@/components/ui/Icon.tsx";
import { Picker } from "@/components/ui/Picker.tsx";
import { cn } from "@/lib/utils";
import { BranchPicker, RUNTIMES } from "./ComposerContextBar.tsx";
import { ComposerContextPopover } from "./ComposerContextPopover.tsx";
import type { ComposerContextUsage } from "./contextUsage.ts";

export interface ComposerStatus {
  readonly runtime: ThreadRuntime;
  readonly branch: string;
  readonly state: ThreadStatus["kind"];
  readonly branches?: ReadonlyArray<GitBranchInfo>;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onRuntimeChange?: (runtime: ThreadRuntime) => void;
  readonly onBranchChange?: (branch: string) => void;
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
  const controlsDisabled = Boolean(status?.disabled || status?.busy);
  const branches: ReadonlyArray<GitBranchInfo> =
    status && status.branches && status.branches.length > 0
      ? status.branches
      : status
        ? [{ name: status.branch, isCurrent: true, isDefault: false, isWorktree: false }]
        : [];

  return (
    <div className="flex h-7 items-center gap-0.5 px-1 pt-1">
      {status && dot && (
        <div className="flex min-w-0 items-center gap-0.5">
          {status.onRuntimeChange ? (
            <Picker
              label="Runtime"
              variant="ghost"
              side="top"
              disabled={controlsDisabled}
              value={status.runtime}
              options={RUNTIMES}
              onValueChange={status.onRuntimeChange}
            />
          ) : (
            <span className="inline-flex h-6 shrink-0 items-center gap-1 px-1.5 text-label text-fg-muted">
              <Icon
                icon={status.runtime === "local" ? ComputerIcon : GitBranchIcon}
                className="size-3 shrink-0"
              />
              <span>{RUNTIME_LABEL[status.runtime]}</span>
            </span>
          )}

          {status.onBranchChange ? (
            <BranchPicker
              side="top"
              align="start"
              disabled={controlsDisabled}
              branches={branches}
              value={status.branch}
              onValueChange={status.onBranchChange}
              className="max-w-56 shrink"
            />
          ) : (
            <span className="inline-flex h-6 min-w-0 items-center gap-1 px-1.5 text-label text-fg-muted">
              <Icon icon={GitBranchIcon} className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{status.branch}</span>
            </span>
          )}

          <span title={dot.label} className={cn("ml-1 size-1.5 shrink-0 rounded-full", dot.tone)} />
          <span className="sr-only">{dot.label}</span>
        </div>
      )}
      <span className="min-w-2 flex-1" />
      {contextUsage && <ComposerContextPopover usage={contextUsage} />}
    </div>
  );
}

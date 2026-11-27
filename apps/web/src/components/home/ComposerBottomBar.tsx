import {
  ArrowUp02Icon,
  ComputerIcon,
  GitBranchIcon,
  Idea01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import type {
  GitBranchInfo,
  ModelSelection,
  ProviderSnapshot,
  QueuedTurn,
  SendTurnResult,
  ThreadRuntime,
} from "@scuttle/contracts";
import type { ComponentProps } from "react";
import type { ActiveTurnDispatch } from "@/components/settings/preferences.ts";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Picker } from "@/components/ui/Picker.tsx";
import { cn } from "@/lib/utils";
import {
  BranchPicker,
  type ComposerProjectControl,
  ProjectPicker,
  RUNTIMES,
} from "./ComposerContextBar.tsx";
import { ComposerContextPopover } from "./ComposerContextPopover.tsx";
import { ComposerUploadStatus } from "./ComposerEmbedNode.tsx";
import { ComposerPlusMenu } from "./ComposerPlusMenu.tsx";
import type { ComposerContextUsage } from "./contextUsage.ts";
import { ModelPicker } from "./ModelPicker.tsx";

export type ActiveDispatchMode = ActiveTurnDispatch;

export type ComposerSubmitOutcome =
  | { readonly kind: "started" | "steered" | "edited" }
  | { readonly kind: "queued"; readonly position: number }
  | { readonly kind: "failed" };

export const flipDispatchMode = (mode: ActiveDispatchMode): ActiveDispatchMode =>
  mode === "steer" ? "queue" : "steer";

export const resolveSendMode = (
  running: boolean,
  active: ActiveDispatchMode,
  flip: boolean,
): ActiveDispatchMode | undefined => {
  if (!running) return undefined;
  return flip ? flipDispatchMode(active) : active;
};

export const isQueueShortcut = (event: {
  readonly key: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): boolean => event.key === "Enter" && event.altKey && !event.shiftKey;

export const toSubmitOutcome = (
  result: SendTurnResult,
  queuedBefore: ReadonlyArray<QueuedTurn>,
): ComposerSubmitOutcome => {
  if (result.kind !== "queued") return { kind: result.kind };
  const item = result.queuedTurn;
  const ahead = queuedBefore.filter((q) => q.id !== item.id && q.position < item.position);
  return { kind: "queued", position: ahead.length + 1 };
};

interface ComposerActionRowProps {
  readonly compact: boolean;
  readonly plusMenu: ComponentProps<typeof ComposerPlusMenu>;
  readonly onPlanOff: (() => void) | null;
  readonly uploadingCount: number;
  readonly uploadError: string | null;
  readonly onDismissUploadError: () => void;
  readonly running: boolean;
  readonly canSend: boolean;
  readonly hasDraft: boolean;
  readonly onStop: (() => void) | undefined;
}

export function ComposerActionRow({
  compact,
  plusMenu,
  onPlanOff,
  uploadingCount,
  uploadError,
  onDismissUploadError,
  running,
  canSend,
  hasDraft,
  onStop,
}: ComposerActionRowProps) {
  return (
    <div className={cn("flex items-center gap-1 px-2.5 pt-1", compact ? "pb-2.5" : "pb-3")}>
      <ComposerPlusMenu {...plusMenu} />
      {onPlanOff && (
        <button
          type="button"
          aria-pressed
          title="Plan mode is on. Click to turn it off."
          onClick={onPlanOff}
          className="flex h-7 cursor-pointer items-center gap-1 rounded-row px-2 font-mono text-[0.78125rem] text-input outline-none transition-colors duration-(--dur-hover) hover:bg-input/[0.1] focus-visible:shadow-focus"
        >
          <Icon icon={Idea01Icon} className="size-3.5" />
          Plan
        </button>
      )}
      <ComposerUploadStatus
        uploadingCount={uploadingCount}
        uploadError={uploadError}
        onDismissError={onDismissUploadError}
      />
      <span className="flex-1" />
      {running && onStop && !hasDraft ? (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          aria-label="Stop running turn"
          onClick={onStop}
        >
          <Icon icon={StopIcon} />
        </Button>
      ) : (
        <Button
          type="submit"
          variant={hasDraft ? "primary" : "secondary"}
          size="icon"
          aria-label="Send message"
          disabled={!canSend}
          className="disabled:opacity-50"
        >
          <Icon icon={ArrowUp02Icon} />
        </Button>
      )}
    </div>
  );
}

export interface ComposerStatus {
  readonly runtime: ThreadRuntime;
  readonly branch?: string;
  readonly branches?: ReadonlyArray<GitBranchInfo>;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onRuntimeChange?: (runtime: ThreadRuntime) => void;
  readonly onBranchChange?: (branch: string) => void;
}

const RUNTIME_LABEL: Record<ThreadRuntime, string> = { local: "Local", worktree: "Worktree" };

interface ComposerBottomBarProps {
  readonly project: ComposerProjectControl | undefined;
  readonly status: ComposerStatus | undefined;
  readonly contextUsage: ComposerContextUsage | undefined;
  readonly threadCompactAtTokens?: number | undefined;
  readonly onCompactAtChange?: ((tokens: number | null) => Promise<void> | void) | undefined;
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly modelSelection: ModelSelection;
  readonly onModelSelectionChange: (selection: ModelSelection) => void;
}

export function ComposerBottomBar({
  project,
  status,
  contextUsage,
  threadCompactAtTokens,
  onCompactAtChange,
  providers,
  modelSelection,
  onModelSelectionChange,
}: ComposerBottomBarProps) {
  const controlsDisabled = Boolean(status?.disabled || status?.busy);
  const branch = status?.branch;
  const branches: ReadonlyArray<GitBranchInfo> =
    status && status.branches && status.branches.length > 0
      ? status.branches
      : branch !== undefined
        ? [{ name: branch, isCurrent: true, isDefault: false, isWorktree: false }]
        : [];

  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-0.5 gap-y-1 px-1 pt-1.5">
      {(project || status) && (
        <div className="flex min-w-0 items-center gap-0.5">
          {project && <ProjectPicker project={project} side="top" />}

          {status &&
            (status.onRuntimeChange ? (
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
            ))}

          {status &&
            branch !== undefined &&
            (status.onBranchChange ? (
              <BranchPicker
                side="top"
                align="start"
                disabled={controlsDisabled}
                branches={branches}
                value={branch}
                onValueChange={status.onBranchChange}
                className="min-w-0 max-w-[min(22rem,55vw)] shrink"
              />
            ) : (
              <span className="inline-flex h-6 min-w-0 max-w-[min(22rem,55vw)] items-center gap-1 px-1.5 text-label text-fg-muted">
                <Icon icon={GitBranchIcon} className="size-3 shrink-0" />
                <span title={branch} className="min-w-0 truncate">
                  {branch}
                </span>
              </span>
            ))}
        </div>
      )}

      <span className="min-w-2 flex-1" />

      <div className="flex min-w-0 items-center gap-1">
        <ModelPicker
          providers={providers}
          selection={modelSelection}
          onChange={onModelSelectionChange}
          align="end"
        />
        {contextUsage && (
          <ComposerContextPopover
            usage={contextUsage}
            threadCompactAtTokens={threadCompactAtTokens}
            onCompactAtChange={onCompactAtChange}
          />
        )}
      </div>
    </div>
  );
}

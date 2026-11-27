import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { GitBranchIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import type { GitTargetRef } from "@scuttle/client-runtime";
import type { GitRepoStatus } from "@scuttle/contracts";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { Skeleton } from "skullet/react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { pillTriggerClass } from "@/components/ui/Picker.tsx";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { FeedbackLine } from "./fields.tsx";
import { ForgeLogo } from "./ForgeLogo.tsx";
import { openExternalUrl } from "./gitApi.ts";
import { GitChangesPanel } from "./GitChangesPanel.tsx";
import { GitPullRequestsPanel } from "./GitPullRequestsPanel.tsx";
import { useGitStatus } from "./useGitStatus.ts";

const POPUP_CLASS =
  "w-[min(23.75rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-card bg-menu p-1 shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:-translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0";

const TAB_CLASS =
  "relative flex h-7 cursor-pointer items-center gap-1.5 rounded-chip px-2 text-label text-fg-muted outline-none select-none transition-colors duration-(--dur-hover) active:scale-[0.98] hover:text-fg focus-visible:shadow-focus data-active:text-fg";

type TabId = "changes" | "requests";

function RepoHeader({
  status,
  loading,
  onRefresh,
}: {
  readonly status: GitRepoStatus;
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  const remote = status.remote;
  const webUrl = remote?.webUrl ?? null;
  return (
    <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
      <Icon icon={GitBranchIcon} className="size-3.5 shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-label text-fg">
          {status.branch ?? "detached HEAD"}
        </div>
        <div className="truncate text-meta text-fg-muted">
          {status.upstream === null
            ? "Not published"
            : `${status.upstream} · ↑${status.ahead} ↓${status.behind}`}
        </div>
      </div>
      {webUrl !== null && (status.forge === "github" || status.forge === "gitlab") && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${remote?.owner}/${remote?.repo}`}
          onClick={() => openExternalUrl(webUrl)}
        >
          <ForgeLogo forge={status.forge} className="size-3.5 text-fg-secondary" />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Refresh Git status" onClick={onRefresh}>
        <Icon icon={RefreshIcon} className={cn(loading && "animate-spin")} />
      </Button>
    </div>
  );
}

export function ThreadGitPopover({
  target,
  fallbackBranch,
  refreshKey,
}: {
  readonly target: GitTargetRef;
  readonly fallbackBranch: string;
  readonly refreshKey: string;
}) {
  const { status, error, loading, refresh, replace } = useGitStatus(target, refreshKey);
  const pillId = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("changes");

  if (status?.kind === "not-a-repo") return null;

  const repo = status?.kind === "repo" ? status : null;
  const branch = repo?.branch ?? fallbackBranch;
  const changed = repo?.summary.changed ?? 0;
  const requestsLabel = repo?.forge === "gitlab" ? "Merge requests" : "Pull requests";

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <Popover.Trigger
        aria-label={`Git: ${branch}${changed > 0 ? `, ${changed} changed files` : ""}`}
        className={pillTriggerClass("max-w-56", "ghost")}
      >
        <Icon icon={GitBranchIcon} />
        <span className="min-w-0 truncate font-mono">{branch}</span>
        {changed > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-meta tabular-nums text-fg-muted">
            <span className="size-1.5 rounded-full bg-warning" />
            {changed}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50 outline-none">
          <Popover.Popup aria-label="Git" className={POPUP_CLASS}>
            {repo === null && error !== null ? (
              <div className="p-2">
                <FeedbackLine feedback={{ tone: "error", text: error }} />
              </div>
            ) : (
              <Skeleton loading={repo === null} id="git-popover" label="Loading Git status">
                {repo === null ? (
                  <div className="space-y-2 p-2">
                    <div className="flex items-center gap-2">
                      <span skullet-block="" className="size-3.5 shrink-0 rounded-[4px]" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="font-mono text-label text-fg">{branch}</div>
                        <div className="text-meta text-fg-muted">origin/{branch} · ↑0 ↓0</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-label text-fg">Changes 3</span>
                      <span className="text-label text-fg-muted">Pull requests</span>
                    </div>
                    <div className="space-y-1.5 border-t border-edge pt-2">
                      <div className="font-mono text-meta text-fg">apps/web/src/index.css</div>
                      <div className="font-mono text-meta text-fg">
                        apps/web/src/components/shell/AppShell.tsx
                      </div>
                      <div className="font-mono text-meta text-fg">
                        apps/web/src/routes/settings.tsx
                      </div>
                    </div>
                  </div>
                ) : (
                  <Tabs.Root
                    value={tab}
                    onValueChange={(value) => setTab(value === "requests" ? "requests" : "changes")}
                  >
                    <RepoHeader status={repo} loading={loading} onRefresh={() => void refresh()} />
                    <Tabs.List className="flex items-center gap-0.5 px-1 pb-1">
                      <Tabs.Tab value="changes" className={TAB_CLASS}>
                        {tab === "changes" && (
                          <motion.span
                            layoutId={`${pillId}-git-tab`}
                            transition={spring.snappy}
                            aria-hidden
                            className="absolute inset-0 rounded-chip bg-(--wash)"
                          />
                        )}
                        <span className="relative z-10 inline-flex items-center gap-1.5">
                          Changes
                          {changed > 0 && (
                            <span className="font-mono text-meta tabular-nums text-fg-muted">
                              {changed}
                            </span>
                          )}
                        </span>
                      </Tabs.Tab>
                      <Tabs.Tab value="requests" className={TAB_CLASS}>
                        {tab === "requests" && (
                          <motion.span
                            layoutId={`${pillId}-git-tab`}
                            transition={spring.snappy}
                            aria-hidden
                            className="absolute inset-0 rounded-chip bg-(--wash)"
                          />
                        )}
                        <span className="relative z-10">{requestsLabel}</span>
                      </Tabs.Tab>
                    </Tabs.List>
                    <div className="h-px bg-edge" />
                    <Tabs.Panel value="changes" className="pt-1 outline-none">
                      <GitChangesPanel target={target} status={repo} onStatus={replace} />
                    </Tabs.Panel>
                    <Tabs.Panel value="requests" className="pt-1 outline-none">
                      <GitPullRequestsPanel target={target} status={repo} />
                    </Tabs.Panel>
                  </Tabs.Root>
                )}
              </Skeleton>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

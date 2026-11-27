import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import { AgentDelegation, type Thread } from "@scuttle/contracts";
import type { ProjectId, ThreadId } from "@scuttle/shared/ids";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { getDesktopBridge } from "@/lib/desktopBridge.ts";
import { cn } from "@/lib/utils";
import { useWorkspaceSelector } from "@/lib/workspace.tsx";

const decodeDelegations = Schema.decodeUnknownOption(Schema.Array(AgentDelegation));
const decodeDelegation = Schema.decodeUnknownOption(AgentDelegation);

const STATUS_DOT: Record<AgentDelegation["status"], string> = {
  running: "bg-input",
  waiting_parent: "bg-input",
  completed: "bg-success",
  failed: "bg-danger",
  canceled: "bg-fg-muted/60",
};

const STATUS_TEXT: Record<AgentDelegation["status"], string> = {
  running: "Running",
  waiting_parent: "Waiting",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

const resolveApiBase = async (): Promise<string> => {
  const bridge = getDesktopBridge();
  return bridge === null ? "" : (await bridge.getDesktopInfo()).serverUrl;
};

interface ThreadDelegationsBarProps {
  readonly threadId: ThreadId | string;
  readonly projectId: ProjectId | string;
}

export function ThreadDelegationsBar({ threadId, projectId }: ThreadDelegationsBarProps) {
  const navigate = useNavigate();
  const threads = useWorkspaceSelector((s) => s.threads);
  const [delegations, setDelegations] = useState<ReadonlyArray<AgentDelegation>>([]);
  const [expanded, setExpanded] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const threadSignal = threads
    .filter((t) => t.projectId === projectId)
    .map((t) => `${t.id}:${t.status.kind}:${t.updatedAt}`)
    .join("|");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const base = await resolveApiBase();
        const res = await fetch(`${base}/api/threads/${encodeURIComponent(threadId)}/delegations`);
        if (!res.ok || !active) return;
        const decoded = decodeDelegations(await res.json());
        if (active && decoded._tag === "Some") {
          setDelegations(decoded.value);
        }
      } catch {
        // ignore transient fetch errors
      }
    })();
    return () => {
      active = false;
    };
  }, [threadId, threadSignal]);

  if (delegations.length === 0) return null;

  const threadsById = new Map<string, Thread>();
  for (const t of threads) {
    threadsById.set(t.id, t);
  }
  const activeCount = delegations.filter(
    (d) => d.status === "running" || d.status === "waiting_parent",
  ).length;

  const handleCancel = async (delegationId: string) => {
    setCancelingId(delegationId);
    try {
      const base = await resolveApiBase();
      const res = await fetch(
        `${base}/api/delegations/${encodeURIComponent(delegationId)}/cancel`,
        { method: "POST" },
      );
      if (!res.ok) return;
      const decoded = decodeDelegation(await res.json());
      if (decoded._tag === "Some") {
        const updated = decoded.value;
        setDelegations((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      }
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <div className="mb-3 rounded-card border border-line bg-panel/80">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-fg/3 focus-visible:shadow-focus"
      >
        <Icon
          icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-3.5 shrink-0 text-fg-muted"
        />
        <span className="text-label font-medium text-fg">Subagents</span>
        <span className="rounded-full bg-fg/7 px-1.5 py-0.5 text-meta font-medium text-fg-secondary tabular-nums">
          {activeCount > 0 ? `${activeCount} running · ${delegations.length}` : delegations.length}
        </span>
      </button>

      {expanded && (
        <div className="grid gap-1.5 border-t border-line p-2 sm:grid-cols-2">
          {delegations.map((d) => {
            const childThread = threadsById.get(d.childThreadId);
            const isActive = d.status === "running" || d.status === "waiting_parent";
            const preview = d.resultSummary?.trim() || d.brief.trim();
            return (
              <div
                key={d.id}
                className="flex flex-col gap-1.5 rounded-row border border-edge bg-raised/70 p-2.5"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1 shrink-0">
                    {isActive ? (
                      <DotSpinner
                        variant="working"
                        label={STATUS_TEXT[d.status]}
                        className="size-3 text-input"
                      />
                    ) : (
                      <span
                        title={STATUS_TEXT[d.status]}
                        className={cn("block size-2 rounded-full", STATUS_DOT[d.status])}
                      />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: "/threads/$threadId",
                        params: { threadId: d.childThreadId },
                      })
                    }
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-label font-medium text-fg outline-none hover:underline focus-visible:shadow-focus"
                  >
                    {d.title}
                  </button>
                  {isActive && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={cancelingId === d.id}
                      aria-label={`Cancel ${d.title}`}
                      onClick={() => void handleCancel(d.id)}
                      className="size-5 shrink-0 text-fg-muted hover:text-danger"
                    >
                      <Icon icon={Cancel01Icon} className="size-3" />
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-meta text-fg-muted">
                  <span className="inline-flex items-center gap-1 rounded bg-fg/6 px-1.5 py-0.5 text-fg-secondary">
                    <BrandLogo brand={d.modelSelection.providerKind} className="size-2.5" />
                    <span className="max-w-32 truncate">{d.modelSelection.model}</span>
                  </span>
                  <span className="rounded bg-fg/5 px-1.5 py-0.5">{d.role}</span>
                  {childThread?.branch && (
                    <span className="inline-flex items-center gap-0.5 truncate">
                      <Icon icon={GitBranchIcon} className="size-3 shrink-0" />
                      <span className="max-w-28 truncate">{childThread.branch}</span>
                    </span>
                  )}
                  <span className="ml-auto tabular-nums">
                    {d.bounceCount}/{d.maxBounces} bounces
                  </span>
                </div>

                {preview.length > 0 && (
                  <p className="line-clamp-2 text-meta text-fg-muted">{preview}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

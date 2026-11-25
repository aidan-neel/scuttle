import { Add01Icon, Cancel01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import type { Agent, AgentDelegation, AgentDelegationStatus } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import type { AgentWork } from "@/lib/agentState.ts";
import { formatRelativeAge } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import { AgentPullRequests } from "./AgentPullRequests.tsx";
import { DelegateForm } from "./DelegateForm.tsx";
import { EmptyLine, ErrorLine, InspectorSection, Pill } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

const STATUS_DOT: Record<Exclude<AgentDelegationStatus, "running">, string> = {
  completed: "bg-success",
  failed: "bg-danger",
  canceled: "bg-fg-faint",
};

const RECENT_LIMIT = 8;

function DelegationRow({
  delegation,
  canceling,
  onCancel,
}: {
  readonly delegation: AgentDelegation;
  readonly canceling: boolean;
  readonly onCancel: () => void;
}) {
  const navigate = useNavigate();
  const running = delegation.status === "running";
  return (
    <li className="group/delegation flex items-center gap-1 rounded-chip pr-1 transition-colors duration-100 hover:bg-(--wash)">
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/threads/$threadId",
            params: { threadId: delegation.childThreadId },
          })
        }
        className="flex min-w-0 flex-1 items-start gap-2 rounded-chip py-1.5 pl-2 text-left outline-none focus-visible:shadow-focus"
      >
        <span className="grid size-3.5 shrink-0 place-items-center pt-0.5">
          {running ? (
            <DotSpinner variant="working" label="Running" />
          ) : (
            <span
              aria-label={delegation.status}
              className={cn("size-1.5 rounded-full", STATUS_DOT[delegation.status])}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label text-fg">{delegation.title}</span>
          <span className="flex items-center gap-1.5 text-meta text-fg-muted">
            <Pill>{delegation.kind === "pr" ? "pr" : delegation.role}</Pill>
            <span className="min-w-0 truncate">{delegation.modelSelection.model}</span>
            <span className="shrink-0 tabular-nums">
              {formatRelativeAge(delegation.completedAt ?? delegation.createdAt)}
            </span>
          </span>
        </span>
      </button>
      {running && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Cancel ${delegation.title}`}
          title="Cancel"
          disabled={canceling}
          onClick={onCancel}
          className="hover:text-danger"
        >
          {canceling ? (
            <DotSpinner variant="working" label="Canceling" />
          ) : (
            <Icon icon={Cancel01Icon} />
          )}
        </Button>
      )}
    </li>
  );
}

interface AgentOverviewTabProps {
  readonly agent: Agent;
  readonly work: AgentWork;
  readonly delegateOpen: boolean;
  readonly onDelegateOpenChange: (open: boolean) => void;
}

export function AgentOverviewTab({
  agent,
  work,
  delegateOpen,
  onDelegateOpenChange,
}: AgentOverviewTabProps) {
  const { cancelDelegation, runCheckIn } = useWorkspace();
  const task = useTask();
  const delegations = work.delegations.toSorted((a, b) => {
    if ((a.status === "running") !== (b.status === "running")) {
      return a.status === "running" ? -1 : 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
  const running = delegations.filter((d) => d.status === "running");
  const visible = delegations.slice(0, Math.max(RECENT_LIMIT, running.length));
  const checkIns = work.checkIns.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex flex-col gap-3">
      <InspectorSection
        title="Subagents"
        count={running.length > 0 ? running.length : delegations.length}
        actions={
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={delegateOpen}
            onClick={() => onDelegateOpenChange(!delegateOpen)}
          >
            <Icon icon={Add01Icon} />
            Delegate
          </Button>
        }
      >
        {delegateOpen && <DelegateForm agent={agent} onDone={() => onDelegateOpenChange(false)} />}
        {visible.length === 0 && !delegateOpen && (
          <EmptyLine>No subagents yet. Delegate a task to spin up a worker thread.</EmptyLine>
        )}
        <ul className="flex flex-col gap-px">
          {visible.map((delegation) => (
            <DelegationRow
              key={delegation.id}
              delegation={delegation}
              canceling={task.busy === delegation.id}
              onCancel={() =>
                void task.run(
                  delegation.id,
                  () => cancelDelegation(agent.id, delegation.id),
                  "Could not cancel the subagent.",
                )
              }
            />
          ))}
        </ul>
      </InspectorSection>

      <AgentPullRequests agent={agent} />

      <InspectorSection
        title="Check-ins"
        count={checkIns.length}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={task.busy === "checkin"}
            onClick={() =>
              void task.run("checkin", () => runCheckIn(agent.id), "Could not run a check-in.")
            }
          >
            {task.busy === "checkin" ? (
              <DotSpinner variant="working" label="Checking in" />
            ) : (
              <Icon icon={RefreshIcon} />
            )}
            Check in
          </Button>
        }
      >
        {checkIns.length === 0 && (
          <EmptyLine>No check-ins yet. A check-in summarizes open work and PRs.</EmptyLine>
        )}
        <ul className="flex flex-col gap-1">
          {checkIns.slice(0, RECENT_LIMIT).map((checkIn) => (
            <li key={checkIn.id} className="rounded-chip px-2 py-1.5">
              <p className="line-clamp-3 text-label leading-[1.5] text-fg-secondary">
                {checkIn.summary}
              </p>
              <p className="mt-0.5 flex gap-2 text-meta text-fg-muted tabular-nums">
                <span>{formatRelativeAge(checkIn.createdAt)}</span>
                <span>{checkIn.activeDelegations} running</span>
                <span>{checkIn.openPrs} PRs</span>
                <span>{checkIn.openIssues} issues</span>
              </p>
            </li>
          ))}
        </ul>
      </InspectorSection>
      <ErrorLine message={task.error} />
    </div>
  );
}

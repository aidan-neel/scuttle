import { Add01Icon, Cancel01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import type {
  Agent,
  AgentDelegation,
  AgentDelegationStatus,
  AgentModelRole,
} from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
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

const STACK_ROLES: ReadonlyArray<Exclude<AgentModelRole, "agent">> = [
  "workhorse",
  "design",
  "review",
  "fast",
  "large",
];

const RECENT_LIMIT = 8;

function AgentProfileCard({ agent }: { readonly agent: Agent }) {
  const { providers, updateAgent } = useWorkspace();
  const task = useTask();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameValue = nameDraft ?? agent.name;

  const commitName = async () => {
    const trimmed = nameValue.trim();
    setNameDraft(null);
    if (trimmed.length === 0 || trimmed === agent.name) return;
    await task.run("rename", () => updateAgent(agent.id, { name: trimmed }), "Could not rename.");
  };

  const roleEntries = STACK_ROLES.flatMap((role) => {
    const selection = agent.modelStack[role];
    return selection !== undefined ? [{ role, selection }] : [];
  });

  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-panel p-2.5 shadow-[inset_0_0_0_1px_var(--color-edge)]">
      <div className="flex items-center gap-2.5">
        <Identicon name={nameValue.trim() || agent.name} size="lg" />
        <div className="min-w-0 flex-1">
          <input
            value={nameValue}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setNameDraft(null);
                event.currentTarget.blur();
              }
            }}
            aria-label="Agent name"
            spellCheck={false}
            className="w-full rounded-chip bg-transparent px-1 -ml-1 text-body font-semibold text-fg outline-none transition-colors hover:bg-(--wash) focus:bg-(--wash) focus:shadow-focus"
          />
          <p className="truncate text-meta text-fg-muted" title={agent.projectPath}>
            {agent.projectName} · {agent.runtime}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-meta font-medium text-fg-muted">Model</span>
        <ModelPicker
          providers={providers}
          selection={agent.modelSelection}
          onChange={(modelSelection) =>
            void task.run(
              "model",
              () =>
                updateAgent(agent.id, {
                  modelSelection,
                  modelStack: { ...agent.modelStack, agent: modelSelection },
                }),
              "Could not update model.",
            )
          }
        />
      </div>

      <div className="border-t border-line pt-2">
        <p className="text-label leading-[1.5] text-fg-secondary">
          {agent.purpose.trim().length > 0
            ? agent.purpose
            : `No purpose set yet. Tell ${agent.name} what it owns in chat.`}
        </p>
        {roleEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {roleEntries.map(({ role, selection }) => (
              <Pill key={role}>
                {role}: {selection.model}
              </Pill>
            ))}
          </div>
        )}
      </div>

      <ErrorLine message={task.error} />
    </div>
  );
}

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
      <AgentProfileCard agent={agent} />

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
          <EmptyLine>No subagents yet. Ask {agent.name} in chat or delegate directly.</EmptyLine>
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

      {agent.instructionsMd.trim().length > 0 && (
        <InspectorSection title="Instructions" defaultOpen={false}>
          <div className="flex flex-col gap-1.5 px-1">
            <p className="text-meta text-fg-faint">
              Managed through chat — tell {agent.name} to change its rules or model roster.
            </p>
            <pre className="max-h-56 overflow-auto rounded-control bg-chrome/70 px-2.5 py-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-words text-fg-muted">
              {agent.instructionsMd}
            </pre>
          </div>
        </InspectorSection>
      )}
      <ErrorLine message={task.error} />
    </div>
  );
}

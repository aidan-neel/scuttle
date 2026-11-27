import { ContextMenu } from "@base-ui/react/context-menu";
import { AlertCircleIcon, HelpCircleIcon } from "@hugeicons/core-free-icons";
import type { Agent, Thread } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Skeleton } from "skullet/react";
import { AgentContextMenuContent } from "@/components/agents/AgentActionsMenu.tsx";
import { AgentProfileDialog } from "@/components/agents/AgentProfileDialog.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import {
  type AgentActivityStatus,
  formatAgentWorkingLabel,
  resolveAgentActivityStatus,
} from "@/lib/agentStatus.ts";
import { compareIsoDesc } from "@/lib/collections.ts";
import { formatRelativeAge } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { SectionHeader, type SectionMenuEntry } from "./SectionHeader.tsx";

type AgentSort = "recent" | "name";

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "name", label: "Name" },
] as const satisfies ReadonlyArray<{ value: AgentSort; label: string }>;

const sortAgents = (agents: ReadonlyArray<Agent>, sort: AgentSort) =>
  sort === "name"
    ? agents.toSorted((a, b) => a.name.localeCompare(b.name))
    : agents.toSorted((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));

const agentSubtitle = (agent: Agent) =>
  agent.lastSummary ??
  (agent.purpose.trim().length > 0
    ? agent.purpose
    : `Tell ${agent.name} its purpose and the first piece of work`);

function PinnedStatusBadge({ status }: { readonly status: AgentActivityStatus }) {
  switch (status.kind) {
    case "working": {
      const label = formatAgentWorkingLabel(status.activeDelegations);
      return (
        <span
          title={label}
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-input/40 bg-panel ring-2 ring-sidebar"
        >
          <DotSpinner variant="working" label={label} className="size-3 text-input" />
        </span>
      );
    }
    case "needs-input":
      return (
        <span
          title="Input needed"
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-input/40 bg-panel ring-2 ring-sidebar"
        >
          <Icon icon={HelpCircleIcon} className="size-3 text-input" />
        </span>
      );
    case "error":
      return (
        <span
          title="Error"
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-danger/40 bg-panel ring-2 ring-sidebar"
        >
          <Icon icon={AlertCircleIcon} className="size-3 text-danger" />
        </span>
      );
    case "idle":
      return null;
  }
}

function AgentRowStatus({
  status,
  updatedAt,
}: {
  readonly status: AgentActivityStatus;
  readonly updatedAt: string;
}) {
  switch (status.kind) {
    case "working": {
      const label = formatAgentWorkingLabel(status.activeDelegations);
      return (
        <span className="flex shrink-0 items-center gap-1.5 text-label font-medium text-input">
          <DotSpinner variant="working" label={label} className="size-3.5 text-input" />
          {label}
        </span>
      );
    }
    case "needs-input":
      return (
        <span className="flex shrink-0 items-center gap-1 text-label font-medium text-input">
          <Icon icon={HelpCircleIcon} className="size-3.5" />
          Input
        </span>
      );
    case "error":
      return (
        <span className="flex shrink-0 items-center gap-1 text-label font-medium text-danger">
          <Icon icon={AlertCircleIcon} className="size-3.5" />
          Error
        </span>
      );
    case "idle":
      return (
        <span className="shrink-0 text-meta text-fg-muted tabular-nums">
          {formatRelativeAge(updatedAt)}
        </span>
      );
  }
}

interface AgentListProps {
  readonly filterProjectId: ProjectId | null;
  readonly onFilterChange: (projectId: ProjectId | null) => void;
  readonly onCreateAgent: () => void;
}

export function AgentList({ filterProjectId, onFilterChange, onCreateAgent }: AgentListProps) {
  const agents = useWorkspaceSelector((s) => s.agents);
  const threads = useWorkspaceSelector((s) => s.threads);
  const agentWork = useWorkspaceSelector((s) => s.agentWork);
  const loading = useWorkspaceSelector((s) => s.loading);
  const { deleteAgent } = useWorkspaceActions();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [sort, setSort] = useState<AgentSort>("recent");
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const [removing, setRemoving] = useState<Agent | null>(null);

  const threadsById = new Map<string, Thread>();
  for (const thread of threads) {
    threadsById.set(thread.id, thread);
  }

  const statusForAgent = (agent: Agent): AgentActivityStatus =>
    resolveAgentActivityStatus(
      agent,
      threadsById.get(agent.primaryThreadId),
      agentWork[agent.id]?.delegations,
    );

  const clearFilter: SectionMenuEntry = {
    kind: "action",
    label: "Clear filter",
    onSelect: () => onFilterChange(null),
  };
  const menu: ReadonlyArray<SectionMenuEntry> = [
    {
      kind: "choice",
      label: "Sort by",
      value: sort,
      options: SORT_OPTIONS,
      onValueChange: (value) => setSort(value === "name" ? "name" : "recent"),
    },
    { kind: "separator" },
    { kind: "action", label: "New agent", onSelect: onCreateAgent },
    ...(filterProjectId === null ? [] : [clearFilter]),
  ];

  const openAgent = (agent: Agent) =>
    void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } });

  const sorted = sortAgents(agents, sort);
  const pinnedAgents = sorted.filter((agent) => agent.pinned);
  const unpinnedAgents = sorted.filter((agent) => !agent.pinned);

  const liveProfileAgent =
    profileAgent === null
      ? null
      : (agents.find((candidate) => candidate.id === profileAgent.id) ?? null);

  return (
    <section aria-labelledby="agents-heading">
      <SectionHeader
        id="agents-heading"
        title="Agents"
        addLabel="New agent"
        onAdd={onCreateAgent}
        menu={menu}
      />

      {pinnedAgents.length > 0 && (
        <ul aria-label="Pinned agents" className="mt-1.5 mb-2 flex flex-wrap justify-center gap-2">
          {pinnedAgents.map((agent) => {
            const isFiltered = filterProjectId === agent.projectId;
            const isSelected = pathname === `/agents/${agent.id}` || isFiltered;
            const status = statusForAgent(agent);
            const isActive = status.kind === "working" || status.kind === "needs-input";
            return (
              <li key={agent.id}>
                <ContextMenu.Root>
                  <ContextMenu.Trigger
                    render={
                      <button
                        type="button"
                        aria-current={isSelected ? "page" : undefined}
                        onClick={() => openAgent(agent)}
                        className={cn(
                          "flex w-21 flex-col items-center gap-1.5 rounded-card p-2 text-center outline-none transition-colors duration-100 ease-out focus-visible:shadow-focus",
                          isSelected
                            ? isActive
                              ? "bg-fg/9 ring-1 ring-input/35"
                              : "bg-fg/9"
                            : isActive
                              ? "bg-input/[0.06] ring-1 ring-input/25 hover:bg-input/[0.09]"
                              : "bg-fg/4 hover:bg-fg/7",
                        )}
                      />
                    }
                  >
                    <span className="relative inline-flex shrink-0">
                      <Identicon
                        name={agent.name}
                        style={agent.identiconStyle}
                        size="xl"
                        className="size-14 rounded-canvas"
                      />
                      <PinnedStatusBadge status={status} />
                    </span>
                    <span className="w-full truncate text-label font-semibold text-fg">
                      {agent.name}
                    </span>
                  </ContextMenu.Trigger>
                  <AgentContextMenuContent
                    agent={agent}
                    handlers={{
                      onOpenProfile: () => setProfileAgent(agent),
                      onRequestRemove: () => setRemoving(agent),
                      isFiltered,
                      onToggleFilter: () => onFilterChange(isFiltered ? null : agent.projectId),
                    }}
                  />
                </ContextMenu.Root>
              </li>
            );
          })}
        </ul>
      )}

      <ul className="mt-0.5 flex flex-col gap-px">
        {unpinnedAgents.map((agent) => {
          const isFiltered = filterProjectId === agent.projectId;
          const isSelected = pathname === `/agents/${agent.id}` || isFiltered;
          const status = statusForAgent(agent);
          return (
            <li key={agent.id}>
              <ContextMenu.Root>
                <ContextMenu.Trigger
                  render={
                    <button
                      type="button"
                      aria-current={isSelected ? "page" : undefined}
                      onClick={() => openAgent(agent)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-row p-2 text-left outline-none transition-colors duration-100 ease-out focus-visible:shadow-focus",
                        isSelected ? "bg-fg/7" : "hover:bg-fg/4",
                      )}
                    />
                  }
                >
                  <span className="relative inline-flex shrink-0">
                    <Identicon name={agent.name} style={agent.identiconStyle} size="lg" />
                    {status.kind !== "idle" && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
                          status.kind === "error" ? "bg-danger" : "bg-input",
                        )}
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-body font-semibold text-fg">
                        {agent.name}
                      </span>
                      <AgentRowStatus status={status} updatedAt={agent.updatedAt} />
                    </span>
                    <span
                      className={cn(
                        "truncate text-label",
                        agent.needsAttention ? "text-input" : "text-fg-muted",
                      )}
                    >
                      {agentSubtitle(agent)}
                    </span>
                  </span>
                </ContextMenu.Trigger>
                <AgentContextMenuContent
                  agent={agent}
                  handlers={{
                    onOpenProfile: () => setProfileAgent(agent),
                    onRequestRemove: () => setRemoving(agent),
                    isFiltered,
                    onToggleFilter: () => onFilterChange(isFiltered ? null : agent.projectId),
                  }}
                />
              </ContextMenu.Root>
            </li>
          );
        })}
        {agents.length === 0 &&
          (loading ? (
            <li>
              <Skeleton loading id="sidebar-agents" label="Loading agents">
                <div className="flex flex-col gap-px">
                  {["Scuttle", "Frontend"].map((name) => (
                    <div key={name} className="flex items-center gap-2.5 rounded-row p-2">
                      <span skullet-block="" className="size-8 shrink-0 rounded-row" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-baseline gap-2">
                          <span className="flex-1 truncate text-body font-semibold text-fg">
                            {name}
                          </span>
                          <span className="text-meta text-fg-muted">2m</span>
                        </span>
                        <span className="truncate text-label text-fg-muted">
                          Ready for workspace tasks
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </Skeleton>
            </li>
          ) : (
            <li className="px-2 py-2 text-label text-fg-muted">
              No agents yet. Press + to create one.
            </li>
          ))}
      </ul>

      <AgentProfileDialog
        agent={liveProfileAgent}
        open={liveProfileAgent !== null}
        onOpenChange={(next) => !next && setProfileAgent(null)}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Remove ${removing?.name ?? "agent"}?`}
        description="This removes the agent, its conversation, and its memory from Scuttle. The project and files on disk are not touched."
        confirmLabel="Remove agent"
        onConfirm={async () => {
          if (removing === null) return;
          await deleteAgent(removing.id);
          if (filterProjectId === removing.projectId) onFilterChange(null);
          if (pathname === `/agents/${removing.id}`) void navigate({ to: "/" });
        }}
      />
    </section>
  );
}

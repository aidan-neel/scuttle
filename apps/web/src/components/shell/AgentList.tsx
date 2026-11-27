import { ContextMenu } from "@base-ui/react/context-menu";
import type { Agent } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { AgentContextMenuContent } from "@/components/agents/AgentActionsMenu.tsx";
import { AgentProfileDialog } from "@/components/agents/AgentProfileDialog.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
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

interface AgentListProps {
  readonly filterProjectId: ProjectId | null;
  readonly onFilterChange: (projectId: ProjectId | null) => void;
  readonly onCreateAgent: () => void;
}

export function AgentList({ filterProjectId, onFilterChange, onCreateAgent }: AgentListProps) {
  const agents = useWorkspaceSelector((s) => s.agents);
  const { deleteAgent } = useWorkspaceActions();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [sort, setSort] = useState<AgentSort>("recent");
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const [removing, setRemoving] = useState<Agent | null>(null);

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
                          "flex w-[84px] flex-col items-center gap-1.5 rounded-card p-2 text-center outline-none transition-colors duration-100 ease-out focus-visible:shadow-focus",
                          isSelected ? "bg-white/9" : "bg-white/4 hover:bg-white/7",
                        )}
                      />
                    }
                  >
                    <Identicon name={agent.name} size="xl" className="size-14 rounded-[12px]" />
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
                        isSelected ? "bg-white/7" : "hover:bg-white/4",
                      )}
                    />
                  }
                >
                  <Identicon name={agent.name} size="lg" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-2">
                      <span className="flex-1 truncate text-body font-semibold text-fg">
                        {agent.name}
                      </span>
                      <span className="text-meta text-fg-muted tabular-nums">
                        {formatRelativeAge(agent.updatedAt)}
                      </span>
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
        {agents.length === 0 && (
          <li className="px-2 py-2 text-label text-fg-muted">
            No agents yet. Press + to create one.
          </li>
        )}
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

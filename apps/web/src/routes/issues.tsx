import { Menu } from "@base-ui/react/menu";
import {
  Add01Icon,
  Cancel01Icon,
  FilterHorizontalIcon,
  Search01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import type { Agent, AgentIssue, AgentIssuePriority, AgentIssueState } from "@scuttle/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog.tsx";
import { IssueCard } from "@/components/issues/IssueCard.tsx";
import { IssueDetailDrawer } from "@/components/issues/IssueDetailDrawer.tsx";
import {
  filterIssues,
  groupIssuesByState,
  ISSUE_PRIORITY_META,
  ISSUE_PRIORITY_ORDER,
  ISSUE_STATE_META,
  ISSUE_STATE_ORDER,
  type IssuePresetFilter,
} from "@/components/issues/issueMeta.ts";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import {
  MENU_ITEM_CLASS,
  MenuGroupLabel,
  MenuPopup,
  MenuSeparator,
} from "@/components/ui/Menu.tsx";
import { cn } from "@/lib/utils.ts";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/issues")({
  component: IssuesPage,
});

const PRESET_TABS: ReadonlyArray<{ readonly id: IssuePresetFilter; readonly label: string }> = [
  { id: "for_you", label: "For you" },
  { id: "assigned_to_me", label: "Assigned to me" },
  { id: "created_by_me", label: "Created by me" },
  { id: "agents", label: "Assigned to agents" },
  { id: "all", label: "All" },
];

function IssuesPage() {
  const issues = useWorkspaceSelector((s) => s.issues);
  const agents = useWorkspaceSelector((s) => s.agents);
  const { updateIssue } = useWorkspaceActions();

  const [preset, setPreset] = useState<IssuePresetFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<AgentIssuePriority | null>(null);
  const [showSecondaryColumns, setShowSecondaryColumns] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialState, setCreateInitialState] = useState<AgentIssueState>("todo");
  const [draggingIssue, setDraggingIssue] = useState<AgentIssue | null>(null);
  const [dragOverState, setDragOverState] = useState<AgentIssueState | null>(null);

  const agentMap = new Map<string, Agent>(agents.map((a) => [a.id, a]));

  const filtered = filterIssues(issues, {
    preset,
    query,
    agentId: filterAgentId,
    priority: filterPriority,
  });
  const grouped = groupIssuesByState(filtered);

  const visibleColumns = showSecondaryColumns
    ? ISSUE_STATE_ORDER
    : ISSUE_STATE_ORDER.filter(
        (state) => ISSUE_STATE_META[state].primaryColumn || grouped[state].length > 0,
      );

  const selectedIssue = selectedIssueId
    ? (issues.find((i) => i.id === selectedIssueId) ?? null)
    : null;

  const hasActiveFilters =
    filterAgentId !== null || filterPriority !== null || query.trim().length > 0;

  const openCreateInColumn = (state: AgentIssueState) => {
    setCreateInitialState(state);
    setCreateOpen(true);
  };

  const handleDropOnColumn = (targetState: AgentIssueState) => {
    setDragOverState(null);
    if (!draggingIssue) return;
    const moving = draggingIssue;
    setDraggingIssue(null);
    if (moving.state === targetState) return;
    void updateIssue(moving.agentId, moving.id, { state: targetState, actor: "user" });
  };

  const filterAgent = filterAgentId ? agentMap.get(filterAgentId) : undefined;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="desktop-drag flex h-11 shrink-0 items-center gap-2 border-b border-line pr-[calc(1rem+var(--desktop-controls-inset))] pl-4">
        <h1 className="text-body font-medium text-fg">Issues</h1>
        <div className="flex-1" />
        {searchOpen ? (
          <div className="desktop-no-drag flex h-7 items-center gap-1.5 rounded-control border border-edge-strong bg-panel px-2">
            <Icon icon={Search01Icon} className="size-3.5 text-fg-muted" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder="Search issues…"
              className="w-44 bg-transparent text-label text-fg outline-none placeholder:text-fg-faint"
            />
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
              }}
              className="text-fg-muted hover:text-fg"
            >
              <Icon icon={Cancel01Icon} className="size-3" />
            </button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search issues"
            onClick={() => setSearchOpen(true)}
            className="desktop-no-drag"
          >
            <Icon icon={Search01Icon} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="New issue"
          onClick={() => openCreateInColumn("todo")}
          className="desktop-no-drag"
        >
          <Icon icon={Add01Icon} />
        </Button>
      </header>

      <div className="shrink-0 space-y-2 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-control border border-edge bg-panel p-0.5">
            {PRESET_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPreset(tab.id)}
                className={cn(
                  "cursor-pointer rounded-chip px-2.5 py-1 text-label font-medium transition-colors duration-(--dur-hover) ease-hover",
                  preset === tab.id
                    ? "bg-selected text-fg shadow-[inset_0_0_0_1px_var(--color-edge)]"
                    : "text-fg-muted hover:text-fg-secondary",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <Menu.Root>
            <Menu.Trigger
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-control border border-edge bg-panel px-2.5 text-label text-fg-secondary outline-none hover:border-edge-strong hover:text-fg",
                (filterAgentId !== null || filterPriority !== null) && "border-primary/40 text-fg",
              )}
            >
              <Icon icon={FilterHorizontalIcon} className="size-3.5" />
              <span>Filter</span>
            </Menu.Trigger>
            <MenuPopup label="Filter issues" align="end" className="min-w-52">
              <MenuGroupLabel>Agent</MenuGroupLabel>
              <Menu.Item
                onClick={() => setFilterAgentId(null)}
                className={cn(MENU_ITEM_CLASS, filterAgentId === null && "bg-selected text-fg")}
              >
                All agents
              </Menu.Item>
              {agents.map((agent) => (
                <Menu.Item
                  key={agent.id}
                  onClick={() => setFilterAgentId(agent.id)}
                  className={cn(
                    MENU_ITEM_CLASS,
                    filterAgentId === agent.id && "bg-selected text-fg",
                  )}
                >
                  <Identicon name={agent.name} style={agent.identiconStyle} size="sm" />
                  <span className="truncate">{agent.name}</span>
                </Menu.Item>
              ))}
              <MenuSeparator />
              <MenuGroupLabel>Priority</MenuGroupLabel>
              <Menu.Item
                onClick={() => setFilterPriority(null)}
                className={cn(MENU_ITEM_CLASS, filterPriority === null && "bg-selected text-fg")}
              >
                Any priority
              </Menu.Item>
              {ISSUE_PRIORITY_ORDER.map((p) => {
                const meta = ISSUE_PRIORITY_META[p];
                return (
                  <Menu.Item
                    key={p}
                    onClick={() => setFilterPriority(p)}
                    className={cn(MENU_ITEM_CLASS, filterPriority === p && "bg-selected text-fg")}
                  >
                    <Icon icon={meta.icon} className={cn("size-3.5", meta.iconClass)} />
                    <span>{meta.label}</span>
                  </Menu.Item>
                );
              })}
            </MenuPopup>
          </Menu.Root>

          <Button
            variant="outline"
            size="md"
            aria-label="Toggle Backlog, Done, and Canceled columns"
            onClick={() => setShowSecondaryColumns((prev) => !prev)}
            className={cn(
              "h-7 border-edge bg-panel px-2.5 text-label text-fg-secondary",
              showSecondaryColumns && "bg-selected text-fg",
            )}
          >
            <Icon icon={SlidersHorizontalIcon} className="size-3.5" />
            <span>{showSecondaryColumns ? "All columns" : "Active columns"}</span>
          </Button>
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 text-meta">
            {filterAgent && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-chip border border-edge bg-panel pr-1 pl-2 text-fg-secondary">
                <span className="text-fg-muted">Agent</span>
                <Identicon name={filterAgent.name} style={filterAgent.identiconStyle} size="sm" />
                <span className="text-fg">{filterAgent.name}</span>
                <button
                  type="button"
                  onClick={() => setFilterAgentId(null)}
                  className="grid size-4 cursor-pointer place-items-center rounded-chip text-fg-muted hover:text-fg"
                >
                  <Icon icon={Cancel01Icon} className="size-2.5" />
                </button>
              </span>
            )}
            {filterPriority && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-chip border border-edge bg-panel pr-1 pl-2 text-fg-secondary">
                <span className="text-fg-muted">Priority</span>
                <span className="text-fg">{ISSUE_PRIORITY_META[filterPriority].label}</span>
                <button
                  type="button"
                  onClick={() => setFilterPriority(null)}
                  className="grid size-4 cursor-pointer place-items-center rounded-chip text-fg-muted hover:text-fg"
                >
                  <Icon icon={Cancel01Icon} className="size-2.5" />
                </button>
              </span>
            )}
            {query.trim().length > 0 && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-chip border border-edge bg-panel pr-1 pl-2 text-fg-secondary">
                <span className="text-fg-muted">Search</span>
                <span className="text-fg">{query.trim()}</span>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="grid size-4 cursor-pointer place-items-center rounded-chip text-fg-muted hover:text-fg"
                >
                  <Icon icon={Cancel01Icon} className="size-2.5" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setFilterAgentId(null);
                setFilterPriority(null);
                setQuery("");
              }}
              className="ml-auto cursor-pointer text-label text-fg-muted hover:text-fg"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-x-auto px-2 py-2.5">
          {visibleColumns.map((state) => {
            const meta = ISSUE_STATE_META[state];
            const items = grouped[state];
            const isDropTarget = dragOverState === state;
            return (
              <div
                key={state}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverState !== state) setDragOverState(state);
                }}
                onDragLeave={() => {
                  if (dragOverState === state) setDragOverState(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDropOnColumn(state);
                }}
                className={cn(
                  "flex h-full w-[19rem] shrink-0 flex-col rounded-card px-2 py-1 transition-colors",
                  isDropTarget && "bg-primary/[0.06] ring-1 ring-primary/40",
                )}
              >
                <div className="mb-2 flex h-8 shrink-0 items-center gap-2 rounded-row bg-panel/70 px-2.5">
                  <Icon icon={meta.icon} className={cn("size-3.5 shrink-0", meta.iconClass)} />
                  <span className="text-label font-medium text-fg">{meta.label}</span>
                  <span className="font-mono text-meta text-fg-muted">{items.length}</span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    aria-label={`New issue in ${meta.label}`}
                    onClick={() => openCreateInColumn(state)}
                    className="grid size-6 cursor-pointer place-items-center rounded-chip text-fg-muted transition-colors hover:bg-(--wash) hover:text-fg"
                  >
                    <Icon icon={Add01Icon} className="size-3.5" />
                  </button>
                </div>

                <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4">
                  {items.length === 0 ? (
                    <div className="rounded-card px-3 py-6 text-center text-meta text-fg-faint">
                      No issues in {meta.label}
                    </div>
                  ) : (
                    items.map((issue) => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        agent={agentMap.get(issue.agentId)}
                        assigneeAgent={
                          issue.assignee.kind === "agent"
                            ? agentMap.get(issue.assignee.agentId)
                            : undefined
                        }
                        selected={issue.id === selectedIssueId}
                        onSelect={(clicked) => setSelectedIssueId(clicked.id)}
                        onDragStart={setDraggingIssue}
                      />
                    ))
                  )}

                  <button
                    type="button"
                    onClick={() => openCreateInColumn(state)}
                    className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-row px-2.5 text-label text-fg-faint transition-colors hover:bg-(--wash) hover:text-fg-secondary"
                  >
                    <Icon icon={Add01Icon} className="size-3.5" />
                    <span>New issue</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {selectedIssue && (
            <IssueDetailDrawer
              key={selectedIssue.id}
              issue={selectedIssue}
              agents={agents}
              allIssues={issues}
              onClose={() => setSelectedIssueId(null)}
              onSelectIssue={(next) => setSelectedIssueId(next.id)}
            />
          )}
        </AnimatePresence>
      </div>

      <CreateIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={agents}
        initialState={createInitialState}
        defaultAgentId={filterAgent?.id}
        onCreated={(created) => setSelectedIssueId(created.id)}
      />
    </section>
  );
}

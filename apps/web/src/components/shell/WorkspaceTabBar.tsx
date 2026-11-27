import { Menu } from "@base-ui/react/menu";
import {
  Add01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  GitForkIcon,
  HelpCircleIcon,
} from "@hugeicons/core-free-icons";
import type { Agent, AgentDelegation, Thread } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import {
  MENU_ITEM_CLASS,
  MenuGroupLabel,
  MenuPopup,
  MenuSeparator,
} from "@/components/ui/Menu.tsx";
import { cn } from "@/lib/utils.ts";
import { useWorkspaceSelector } from "@/lib/workspace.tsx";
import {
  closeOpenTab,
  pruneOpenTabs,
  readStoredTabs,
  tabFromPathname,
  tabKey,
  tabPath,
  upsertOpenTab,
  type WorkspaceTab,
  writeStoredTabs,
} from "@/lib/workspaceTabs.ts";
import { useWorkspaceHeaderSlot } from "./WorkspaceHeaderContext.tsx";

interface WorkspaceTabBarProps {
  readonly pathname: string;
  readonly onNewThread: () => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
}

function AgentAvatarBadge({
  agent,
  activeDelegations,
  isWorking,
}: {
  readonly agent: Agent;
  readonly activeDelegations: number;
  readonly isWorking: boolean;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <Identicon
        name={agent.name}
        style={agent.identiconStyle}
        size="sm"
        className="size-[1.25rem] rounded-[0.3125rem]"
      />
      <span
        className={cn(
          "absolute -right-1 -bottom-1 grid h-[0.875rem] min-w-[0.875rem] place-items-center rounded-full px-0.5 font-mono text-[0.5625rem] leading-none font-semibold ring-1 ring-canvas",
          agent.needsAttention
            ? "bg-danger text-white"
            : isWorking || activeDelegations > 0
              ? "bg-primary text-on-primary"
              : "bg-fg text-canvas",
        )}
      >
        {activeDelegations}
      </span>
    </span>
  );
}

function SubagentsMenu({
  agent,
  delegations,
  activePathname,
}: {
  readonly agent: Agent;
  readonly delegations: ReadonlyArray<AgentDelegation>;
  readonly activePathname: string;
}) {
  const navigate = useNavigate();
  const runningCount = delegations.filter(
    (d) => d.status === "running" || d.status === "waiting_parent",
  ).length;

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "desktop-no-drag inline-flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-row px-2 text-meta font-medium outline-none transition-colors duration-(--dur-hover) ease-hover",
          runningCount > 0
            ? "bg-primary/14 text-input hover:bg-primary/20"
            : "text-fg-muted hover:bg-(--wash) hover:text-fg",
        )}
      >
        {runningCount > 0 ? (
          <DotSpinner variant="working" label="Subagents running" className="size-3 text-input" />
        ) : (
          <Icon icon={GitForkIcon} className="size-3.5" />
        )}
        <span>{delegations.length}</span>
      </Menu.Trigger>
      <MenuPopup label="Sessions and subagents" align="start" className="min-w-64 max-w-80">
        <MenuGroupLabel>{agent.name} sessions</MenuGroupLabel>
        <Menu.Item
          onClick={() => void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })}
          className={cn(
            MENU_ITEM_CLASS,
            activePathname === `/agents/${agent.id}` && "bg-selected text-fg",
          )}
        >
          <Identicon name={agent.name} style={agent.identiconStyle} size="sm" />
          <span className="min-w-0 flex-1 truncate font-medium">Primary session</span>
        </Menu.Item>
        {delegations.length > 0 && (
          <>
            <MenuSeparator />
            <MenuGroupLabel>Subagents ({delegations.length})</MenuGroupLabel>
            {delegations.slice(0, 12).map((delegation) => {
              const isActive = activePathname === `/threads/${delegation.childThreadId}`;
              const isRunning =
                delegation.status === "running" || delegation.status === "waiting_parent";
              return (
                <Menu.Item
                  key={delegation.id}
                  onClick={() =>
                    void navigate({
                      to: "/threads/$threadId",
                      params: { threadId: delegation.childThreadId },
                    })
                  }
                  className={cn(MENU_ITEM_CLASS, isActive && "bg-selected text-fg")}
                >
                  {isRunning ? (
                    <DotSpinner variant="working" label="Running" className="size-3 text-input" />
                  ) : delegation.status === "completed" ? (
                    <Icon icon={CheckmarkCircle02Icon} className="size-3.5 text-success" />
                  ) : (
                    <Icon icon={HelpCircleIcon} className="size-3.5 text-fg-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{delegation.title}</span>
                  <span className="shrink-0 rounded-chip bg-fg/6 px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
                    {delegation.role}
                  </span>
                </Menu.Item>
              );
            })}
          </>
        )}
      </MenuPopup>
    </Menu.Root>
  );
}

export function WorkspaceTabBar({
  pathname,
  onNewThread,
  onVisibilityChange,
}: WorkspaceTabBarProps) {
  const navigate = useNavigate();
  const { setSlot } = useWorkspaceHeaderSlot();
  const loading = useWorkspaceSelector((s) => s.loading);
  const agents = useWorkspaceSelector((s) => s.agents);
  const threads = useWorkspaceSelector((s) => s.threads);
  const agentWork = useWorkspaceSelector((s) => s.agentWork);

  const [tabs, setTabs] = useState<ReadonlyArray<WorkspaceTab>>(readStoredTabs);

  const activeTab = tabFromPathname(pathname);
  const activeKey = activeTab ? tabKey(activeTab) : null;

  useEffect(() => {
    if (activeTab === null) return;
    setTabs((prev) => {
      const next = upsertOpenTab(prev, activeTab);
      if (next !== prev) writeStoredTabs(next);
      return next;
    });
  }, [activeKey]);

  useEffect(() => {
    if (loading) return;
    const validAgents = new Set<string>(agents.map((a) => a.id));
    const validThreads = new Set<string>(threads.map((t) => t.id));
    setTabs((prev) => {
      const next = pruneOpenTabs(prev, validAgents, validThreads);
      if (next !== prev) writeStoredTabs(next);
      return next;
    });
  }, [loading, agents, threads]);

  const isEligibleRoute = pathname.startsWith("/threads/") || pathname.startsWith("/agents/");
  const visible = isEligibleRoute && activeTab !== null;

  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  if (!visible) return null;

  const agentMap = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  const threadMap = new Map<string, Thread>(threads.map((t) => [t.id, t]));

  const delegationByChildThread = new Map<
    string,
    { readonly agent: Agent; readonly delegation: AgentDelegation }
  >();
  for (const agent of agents) {
    const delegations = agentWork[agent.id]?.delegations ?? [];
    for (const delegation of delegations) {
      delegationByChildThread.set(delegation.childThreadId, { agent, delegation });
    }
  }

  const focusedAgent: Agent | null = (() => {
    if (activeTab?.kind === "agent") {
      return agentMap.get(activeTab.agentId) ?? null;
    }
    if (activeTab?.kind === "thread") {
      return delegationByChildThread.get(activeTab.threadId)?.agent ?? null;
    }
    return null;
  })();
  const focusedDelegations = focusedAgent ? (agentWork[focusedAgent.id]?.delegations ?? []) : [];

  const handleCloseTab = (keyToClose: string) => {
    const result = closeOpenTab(tabs, keyToClose, activeKey);
    setTabs(result.tabs);
    writeStoredTabs(result.tabs);
    if (activeKey === keyToClose) {
      if (result.nextActive) {
        void navigate({ to: tabPath(result.nextActive) });
      } else {
        void navigate({ to: "/" });
      }
    }
  };

  return (
    <header className="desktop-drag flex h-11 shrink-0 items-center gap-1.5 border-b border-line pr-[calc(0.75rem+var(--desktop-controls-inset))] pl-2.5">
      <div
        role="tablist"
        aria-label="Open sessions"
        className="scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto py-1"
      >
        {tabs.map((tab) => {
          const key = tabKey(tab);
          const isActive = key === activeKey;
          if (tab.kind === "agent") {
            const agent = agentMap.get(tab.agentId);
            if (!agent) return null;
            const primary = threadMap.get(agent.primaryThreadId);
            const activeDelegations =
              agentWork[agent.id]?.delegations.filter(
                (d) => d.status === "running" || d.status === "waiting_parent",
              ).length ??
              agent.activeDelegationCount ??
              0;
            const isWorking = primary?.status.kind === "running";
            return (
              <div
                key={key}
                role="tab"
                aria-selected={isActive}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    handleCloseTab(key);
                  }
                }}
                className={cn(
                  "desktop-no-drag group/tab relative flex h-8 shrink-0 items-center gap-2 rounded-row pr-1.5 pl-2 text-label transition-colors duration-(--dur-hover) ease-hover",
                  isActive
                    ? "bg-selected text-fg shadow-[inset_0_0_0_1px_var(--color-edge)]"
                    : "text-fg-secondary hover:bg-(--wash) hover:text-fg",
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } })
                  }
                  className="flex min-w-0 cursor-pointer items-center gap-2 outline-none"
                >
                  <AgentAvatarBadge
                    agent={agent}
                    activeDelegations={activeDelegations}
                    isWorking={isWorking}
                  />
                  <span className="max-w-[10.5rem] truncate font-medium">{agent.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${agent.name}`}
                  onClick={() => handleCloseTab(key)}
                  className={cn(
                    "grid size-4 shrink-0 cursor-pointer place-items-center rounded-chip text-fg-muted outline-none transition-opacity hover:bg-fg/10 hover:text-fg",
                    isActive
                      ? "opacity-60 hover:opacity-100"
                      : "opacity-0 group-hover/tab:opacity-80",
                  )}
                >
                  <Icon icon={Cancel01Icon} className="size-3" />
                </button>
              </div>
            );
          }

          const thread = threadMap.get(tab.threadId);
          if (!thread) return null;
          const delegationMatch = delegationByChildThread.get(thread.id);
          const isRunning =
            thread.status.kind === "running" || thread.status.kind === "needs-input";
          return (
            <div
              key={key}
              role="tab"
              aria-selected={isActive}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  handleCloseTab(key);
                }
              }}
              className={cn(
                "desktop-no-drag group/tab relative flex h-8 shrink-0 items-center gap-2 rounded-row pr-1.5 pl-2 text-label transition-colors duration-(--dur-hover) ease-hover",
                isActive
                  ? "bg-selected text-fg shadow-[inset_0_0_0_1px_var(--color-edge)]"
                  : "text-fg-secondary hover:bg-(--wash) hover:text-fg",
              )}
            >
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/threads/$threadId", params: { threadId: thread.id } })
                }
                className="flex min-w-0 cursor-pointer items-center gap-2 outline-none"
              >
                {delegationMatch ? (
                  <span className="relative inline-flex shrink-0">
                    <Identicon
                      name={delegationMatch.agent.name}
                      style={delegationMatch.agent.identiconStyle}
                      size="sm"
                      className="size-[1.125rem] rounded-[0.25rem]"
                    />
                    <span className="absolute -right-1 -bottom-1 grid size-3 place-items-center rounded-full bg-panel text-fg-secondary ring-1 ring-canvas">
                      <Icon icon={GitForkIcon} className="size-2" />
                    </span>
                  </span>
                ) : (
                  <Identicon
                    name={thread.projectName}
                    size="sm"
                    className="size-[1.125rem] rounded-[0.25rem]"
                  />
                )}
                <span className="max-w-[11rem] truncate font-medium">{thread.title}</span>
                {isRunning && (
                  <DotSpinner variant="working" label="Working" className="size-3 text-input" />
                )}
              </button>
              <button
                type="button"
                aria-label={`Close ${thread.title}`}
                onClick={() => handleCloseTab(key)}
                className={cn(
                  "grid size-4 shrink-0 cursor-pointer place-items-center rounded-chip text-fg-muted outline-none transition-opacity hover:bg-fg/10 hover:text-fg",
                  isActive
                    ? "opacity-60 hover:opacity-100"
                    : "opacity-0 group-hover/tab:opacity-80",
                )}
              >
                <Icon icon={Cancel01Icon} className="size-3" />
              </button>
            </div>
          );
        })}

        {focusedAgent && focusedDelegations.length > 0 && (
          <SubagentsMenu
            agent={focusedAgent}
            delegations={focusedDelegations}
            activePathname={pathname}
          />
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="New thread"
          onClick={onNewThread}
          className="desktop-no-drag shrink-0 text-fg-muted hover:text-fg"
        >
          <Icon icon={Add01Icon} />
        </Button>
      </div>

      <div ref={setSlot} className="desktop-no-drag ml-auto flex shrink-0 items-center gap-1.5" />
    </header>
  );
}

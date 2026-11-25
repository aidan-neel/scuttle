import { Tabs } from "@base-ui/react/tabs";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { Agent } from "@scuttle/contracts";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import type { AgentWork } from "@/lib/agentState.ts";
import { cn } from "@/lib/utils";
import { AgentIssuesTab } from "./AgentIssuesTab.tsx";
import { AgentMemoryTab } from "./AgentMemoryTab.tsx";
import { AgentOverviewTab } from "./AgentOverviewTab.tsx";

export type InspectorTab = "overview" | "issues" | "memory";

const TABS: ReadonlyArray<{ readonly value: InspectorTab; readonly label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "issues", label: "Issues" },
  { value: "memory", label: "Memory" },
];

const TAB_CLASS =
  "flex h-7 cursor-default items-center gap-1.5 rounded-chip px-2 text-label text-fg-muted outline-none select-none transition-colors duration-100 hover:text-fg focus-visible:shadow-focus data-active:bg-(--wash) data-active:text-fg";

const PANEL_CLASS = "min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 outline-none";

interface AgentInspectorProps {
  readonly agent: Agent;
  readonly work: AgentWork;
  readonly tab: InspectorTab;
  readonly onTabChange: (tab: InspectorTab) => void;
  readonly delegateOpen: boolean;
  readonly onDelegateOpenChange: (open: boolean) => void;
  readonly onClose?: () => void;
  readonly className?: string;
}

export function AgentInspector({
  agent,
  work,
  tab,
  onTabChange,
  delegateOpen,
  onDelegateOpenChange,
  onClose,
  className,
}: AgentInspectorProps) {
  const openIssues = work.issues.filter(
    (issue) => issue.state !== "done" && issue.state !== "canceled",
  ).length;

  return (
    <aside
      aria-label={`${agent.name} inspector`}
      className={cn(
        "flex w-[340px] shrink-0 flex-col border-l border-line bg-canvas xl:w-[370px]",
        className,
      )}
    >
      <Tabs.Root
        value={tab}
        onValueChange={(value: unknown) => {
          const picked = TABS.find((item) => item.value === value);
          if (picked !== undefined) onTabChange(picked.value);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
          {TABS.map((item) => (
            <Tabs.Tab key={item.value} value={item.value} className={TAB_CLASS}>
              {item.label}
              {item.value === "issues" && openIssues > 0 && (
                <span className="font-mono text-meta text-fg-faint tabular-nums">{openIssues}</span>
              )}
            </Tabs.Tab>
          ))}
          {onClose !== undefined && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close inspector"
              onClick={onClose}
              className="ml-auto"
            >
              <Icon icon={Cancel01Icon} />
            </Button>
          )}
        </Tabs.List>
        <Tabs.Panel value="overview" className={PANEL_CLASS}>
          <AgentOverviewTab
            agent={agent}
            work={work}
            delegateOpen={delegateOpen}
            onDelegateOpenChange={onDelegateOpenChange}
          />
        </Tabs.Panel>
        <Tabs.Panel value="issues" className={PANEL_CLASS}>
          <AgentIssuesTab agent={agent} issues={work.issues} />
        </Tabs.Panel>
        <Tabs.Panel value="memory" className={PANEL_CLASS}>
          <AgentMemoryTab agent={agent} memories={work.memories} />
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}

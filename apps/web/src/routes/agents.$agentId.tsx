import { RefreshIcon, SidebarRightIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import { isAgentId } from "@scuttle/shared/ids";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AgentConversation } from "@/components/agents/AgentConversation.tsx";
import { AgentInspector, type InspectorTab } from "@/components/agents/AgentInspector.tsx";
import { useTask } from "@/components/agents/useTask.ts";
import { ThreadGitPopover } from "@/components/git/ThreadGitPopover.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/agents/$agentId")({
  component: AgentPage,
});

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | { readonly kind: "error"; readonly message: string };

function AgentPage() {
  const { agentId } = Route.useParams();
  return <AgentView key={agentId} agentId={agentId} />;
}

function AgentView({ agentId }: { readonly agentId: string }) {
  const navigate = useNavigate();
  const { agents, agentWork, threadDetails, loadAgentDetail, updateAgent, runCheckIn } =
    useWorkspace();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [delegateOpen, setDelegateOpen] = useState(false);
  const task = useTask();

  useEffect(() => {
    let active = true;
    setLoad({ kind: "loading" });
    if (!isAgentId(agentId)) {
      setLoad({ kind: "error", message: "This agent link is not valid." });
      return;
    }
    loadAgentDetail(agentId).then(
      () => active && setLoad({ kind: "loaded" }),
      (error: unknown) =>
        active &&
        setLoad({ kind: "error", message: describeApiError(error, "Failed to load agent.") }),
    );
    return () => {
      active = false;
    };
  }, [agentId]);

  const agent = agents.find((candidate) => candidate.id === agentId);
  const work = agentWork[agentId];
  const detail = agent === undefined ? undefined : threadDetails[agent.primaryThreadId];
  const needsAttention = agent?.needsAttention === true;

  useEffect(() => {
    if (needsAttention && isAgentId(agentId)) {
      void updateAgent(agentId, { needsAttention: false });
    }
  }, [agentId, needsAttention]);

  if (load.kind === "error" || (load.kind === "loaded" && agent === undefined)) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body text-fg-secondary">
          {load.kind === "error" ? load.message : "This agent was removed."}
        </p>
        <Button variant="secondary" onClick={() => void navigate({ to: "/" })}>
          Back to home
        </Button>
      </section>
    );
  }

  if (agent === undefined || work === undefined || detail === undefined) {
    return (
      <section className="flex flex-1 items-center justify-center gap-2 text-label text-fg-muted">
        <DotSpinner variant="loading" label="Loading agent" />
        Loading agent…
      </section>
    );
  }

  const checkIn = () =>
    void task.run("checkin", () => runCheckIn(agent.id), "Could not run a check-in.");

  return (
    <section className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
          <Identicon name={agent.name} size="sm" />
          <h1 className="min-w-0 flex-1 truncate text-body font-medium text-fg">{agent.name}</h1>
          {task.error !== null && (
            <span role="alert" className="max-w-64 truncate text-label text-danger">
              {task.error}
            </span>
          )}
          <ThreadGitPopover
            target={{ projectId: agent.projectId, threadId: agent.primaryThreadId }}
            fallbackBranch={detail.thread.branch}
            refreshKey={`${detail.thread.status.kind}:${detail.turns.length}`}
          />
          <Button variant="ghost" size="sm" disabled={task.busy === "checkin"} onClick={checkIn}>
            {task.busy === "checkin" ? (
              <DotSpinner variant="working" label="Checking in" />
            ) : (
              <Icon icon={RefreshIcon} />
            )}
            Check in
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen((open) => !open)}
            className={cn(inspectorOpen && "bg-(--wash) text-fg")}
          >
            <Icon icon={SidebarRightIcon} />
          </Button>
        </header>
        <AgentConversation
          agent={agent}
          detail={detail}
          onViewAgent={() => setInspectorOpen((open) => !open)}
        />
      </div>
      {inspectorOpen && (
        <>
          <button
            type="button"
            aria-label="Close inspector"
            onClick={() => setInspectorOpen(false)}
            className="absolute inset-0 z-10 bg-black/40 lg:hidden"
          />
          <AgentInspector
            agent={agent}
            work={work}
            tab={tab}
            onTabChange={setTab}
            delegateOpen={delegateOpen}
            onDelegateOpenChange={setDelegateOpen}
            onClose={() => setInspectorOpen(false)}
            className="absolute inset-y-0 right-0 z-20 shadow-menu lg:static lg:shadow-none"
          />
        </>
      )}
    </section>
  );
}

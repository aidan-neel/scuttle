import { describeApiError } from "@scuttle/client-runtime";
import { isAgentId } from "@scuttle/shared/ids";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AgentHeaderMenu } from "@/components/agents/AgentActionsMenu.tsx";
import { AgentConversation } from "@/components/agents/AgentConversation.tsx";
import { AgentCostPopover } from "@/components/agents/AgentCostPopover.tsx";
import { AgentProfileDialog } from "@/components/agents/AgentProfileDialog.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
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
  const { agents, agentWork, threadDetails, loadAgentDetail, updateAgent, deleteAgent } =
    useWorkspace();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

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

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <Identicon name={agent.name} size="sm" />
        <h1 className="min-w-0 flex-1 truncate text-body font-medium text-fg">{agent.name}</h1>
        <AgentCostPopover
          agent={agent}
          primaryThread={detail.thread}
          delegations={work.delegations}
        />
        <AgentHeaderMenu
          agent={agent}
          handlers={{
            onOpenProfile: () => setProfileOpen(true),
            onRequestRemove: () => setConfirmRemove(true),
          }}
        />
      </header>
      <AgentConversation agent={agent} detail={detail} onViewAgent={() => setProfileOpen(true)} />
      <AgentProfileDialog agent={agent} open={profileOpen} onOpenChange={setProfileOpen} />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${agent.name}?`}
        description="This removes the agent, its conversation, and its memory from Scuttle. The project and files on disk are not touched."
        confirmLabel="Remove agent"
        onConfirm={async () => {
          await deleteAgent(agent.id);
          void navigate({ to: "/" });
        }}
      />
    </section>
  );
}

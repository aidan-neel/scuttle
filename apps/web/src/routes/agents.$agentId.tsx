import { AlertCircleIcon, HelpCircleIcon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import { isAgentId } from "@scuttle/shared/ids";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Skeleton } from "skullet/react";
import { AgentHeaderMenu } from "@/components/agents/AgentActionsMenu.tsx";
import { AgentConversation } from "@/components/agents/AgentConversation.tsx";
import { AgentCostPopover } from "@/components/agents/AgentCostPopover.tsx";
import { AgentProfileDialog } from "@/components/agents/AgentProfileDialog.tsx";
import { WorkspaceHeaderActions } from "@/components/shell/WorkspaceHeaderContext.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { ConversationPageSkeleton } from "@/components/ui/SkeletonSamples.tsx";
import { formatAgentWorkingLabel, resolveAgentActivityStatus } from "@/lib/agentStatus.ts";
import { useThreadDetail, useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";

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
  const agent = useWorkspaceSelector((s) => s.agents.find((candidate) => candidate.id === agentId));
  const work = useWorkspaceSelector((s) => s.agentWork[agentId]);
  const primaryThreadId = agent?.primaryThreadId ?? null;
  const detail = useThreadDetail(primaryThreadId ?? "");
  const { loadAgentDetail, updateAgent, deleteAgent, setActiveThread } = useWorkspaceActions();
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

  useEffect(() => {
    setActiveThread(primaryThreadId);
    return () => {
      setActiveThread(null);
    };
  }, [primaryThreadId, setActiveThread]);

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

  const isLoading = agent === undefined || work === undefined || detail === undefined;
  const activityStatus =
    agent !== undefined && detail !== undefined
      ? resolveAgentActivityStatus(agent, detail.thread, work?.delegations)
      : null;

  return (
    <Skeleton loading={isLoading} id="agent-page" label="Loading agent" className="skullet-fill">
      {isLoading ? (
        <ConversationPageSkeleton showBreadcrumb={false} />
      ) : (
        <section className="relative flex min-h-0 flex-1 flex-col">
          <WorkspaceHeaderActions>
            {activityStatus?.kind === "working" && (
              <span
                role="status"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-input/10 px-2 py-0.5 text-meta font-medium text-input"
              >
                <DotSpinner variant="working" label="Working" className="size-3 text-input" />
                {formatAgentWorkingLabel(activityStatus.activeDelegations)}
              </span>
            )}
            {activityStatus?.kind === "needs-input" && (
              <span
                role="status"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-input/10 px-2 py-0.5 text-meta font-medium text-input"
              >
                <Icon icon={HelpCircleIcon} className="size-3" />
                Input needed
              </span>
            )}
            {activityStatus?.kind === "error" && (
              <span
                role="status"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-meta font-medium text-danger"
              >
                <Icon icon={AlertCircleIcon} className="size-3" />
                Error
              </span>
            )}
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
          </WorkspaceHeaderActions>
          <AgentConversation
            agent={agent}
            detail={detail}
            onViewAgent={() => setProfileOpen(true)}
          />
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
      )}
    </Skeleton>
  );
}

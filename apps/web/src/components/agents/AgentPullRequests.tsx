import {
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  RefreshIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, ForgeKind, GitStatus, PullRequest } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { getGitApi, openExternalUrl } from "@/components/git/gitApi.ts";
import { REQUEST_NOUN } from "@/components/git/GitPullRequestsPanel.tsx";
import { useGitStatus } from "@/components/git/useGitStatus.ts";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { EmptyLine, ErrorLine, InspectorSection } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

type ListState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly forge: ForgeKind;
      readonly items: ReadonlyArray<PullRequest>;
    }
  | { readonly kind: "error"; readonly message: string };

const prBrief = (forge: ForgeKind, item: PullRequest) => {
  const noun = REQUEST_NOUN[forge].long;
  return [
    `Take over ${noun} #${item.number}: ${item.title}`,
    `URL: ${item.url}`,
    `Branch: ${item.headBranch} → ${item.baseBranch}`,
    "Check CI and review comments, fix what is failing at its cause, and drive it to merge-ready.",
  ].join("\n");
};

const unsupportedReason = (status: GitStatus): string | null => {
  if (status.kind === "not-a-repo") return "This project is not a Git repository.";
  if (status.forge === "github" || status.forge === "gitlab") return null;
  return status.remote === null
    ? "This repository has no remote."
    : `Remote ${status.remote.name} is not on GitHub or GitLab.`;
};

export function AgentPullRequests({ agent }: { readonly agent: Agent }) {
  const { delegateTask } = useWorkspace();
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const git = useGitStatus({ projectId: agent.projectId }, String(reloadKey));
  const notice = git.status === null ? null : unsupportedReason(git.status);
  const supported = git.status !== null && notice === null;
  const task = useTask();

  useEffect(() => {
    if (!supported) return;
    let active = true;
    setState({ kind: "loading" });
    getGitApi()
      .then((api) => api.listPullRequests({ projectId: agent.projectId }))
      .then(
        (list) => active && setState({ kind: "ready", forge: list.forge, items: list.items }),
        (error: unknown) =>
          active &&
          setState({
            kind: "error",
            message: describeApiError(error, "Could not load pull requests."),
          }),
      );
    return () => {
      active = false;
    };
  }, [agent.projectId, reloadKey, supported]);

  const launch = (forge: ForgeKind, item: PullRequest) =>
    void task.run(
      `pr-${item.number}`,
      () =>
        delegateTask(agent.id, {
          role: "workhorse",
          kind: "pr",
          title: `${REQUEST_NOUN[forge].short} #${item.number}: ${item.title}`,
          brief: prBrief(forge, item),
        }),
      "Could not launch the PR agent.",
    );

  return (
    <InspectorSection
      title={
        state.kind === "ready" && state.forge === "gitlab" ? "Merge requests" : "Pull requests"
      }
      count={supported && state.kind === "ready" ? state.items.length : undefined}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh pull requests"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          {git.loading || (supported && state.kind === "loading") ? (
            <DotSpinner variant="loading" label="Loading" />
          ) : (
            <Icon icon={RefreshIcon} />
          )}
        </Button>
      }
    >
      <ErrorLine message={git.error} />
      {notice !== null && <EmptyLine>{notice}</EmptyLine>}
      {supported && state.kind === "error" && <ErrorLine message={state.message} />}
      {supported && state.kind === "ready" && state.items.length === 0 && (
        <EmptyLine>No open {REQUEST_NOUN[state.forge].long}s.</EmptyLine>
      )}
      {supported && state.kind === "ready" && (
        <ul className="flex flex-col gap-px">
          {state.items.map((item) => (
            <li
              key={item.number}
              className="group/pr flex items-start gap-1 rounded-card pr-1 transition-colors duration-100 hover:bg-(--wash)"
            >
              <button
                type="button"
                onClick={() => openExternalUrl(item.url)}
                className="flex min-w-0 flex-1 items-start gap-2 rounded-chip py-1.5 pl-2 text-left outline-none focus-visible:shadow-focus"
              >
                <Icon
                  icon={item.isDraft ? GitPullRequestDraftIcon : GitPullRequestIcon}
                  className={
                    item.isDraft ? "mt-0.5 size-3.5 text-fg-muted" : "mt-0.5 size-3.5 text-success"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-fg">
                    <span className="font-mono text-fg-muted">
                      {state.forge === "gitlab" ? "!" : "#"}
                      {item.number}
                    </span>{" "}
                    {item.title}
                  </span>
                  <span className="block truncate font-mono text-meta text-fg-muted">
                    {item.baseBranch} ← {item.headBranch}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Launch PR agent for #${item.number}`}
                title="Launch PR agent"
                disabled={task.busy !== null}
                onClick={() => launch(state.forge, item)}
                className="mt-1 opacity-0 transition-opacity duration-150 group-hover/pr:opacity-100 focus-visible:opacity-100"
              >
                {task.busy === `pr-${item.number}` ? (
                  <DotSpinner variant="working" label="Launching" />
                ) : (
                  <Icon icon={Rocket01Icon} />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ErrorLine message={task.error} />
    </InspectorSection>
  );
}

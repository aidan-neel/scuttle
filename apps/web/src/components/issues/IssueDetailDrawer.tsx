import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
  Cancel01Icon,
  Delete02Icon,
  SentIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { Agent, AgentIssue, UpdateIssueInput } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { MarkdownView } from "@/components/thread/MarkdownView.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { easeOut } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";
import { useWorkspaceActions, useWorkspaceSelector } from "@/lib/workspace.tsx";
import { formatRelativeIssueTime, ISSUE_STATE_META } from "./issueMeta.ts";
import { IssuePropertyBar } from "./IssuePropertyBar.tsx";

interface IssueDetailDrawerProps {
  readonly issue: AgentIssue;
  readonly agents: ReadonlyArray<Agent>;
  readonly allIssues: ReadonlyArray<AgentIssue>;
  readonly onClose: () => void;
  readonly onSelectIssue: (issue: AgentIssue) => void;
}

type ActivityTab = "all" | "comments" | "updates";

export function IssueDetailDrawer({
  issue,
  agents,
  allIssues,
  onClose,
  onSelectIssue,
}: IssueDetailDrawerProps) {
  const navigate = useNavigate();
  const { updateIssue, deleteIssue, loadIssueActivities, createIssueComment, assignIssue } =
    useWorkspaceActions();
  const activities = useWorkspaceSelector((s) => s.issueActivities[issue.id]);

  const [expanded, setExpanded] = useState(false);
  const [activityTab, setActivityTab] = useState<ActivityTab>("all");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(issue.description);
  const [commentBody, setCommentBody] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [runningAgent, setRunningAgent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitleDraft(issue.title);
    setDescDraft(issue.description);
    setEditingTitle(false);
    setEditingDesc(false);
    setError(null);
  }, [issue.id]);

  useEffect(() => {
    let active = true;
    void loadIssueActivities(issue.agentId, issue.id).catch((err: unknown) => {
      if (active) setError(describeApiError(err, "Failed to load activity."));
    });
    return () => {
      active = false;
    };
  }, [issue.agentId, issue.id]);

  const agent = agents.find((a) => a.id === issue.agentId);
  const stateMeta = ISSUE_STATE_META[issue.state];

  const handlePatch = (patch: UpdateIssueInput) => {
    setError(null);
    void updateIssue(issue.agentId, issue.id, patch).catch((err: unknown) => {
      setError(describeApiError(err, "Failed to update issue."));
    });
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed.length === 0 || trimmed === issue.title) {
      setTitleDraft(issue.title);
      return;
    }
    handlePatch({ title: trimmed, actor: "user" });
  };

  const commitDesc = () => {
    setEditingDesc(false);
    if (descDraft === issue.description) return;
    handlePatch({ description: descDraft, actor: "user" });
  };

  const handleSendComment = async () => {
    const trimmed = commentBody.trim();
    if (trimmed.length === 0 || sendingComment) return;
    setSendingComment(true);
    setError(null);
    try {
      await createIssueComment(issue.agentId, issue.id, { body: trimmed, actor: "user" });
      setCommentBody("");
    } catch (err) {
      setError(describeApiError(err, "Failed to post comment."));
    } finally {
      setSendingComment(false);
    }
  };

  const handleRunWithAgent = async () => {
    if (runningAgent) return;
    setRunningAgent(true);
    setError(null);
    try {
      const targetAgentId =
        issue.assignee.kind === "agent" ? issue.assignee.agentId : issue.agentId;
      await assignIssue(targetAgentId, issue.id, { mode: "agent" });
      void navigate({ to: "/agents/$agentId", params: { agentId: targetAgentId } });
    } catch (err) {
      setError(describeApiError(err, "Failed to start agent on issue."));
    } finally {
      setRunningAgent(false);
    }
  };

  const visibleActivities = (activities ?? []).filter((item) => {
    if (activityTab === "comments") return item.kind === "comment";
    if (activityTab === "updates") return item.kind !== "comment";
    return true;
  });

  return (
    <>
      <motion.aside
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ duration: 0.16, ease: easeOut }}
        className={cn(
          "relative z-20 flex h-full shrink-0 flex-col border-l border-line bg-canvas shadow-dialog",
          expanded ? "w-[min(54rem,calc(100vw-16rem))]" : "w-[min(36rem,calc(100vw-4rem))]",
        )}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2.5 pl-4">
          <Icon icon={stateMeta.icon} className={cn("size-4 shrink-0", stateMeta.iconClass)} />
          <span className="shrink-0 font-mono text-label font-medium text-fg-muted">
            {issue.key}
          </span>
          <span className="min-w-0 flex-1 truncate text-label font-medium text-fg">
            {issue.title}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={expanded ? "Restore drawer width" : "Expand drawer"}
            onClick={() => setExpanded((prev) => !prev)}
          >
            <Icon icon={expanded ? ArrowShrink01Icon : ArrowExpand01Icon} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete issue"
            onClick={() => setConfirmDelete(true)}
            className="hover:text-danger"
          >
            <Icon icon={Delete02Icon} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close detail" onClick={onClose}>
            <Icon icon={Cancel01Icon} />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && (
            <div className="mb-4 rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-label text-danger">
              {error}
            </div>
          )}

          {editingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") {
                  setTitleDraft(issue.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full rounded-control bg-panel px-2 py-1 text-[1.25rem] leading-snug font-semibold tracking-tight text-fg shadow-raised outline-none focus-visible:shadow-focus"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="block w-full cursor-text text-left text-[1.25rem] leading-snug font-semibold tracking-tight text-fg outline-none hover:text-white"
            >
              {issue.title}
            </button>
          )}

          <div className="mt-1.5 mb-4 flex items-center gap-2 text-meta text-fg-muted">
            <span className="font-mono">{issue.key}</span>
            <span>·</span>
            <span>{formatRelativeIssueTime(issue.createdAt)}</span>
            <span>·</span>
            <span>Created by {issue.createdBy === "agent" ? (agent?.name ?? "agent") : "you"}</span>
          </div>

          <IssuePropertyBar
            issue={issue}
            agent={agent}
            agents={agents}
            allIssues={allIssues}
            running={runningAgent}
            onPatch={handlePatch}
            onRunWithAgent={() => void handleRunWithAgent()}
            onOpenAgent={(agentId) =>
              void navigate({ to: "/agents/$agentId", params: { agentId } })
            }
            onOpenThread={(threadId) =>
              void navigate({ to: "/threads/$threadId", params: { threadId } })
            }
            onSelectRelated={onSelectIssue}
          />

          <div className="mt-5 border-t border-line pt-4">
            {editingDesc ? (
              <div className="space-y-2">
                <textarea
                  rows={7}
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  placeholder="Write a description (Markdown supported)…"
                  className="w-full resize-y rounded-control bg-panel px-3 py-2 text-label leading-[1.55] text-fg shadow-raised outline-none focus-visible:shadow-focus"
                />
                <div className="flex justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDescDraft(issue.description);
                      setEditingDesc(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={commitDesc}>
                    Save
                  </Button>
                </div>
              </div>
            ) : issue.description.trim().length > 0 ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setEditingDesc(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingDesc(true);
                }}
                title="Click to edit description"
                className="group/desc relative cursor-text rounded-card p-1 -mx-1 transition-colors hover:bg-fg/[0.02]"
              >
                <MarkdownView content={issue.description} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingDesc(true)}
                className="w-full cursor-text rounded-control border border-dashed border-edge px-3 py-3 text-left text-label text-fg-faint transition-colors hover:border-edge-strong hover:text-fg-muted"
              >
                Add a description…
              </button>
            )}
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-label font-medium text-fg-muted">Activity</h3>
              <div className="flex items-center gap-0.5 rounded-control bg-panel p-0.5">
                {(
                  [
                    ["all", "All"],
                    ["comments", "Comments"],
                    ["updates", "Updates"],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActivityTab(tab)}
                    className={cn(
                      "cursor-pointer rounded-chip px-2 py-0.5 text-meta font-medium transition-colors",
                      activityTab === tab
                        ? "bg-selected text-fg"
                        : "text-fg-muted hover:text-fg-secondary",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {visibleActivities.length === 0 ? (
                <p className="text-label text-fg-faint">No activity yet.</p>
              ) : (
                visibleActivities.map((item) => {
                  const actorAgent = item.actorAgentId
                    ? agents.find((a) => a.id === item.actorAgentId)
                    : item.actorKind === "agent"
                      ? agent
                      : undefined;
                  const actorName =
                    item.actorKind === "agent" ? (actorAgent?.name ?? "Agent") : "You";
                  if (item.kind === "comment") {
                    return (
                      <div key={item.id} className="rounded-card bg-panel p-3 shadow-raised">
                        <div className="mb-1.5 flex items-center gap-2">
                          {item.actorKind === "agent" && actorAgent ? (
                            <Identicon
                              name={actorAgent.name}
                              style={actorAgent.identiconStyle}
                              size="sm"
                            />
                          ) : (
                            <span className="grid size-4 place-items-center rounded-full bg-avatar text-on-avatar">
                              <Icon icon={UserIcon} className="size-2.5" />
                            </span>
                          )}
                          <span className="text-label font-medium text-fg">{actorName}</span>
                          <span className="text-meta text-fg-faint">
                            {formatRelativeIssueTime(item.createdAt)}
                          </span>
                        </div>
                        <MarkdownView content={item.body} />
                      </div>
                    );
                  }
                  return (
                    <div key={item.id} className="flex items-center gap-2 text-meta text-fg-muted">
                      {item.actorKind === "agent" && actorAgent ? (
                        <Identicon
                          name={actorAgent.name}
                          style={actorAgent.identiconStyle}
                          size="sm"
                          className="size-3.5"
                        />
                      ) : (
                        <span className="grid size-3.5 place-items-center rounded-full bg-avatar text-on-avatar">
                          <Icon icon={UserIcon} className="size-2" />
                        </span>
                      )}
                      <span className="font-medium text-fg-secondary">{actorName}</span>
                      <span className="min-w-0 flex-1 truncate">{item.body}</span>
                      <span className="shrink-0 text-fg-faint">
                        {formatRelativeIssueTime(item.createdAt)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-line p-4">
          <div className="rounded-composer bg-panel p-2.5 shadow-composer focus-within:shadow-composer-focus">
            <textarea
              rows={2}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleSendComment();
                }
              }}
              placeholder={
                issue.assignee.kind === "agent"
                  ? "Leave a comment (notifies assigned agent)…"
                  : "Leave a comment…"
              }
              className="w-full resize-none bg-transparent text-label leading-[1.45] text-fg outline-none placeholder:text-fg-faint"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[0.6875rem] text-fg-faint">Ctrl+Enter to send</span>
              <Button
                variant="primary"
                size="icon"
                aria-label="Send comment"
                disabled={sendingComment || commentBody.trim().length === 0}
                onClick={() => void handleSendComment()}
              >
                <Icon icon={SentIcon} />
              </Button>
            </div>
          </div>
        </div>
      </motion.aside>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${issue.key}?`}
        description="This removes the issue and its activity history from Scuttle."
        confirmLabel="Delete issue"
        onConfirm={async () => {
          await deleteIssue(issue.agentId, issue.id);
          onClose();
        }}
      />
    </>
  );
}

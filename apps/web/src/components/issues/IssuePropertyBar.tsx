import { Menu } from "@base-ui/react/menu";
import {
  Add01Icon,
  ArrowUpRight01Icon,
  Calendar03Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Link01Icon,
  PlayIcon,
  Tag01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type {
  Agent,
  AgentIssue,
  AgentIssueAssignee,
  AgentIssuePriority,
  AgentIssueState,
  UpdateIssueInput,
} from "@scuttle/contracts";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { MENU_ITEM_CLASS, MenuPopup, MenuSeparator } from "@/components/ui/Menu.tsx";
import { cn } from "@/lib/utils.ts";
import {
  ISSUE_PRIORITY_META,
  ISSUE_PRIORITY_ORDER,
  ISSUE_STATE_META,
  ISSUE_STATE_ORDER,
} from "./issueMeta.ts";

interface IssuePropertyBarProps {
  readonly issue: AgentIssue;
  readonly agent: Agent | undefined;
  readonly agents: ReadonlyArray<Agent>;
  readonly allIssues: ReadonlyArray<AgentIssue>;
  readonly running: boolean;
  readonly onPatch: (patch: UpdateIssueInput) => void;
  readonly onRunWithAgent: () => void;
  readonly onOpenAgent: (agentId: string) => void;
  readonly onOpenThread: (threadId: string) => void;
  readonly onSelectRelated: (issue: AgentIssue) => void;
}

const PILL_CLASS =
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-control border border-edge bg-panel px-2.5 text-label font-medium text-fg-secondary outline-none transition-colors duration-(--dur-hover) ease-hover hover:border-edge-strong hover:bg-raised hover:text-fg focus-visible:shadow-focus";

export function IssuePropertyBar({
  issue,
  agent,
  agents,
  allIssues,
  running,
  onPatch,
  onRunWithAgent,
  onOpenAgent,
  onOpenThread,
  onSelectRelated,
}: IssuePropertyBarProps) {
  const [addingLabel, setAddingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [editingDue, setEditingDue] = useState(false);

  const stateMeta = ISSUE_STATE_META[issue.state];
  const priorityMeta = ISSUE_PRIORITY_META[issue.priority];
  const assignee = issue.assignee;
  const assigneeAgent =
    assignee.kind === "agent" ? agents.find((a) => a.id === assignee.agentId) : undefined;
  const relatedIssue = issue.relatedIssueId
    ? allIssues.find((i) => i.id === issue.relatedIssueId)
    : undefined;
  const otherIssues = allIssues.filter((i) => i.id !== issue.id);

  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    setAddingLabel(false);
    setLabelDraft("");
    if (trimmed.length === 0 || issue.labels.includes(trimmed)) return;
    onPatch({ labels: [...issue.labels, trimmed], actor: "user" });
  };

  const removeLabel = (label: string) => {
    onPatch({ labels: issue.labels.filter((item) => item !== label), actor: "user" });
  };

  const setAssignee = (assignee: AgentIssueAssignee) => {
    onPatch({ assignee, actor: "user" });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {agent && (
          <button
            type="button"
            onClick={() => onOpenAgent(agent.id)}
            className={PILL_CLASS}
            title={`Open ${agent.name}`}
          >
            <Identicon name={agent.name} style={agent.identiconStyle} size="sm" />
            <span>{agent.name}</span>
            <Icon icon={ArrowUpRight01Icon} className="size-3 text-fg-muted" />
          </button>
        )}

        {issue.assignedThreadId ? (
          <button
            type="button"
            onClick={() => onOpenThread(issue.assignedThreadId!)}
            className={PILL_CLASS}
          >
            <Icon icon={ArrowUpRight01Icon} className="size-3.5 text-input" />
            <span>Open linked thread</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={running}
            onClick={onRunWithAgent}
            className={cn(PILL_CLASS, "text-input hover:text-input")}
          >
            <Icon icon={PlayIcon} className="size-3.5" />
            <span>{running ? "Starting…" : "Run with agent"}</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Menu.Root>
          <Menu.Trigger className={cn(PILL_CLASS, stateMeta.pillClass)}>
            <Icon icon={stateMeta.icon} className={cn("size-3.5", stateMeta.iconClass)} />
            <span>{stateMeta.label}</span>
          </Menu.Trigger>
          <MenuPopup label="Status">
            {ISSUE_STATE_ORDER.map((s) => {
              const meta = ISSUE_STATE_META[s];
              return (
                <Menu.Item
                  key={s}
                  onClick={() => onPatch({ state: s as AgentIssueState, actor: "user" })}
                  className={cn(MENU_ITEM_CLASS, issue.state === s && "bg-selected text-fg")}
                >
                  <Icon icon={meta.icon} className={cn("size-3.5", meta.iconClass)} />
                  <span className="flex-1">{meta.label}</span>
                </Menu.Item>
              );
            })}
          </MenuPopup>
        </Menu.Root>

        <Menu.Root>
          <Menu.Trigger className={PILL_CLASS}>
            <Icon icon={priorityMeta.icon} className={cn("size-3.5", priorityMeta.iconClass)} />
            <span>{priorityMeta.label}</span>
          </Menu.Trigger>
          <MenuPopup label="Priority">
            {ISSUE_PRIORITY_ORDER.map((p) => {
              const meta = ISSUE_PRIORITY_META[p];
              return (
                <Menu.Item
                  key={p}
                  onClick={() => onPatch({ priority: p as AgentIssuePriority, actor: "user" })}
                  className={cn(MENU_ITEM_CLASS, issue.priority === p && "bg-selected text-fg")}
                >
                  <Icon icon={meta.icon} className={cn("size-3.5", meta.iconClass)} />
                  <span className="flex-1">{meta.label}</span>
                </Menu.Item>
              );
            })}
          </MenuPopup>
        </Menu.Root>

        <Menu.Root>
          <Menu.Trigger className={PILL_CLASS}>
            {issue.assignee.kind === "agent" && assigneeAgent ? (
              <>
                <Identicon
                  name={assigneeAgent.name}
                  style={assigneeAgent.identiconStyle}
                  size="sm"
                />
                <span className="text-fg">{assigneeAgent.name}</span>
              </>
            ) : issue.assignee.kind === "user" ? (
              <>
                <Icon icon={UserIcon} className="size-3.5 text-on-avatar" />
                <span className="text-fg">Me</span>
              </>
            ) : (
              <>
                <Icon icon={UserIcon} className="size-3.5 text-fg-muted" />
                <span className="text-fg-muted">Assignee</span>
              </>
            )}
          </Menu.Trigger>
          <MenuPopup label="Assignee">
            <Menu.Item
              onClick={() => setAssignee({ kind: "unassigned" })}
              className={cn(
                MENU_ITEM_CLASS,
                issue.assignee.kind === "unassigned" && "bg-selected text-fg",
              )}
            >
              <Icon icon={UserIcon} className="size-3.5 text-fg-muted" />
              <span>Unassigned</span>
            </Menu.Item>
            <Menu.Item
              onClick={() => setAssignee({ kind: "user" })}
              className={cn(
                MENU_ITEM_CLASS,
                issue.assignee.kind === "user" && "bg-selected text-fg",
              )}
            >
              <Icon icon={UserIcon} className="size-3.5 text-on-avatar" />
              <span>Me</span>
            </Menu.Item>
            {agents.length > 0 && <MenuSeparator />}
            {agents.map((candidate) => (
              <Menu.Item
                key={candidate.id}
                onClick={() => setAssignee({ kind: "agent", agentId: candidate.id })}
                className={cn(
                  MENU_ITEM_CLASS,
                  issue.assignee.kind === "agent" &&
                    issue.assignee.agentId === candidate.id &&
                    "bg-selected text-fg",
                )}
              >
                <Identicon name={candidate.name} style={candidate.identiconStyle} size="sm" />
                <span className="truncate">{candidate.name}</span>
              </Menu.Item>
            ))}
          </MenuPopup>
        </Menu.Root>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Menu.Root>
          <Menu.Trigger className={cn(PILL_CLASS, "max-w-[18rem]")}>
            {relatedIssue ? (
              <>
                <Icon icon={CheckmarkCircle02Icon} className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  <span className="text-fg-muted">Related to</span>{" "}
                  <span className="font-mono text-fg">{relatedIssue.key}</span>{" "}
                  <span className="text-fg-secondary">{relatedIssue.title}</span>
                </span>
              </>
            ) : (
              <>
                <Icon icon={Link01Icon} className="size-3.5 text-fg-muted" />
                <span className="text-fg-muted">Related</span>
              </>
            )}
          </Menu.Trigger>
          <MenuPopup label="Related issue" className="max-h-64 min-w-64 overflow-y-auto">
            {relatedIssue && (
              <>
                <Menu.Item
                  onClick={() => onSelectRelated(relatedIssue)}
                  className={MENU_ITEM_CLASS}
                >
                  <Icon icon={ArrowUpRight01Icon} className="size-3.5" />
                  <span className="truncate">Open {relatedIssue.key}</span>
                </Menu.Item>
                <Menu.Item
                  onClick={() => onPatch({ relatedIssueId: null, actor: "user" })}
                  className={MENU_ITEM_CLASS}
                >
                  <Icon icon={Cancel01Icon} className="size-3.5" />
                  <span>Clear link</span>
                </Menu.Item>
                <MenuSeparator />
              </>
            )}
            {otherIssues.length === 0 ? (
              <div className="px-2 py-1.5 text-meta text-fg-muted">No other issues</div>
            ) : (
              otherIssues.slice(0, 20).map((candidate) => (
                <Menu.Item
                  key={candidate.id}
                  onClick={() => onPatch({ relatedIssueId: candidate.id, actor: "user" })}
                  className={cn(
                    MENU_ITEM_CLASS,
                    issue.relatedIssueId === candidate.id && "bg-selected text-fg",
                  )}
                >
                  <span className="shrink-0 font-mono text-meta text-fg-muted">
                    {candidate.key}
                  </span>
                  <span className="truncate">{candidate.title}</span>
                </Menu.Item>
              ))
            )}
          </MenuPopup>
        </Menu.Root>

        {editingDue ? (
          <div className="inline-flex h-7 items-center gap-1 rounded-control border border-edge-strong bg-panel px-2">
            <input
              type="date"
              autoFocus
              defaultValue={issue.dueDate ?? ""}
              onBlur={(e) => {
                setEditingDue(false);
                const val = e.target.value.trim();
                onPatch({ dueDate: val.length > 0 ? val : null, actor: "user" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingDue(false);
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              className="bg-transparent text-label text-fg outline-none"
            />
          </div>
        ) : (
          <button type="button" onClick={() => setEditingDue(true)} className={PILL_CLASS}>
            <Icon icon={Calendar03Icon} className="size-3.5 text-fg-muted" />
            <span className={issue.dueDate ? "text-fg" : "text-fg-muted"}>
              {issue.dueDate ?? "Due date"}
            </span>
          </button>
        )}

        {issue.labels.map((label) => (
          <span
            key={label}
            className="inline-flex h-7 items-center gap-1 rounded-control border border-edge bg-panel pr-1.5 pl-2 text-label text-fg-secondary"
          >
            <Icon icon={Tag01Icon} className="size-3 text-fg-muted" />
            <span>{label}</span>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={() => removeLabel(label)}
              className="grid size-4 cursor-pointer place-items-center rounded-chip text-fg-muted hover:bg-fg/10 hover:text-fg"
            >
              <Icon icon={Cancel01Icon} className="size-2.5" />
            </button>
          </span>
        ))}

        {addingLabel ? (
          <input
            type="text"
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitLabel();
              }
              if (e.key === "Escape") {
                setAddingLabel(false);
                setLabelDraft("");
              }
            }}
            placeholder="Add label…"
            className="h-7 w-28 rounded-control border border-edge-strong bg-panel px-2 text-label text-fg outline-none placeholder:text-fg-faint"
          />
        ) : (
          <button type="button" onClick={() => setAddingLabel(true)} className={PILL_CLASS}>
            <Icon
              icon={issue.labels.length > 0 ? Add01Icon : Tag01Icon}
              className="size-3.5 text-fg-muted"
            />
            <span className="text-fg-muted">{issue.labels.length > 0 ? "Label" : "Labels"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

import { Calendar03Icon, Comment01Icon, GitBranchIcon, UserIcon } from "@hugeicons/core-free-icons";
import type { Agent, AgentIssue } from "@scuttle/contracts";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { cn } from "@/lib/utils.ts";
import { ISSUE_PRIORITY_META } from "./issueMeta.ts";

interface IssueCardProps {
  readonly issue: AgentIssue;
  readonly agent: Agent | undefined;
  readonly assigneeAgent: Agent | undefined;
  readonly selected: boolean;
  readonly onSelect: (issue: AgentIssue) => void;
  readonly onDragStart: (issue: AgentIssue) => void;
}

export function IssueCard({
  issue,
  agent,
  assigneeAgent,
  selected,
  onSelect,
  onDragStart,
}: IssueCardProps) {
  const priorityMeta = ISSUE_PRIORITY_META[issue.priority];
  const hasFooter =
    issue.labels.length > 0 ||
    issue.prNumber !== undefined ||
    issue.dueDate !== undefined ||
    (issue.commentCount ?? 0) > 0;

  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", issue.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(issue);
      }}
      onClick={() => onSelect(issue)}
      className={cn(
        "group/card flex w-full cursor-pointer flex-col gap-2 rounded-card bg-panel p-3 text-left shadow-raised outline-none transition-[background-color,box-shadow] duration-(--dur-hover) ease-hover hover:bg-raised focus-visible:shadow-focus",
        selected && "bg-raised ring-1 ring-primary/60",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          icon={priorityMeta.icon}
          className={cn("size-3.5 shrink-0", priorityMeta.iconClass)}
        />
        <span className="font-mono text-meta font-medium text-fg-muted">{issue.key}</span>
        {agent && <span className="truncate text-meta text-fg-faint">· {agent.name}</span>}
        <div className="flex-1" />
        {issue.assignee.kind === "user" && (
          <span
            title="Assigned to you"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-avatar text-[0.625rem] font-semibold text-on-avatar"
          >
            <Icon icon={UserIcon} className="size-3" />
          </span>
        )}
        {issue.assignee.kind === "agent" && assigneeAgent && (
          <span title={`Assigned to ${assigneeAgent.name}`} className="shrink-0">
            <Identicon
              name={assigneeAgent.name}
              style={assigneeAgent.identiconStyle}
              size="sm"
              className="size-4.5 rounded-[0.25rem]"
            />
          </span>
        )}
      </div>

      <p className="line-clamp-2 text-body leading-[1.35] font-medium text-fg">{issue.title}</p>

      {hasFooter && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="rounded-chip bg-fg/[0.06] px-1.5 py-0.5 text-[0.6875rem] font-medium text-fg-secondary"
            >
              {label}
            </span>
          ))}
          {issue.prNumber !== undefined && (
            <span className="inline-flex items-center gap-1 rounded-chip bg-success/12 px-1.5 py-0.5 font-mono text-[0.6875rem] text-success">
              <Icon icon={GitBranchIcon} className="size-3" />#{issue.prNumber}
            </span>
          )}
          {issue.dueDate && (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-muted">
              <Icon icon={Calendar03Icon} className="size-3" />
              {issue.dueDate}
            </span>
          )}
          {(issue.commentCount ?? 0) > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-fg-muted">
              <Icon icon={Comment01Icon} className="size-3" />
              {issue.commentCount}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

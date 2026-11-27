import {
  Alert02Icon,
  AlertCircleIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  Loading03Icon,
  SignalFull02Icon,
  SignalLow02Icon,
  SignalMedium02Icon,
  ZzzIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { AgentIssue, AgentIssuePriority, AgentIssueState } from "@scuttle/contracts";

export interface IssueStateMeta {
  readonly state: AgentIssueState;
  readonly label: string;
  readonly icon: IconSvgElement;
  readonly iconClass: string;
  readonly pillClass: string;
  readonly primaryColumn: boolean;
}

export const ISSUE_STATE_ORDER: ReadonlyArray<AgentIssueState> = [
  "needs_you",
  "in_review",
  "in_progress",
  "waiting",
  "todo",
  "backlog",
  "done",
  "canceled",
];

export const ISSUE_STATE_META: Readonly<Record<AgentIssueState, IssueStateMeta>> = {
  needs_you: {
    state: "needs_you",
    label: "Needs you",
    icon: AlertCircleIcon,
    iconClass: "text-danger",
    pillClass: "text-danger border-danger/30 bg-danger/10",
    primaryColumn: true,
  },
  in_review: {
    state: "in_review",
    label: "In review",
    icon: CheckmarkCircle02Icon,
    iconClass: "text-success",
    pillClass: "text-success border-success/25 bg-success/10",
    primaryColumn: true,
  },
  in_progress: {
    state: "in_progress",
    label: "In progress",
    icon: Loading03Icon,
    iconClass: "text-warning",
    pillClass: "text-warning border-warning/25 bg-warning/10",
    primaryColumn: true,
  },
  waiting: {
    state: "waiting",
    label: "Waiting",
    icon: ZzzIcon,
    iconClass: "text-input",
    pillClass: "text-input border-input/25 bg-input/10",
    primaryColumn: true,
  },
  todo: {
    state: "todo",
    label: "Todo",
    icon: CircleIcon,
    iconClass: "text-fg-secondary",
    pillClass: "text-fg-secondary border-edge bg-panel",
    primaryColumn: true,
  },
  backlog: {
    state: "backlog",
    label: "Backlog",
    icon: Clock01Icon,
    iconClass: "text-fg-muted",
    pillClass: "text-fg-muted border-edge bg-panel",
    primaryColumn: false,
  },
  done: {
    state: "done",
    label: "Done",
    icon: CheckmarkCircle02Icon,
    iconClass: "text-primary",
    pillClass: "text-input border-primary/30 bg-primary/10",
    primaryColumn: false,
  },
  canceled: {
    state: "canceled",
    label: "Canceled",
    icon: CancelCircleIcon,
    iconClass: "text-fg-faint",
    pillClass: "text-fg-muted border-edge bg-panel",
    primaryColumn: false,
  },
};

export interface IssuePriorityMeta {
  readonly priority: AgentIssuePriority;
  readonly label: string;
  readonly icon: IconSvgElement;
  readonly iconClass: string;
  readonly rank: number;
}

export const ISSUE_PRIORITY_ORDER: ReadonlyArray<AgentIssuePriority> = [
  "urgent",
  "high",
  "normal",
  "low",
  "none",
];

export const ISSUE_PRIORITY_META: Readonly<Record<AgentIssuePriority, IssuePriorityMeta>> = {
  urgent: {
    priority: "urgent",
    label: "Urgent",
    icon: Alert02Icon,
    iconClass: "text-danger",
    rank: 0,
  },
  high: {
    priority: "high",
    label: "High",
    icon: SignalFull02Icon,
    iconClass: "text-warning",
    rank: 1,
  },
  normal: {
    priority: "normal",
    label: "Normal",
    icon: SignalMedium02Icon,
    iconClass: "text-fg-secondary",
    rank: 2,
  },
  low: {
    priority: "low",
    label: "Low",
    icon: SignalLow02Icon,
    iconClass: "text-fg-muted",
    rank: 3,
  },
  none: {
    priority: "none",
    label: "No priority",
    icon: CircleIcon,
    iconClass: "text-fg-faint",
    rank: 4,
  },
};

export type IssuePresetFilter = "for_you" | "assigned_to_me" | "created_by_me" | "agents" | "all";

export interface IssueFilterCriteria {
  readonly preset: IssuePresetFilter;
  readonly query: string;
  readonly agentId: string | null;
  readonly priority: AgentIssuePriority | null;
}

export const filterIssues = (
  issues: ReadonlyArray<AgentIssue>,
  criteria: IssueFilterCriteria,
): ReadonlyArray<AgentIssue> => {
  const q = criteria.query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (criteria.agentId !== null && issue.agentId !== criteria.agentId) {
      return false;
    }
    if (criteria.priority !== null && issue.priority !== criteria.priority) {
      return false;
    }
    switch (criteria.preset) {
      case "for_you":
        if (
          issue.state !== "needs_you" &&
          issue.assignee.kind === "unassigned" &&
          issue.createdBy !== "user"
        ) {
          return false;
        }
        break;
      case "assigned_to_me":
        if (issue.assignee.kind !== "user" && issue.state !== "needs_you") {
          return false;
        }
        break;
      case "created_by_me":
        if (issue.createdBy !== "user") {
          return false;
        }
        break;
      case "agents":
        if (issue.assignee.kind !== "agent") {
          return false;
        }
        break;
      case "all":
        break;
    }
    if (q.length > 0) {
      const hay =
        `${issue.key} ${issue.title} ${issue.description} ${issue.labels.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

export const groupIssuesByState = (
  issues: ReadonlyArray<AgentIssue>,
): Readonly<Record<AgentIssueState, ReadonlyArray<AgentIssue>>> => {
  const groups: Record<AgentIssueState, AgentIssue[]> = {
    needs_you: [],
    in_review: [],
    in_progress: [],
    waiting: [],
    todo: [],
    backlog: [],
    done: [],
    canceled: [],
  };
  for (const issue of issues) {
    groups[issue.state].push(issue);
  }
  for (const state of ISSUE_STATE_ORDER) {
    groups[state].sort((a, b) => {
      const rankDiff = ISSUE_PRIORITY_META[a.priority].rank - ISSUE_PRIORITY_META[b.priority].rank;
      if (rankDiff !== 0) return rankDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }
  return groups;
};

export const formatRelativeIssueTime = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 45_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

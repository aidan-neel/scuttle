import { Menu } from "@base-ui/react/menu";
import {
  Delete02Icon,
  GitPullRequestIcon,
  LinkSquare02Icon,
  Message01Icon,
  Rocket01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { Agent, AgentIssue, AgentIssueState } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { openExternalUrl } from "@/components/git/gitApi.ts";
import { buttonClass } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { MENU_ITEM_CLASS, MenuPopup, MenuRadioItem } from "@/components/ui/Menu.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { Pill } from "./primitives.tsx";

export const ISSUE_STATES: ReadonlyArray<{
  readonly value: AgentIssueState;
  readonly label: string;
}> = [
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "backlog", label: "Backlog" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

const GLYPH: Record<AgentIssueState, string> = {
  backlog: "border border-dashed border-fg-muted",
  in_progress:
    "border-[1.5px] border-warning bg-[linear-gradient(90deg,var(--color-warning)_50%,transparent_50%)]",
  in_review: "border-[1.5px] border-input bg-input/30",
  done: "border-[1.5px] border-success bg-success",
  canceled: "border-[1.5px] border-fg-faint bg-fg-faint",
};

export function StateGlyph({ state }: { readonly state: AgentIssueState }) {
  return <span aria-hidden className={cn("block size-3 rounded-full", GLYPH[state])} />;
}

const HOVER_REVEAL =
  "opacity-0 transition-opacity duration-150 group-hover/issue:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100";

interface IssueRowProps {
  readonly agent: Agent;
  readonly issue: AgentIssue;
  readonly busy: boolean;
  readonly onStateChange: (state: AgentIssueState) => void;
  readonly onAssign: (mode: "pr" | "agent") => void;
  readonly onDelete: () => void;
}

export function IssueRow({ agent, issue, busy, onStateChange, onAssign, onDelete }: IssueRowProps) {
  const navigate = useNavigate();
  const linkedThread =
    issue.assignedThreadId !== undefined && issue.assignedThreadId !== agent.primaryThreadId
      ? issue.assignedThreadId
      : undefined;

  return (
    <li className="group/issue flex items-start gap-1.5 rounded-card p-1 transition-colors duration-100 hover:bg-(--wash)">
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Status: ${ISSUE_STATES.find((s) => s.value === issue.state)?.label ?? ""}`}
          className={buttonClass("ghost", "icon-sm", "data-popup-open:bg-(--wash)")}
        >
          {busy ? (
            <DotSpinner variant="working" label="Updating" />
          ) : (
            <StateGlyph state={issue.state} />
          )}
        </Menu.Trigger>
        <MenuPopup label="Issue status">
          <Menu.RadioGroup
            value={issue.state}
            onValueChange={(next: unknown) => {
              const picked = ISSUE_STATES.find((s) => s.value === next);
              if (picked !== undefined && picked.value !== issue.state) onStateChange(picked.value);
            }}
          >
            {ISSUE_STATES.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                <StateGlyph state={option.value} />
                {option.label}
              </MenuRadioItem>
            ))}
          </Menu.RadioGroup>
        </MenuPopup>
      </Menu.Root>

      <div className="min-w-0 flex-1 py-0.5">
        <p className="truncate text-label text-fg">
          <span className="font-mono text-meta text-fg-muted">{issue.key}</span> {issue.title}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden">
          {issue.labels.slice(0, 2).map((label) => (
            <Pill key={label} tone="accent">
              {label}
            </Pill>
          ))}
          {issue.prUrl !== undefined && (
            <button
              type="button"
              onClick={() => issue.prUrl !== undefined && openExternalUrl(issue.prUrl)}
              className="flex shrink-0 items-center gap-0.5 rounded-chip text-meta text-fg-muted outline-none hover:text-fg focus-visible:shadow-focus"
            >
              <Icon icon={GitPullRequestIcon} className="size-3" />
              {issue.prNumber !== undefined ? `#${issue.prNumber}` : "PR"}
            </button>
          )}
          {linkedThread !== undefined && (
            <button
              type="button"
              onClick={() =>
                void navigate({ to: "/threads/$threadId", params: { threadId: linkedThread } })
              }
              className="flex shrink-0 items-center gap-0.5 rounded-chip text-meta text-fg-muted outline-none hover:text-fg focus-visible:shadow-focus"
            >
              <Icon icon={Message01Icon} className="size-3" />
              Thread
            </button>
          )}
          {issue.externalUrl !== undefined && (
            <button
              type="button"
              aria-label={`Open ${issue.key} on the forge`}
              onClick={() => issue.externalUrl !== undefined && openExternalUrl(issue.externalUrl)}
              className="grid shrink-0 place-items-center rounded-chip text-fg-muted outline-none hover:text-fg focus-visible:shadow-focus"
            >
              <Icon icon={LinkSquare02Icon} className="size-3" />
            </button>
          )}
          <span className="ml-auto shrink-0 text-meta text-fg-faint tabular-nums">
            {formatRelativeAge(issue.updatedAt)}
          </span>
        </div>
      </div>

      <Menu.Root>
        <Menu.Trigger
          aria-label={`Assign ${issue.key}`}
          title="Assign"
          disabled={busy}
          className={buttonClass(
            "ghost",
            "icon-sm",
            cn("data-popup-open:bg-(--wash)", HOVER_REVEAL),
          )}
        >
          <Icon icon={UserGroupIcon} />
        </Menu.Trigger>
        <MenuPopup label="Assign issue">
          <Menu.Item className={MENU_ITEM_CLASS} onClick={() => onAssign("pr")}>
            <Icon icon={Rocket01Icon} className="text-fg-muted" />
            Start a PR agent
          </Menu.Item>
          <Menu.Item className={MENU_ITEM_CLASS} onClick={() => onAssign("agent")}>
            <Icon icon={Message01Icon} className="text-fg-muted" />
            Ask {agent.name}
          </Menu.Item>
        </MenuPopup>
      </Menu.Root>
      <button
        type="button"
        aria-label={`Delete ${issue.key}`}
        title="Delete"
        onClick={onDelete}
        className={buttonClass("ghost", "icon-sm", cn("hover:text-danger", HOVER_REVEAL))}
      >
        <Icon icon={Delete02Icon} />
      </button>
    </li>
  );
}

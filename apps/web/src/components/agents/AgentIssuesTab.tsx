import { Add01Icon, RefreshIcon, Search01Icon } from "@hugeicons/core-free-icons";
import type { Agent, AgentIssue, AgentIssueState } from "@scuttle/contracts";
import { useState } from "react";
import { GitInput, GitTextarea } from "@/components/git/fields.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { ISSUE_STATES, IssueRow } from "./IssueRow.tsx";
import { ChipRow, EmptyLine, ErrorLine, InspectorSection } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

type IssueFilter = "all" | "active" | "backlog" | "done";

const FILTER_STATES: Record<IssueFilter, ReadonlyArray<AgentIssueState>> = {
  all: ["in_progress", "in_review", "backlog", "done", "canceled"],
  active: ["in_progress", "in_review"],
  backlog: ["backlog"],
  done: ["done"],
};

const COLLAPSED_BY_DEFAULT: ReadonlyArray<AgentIssueState> = ["done", "canceled"];

const matches = (issue: AgentIssue, query: string) =>
  query.length === 0 ||
  issue.title.toLowerCase().includes(query) ||
  issue.key.toLowerCase().includes(query) ||
  issue.labels.some((label) => label.toLowerCase().includes(query));

function NewIssueForm({ agent, onDone }: { readonly agent: Agent; readonly onDone: () => void }) {
  const { createIssue } = useWorkspace();
  const task = useTask();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submit = async () => {
    if (title.trim().length === 0) return;
    const ok = await task.run(
      "create",
      () =>
        createIssue(agent.id, {
          title: title.trim(),
          state: "backlog",
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        }),
      "Could not create the issue.",
    );
    if (ok) onDone();
  };

  return (
    <form
      aria-label="New issue"
      className="flex flex-col gap-1.5 border-b border-line pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <GitInput
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Issue title"
        aria-label="Issue title"
        autoFocus
      />
      <GitTextarea
        rows={2}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Description (optional)"
        aria-label="Issue description"
      />
      <div className="flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={title.trim().length === 0 || task.busy !== null}
        >
          {task.busy !== null && <DotSpinner variant="working" label="Creating" />}
          Create issue
        </Button>
      </div>
      <ErrorLine message={task.error} />
    </form>
  );
}

export function AgentIssuesTab({
  agent,
  issues,
}: {
  readonly agent: Agent;
  readonly issues: ReadonlyArray<AgentIssue>;
}) {
  const { updateIssue, deleteIssue, assignIssue, syncForgeIssues } = useWorkspace();
  const task = useTask();
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AgentIssue | null>(null);
  const q = query.trim().toLowerCase();
  const visible = issues.filter((issue) => matches(issue, q));
  const countFor = (key: IssueFilter) =>
    issues.filter((issue) => FILTER_STATES[key].includes(issue.state)).length;
  const groups = ISSUE_STATES.filter((group) => FILTER_STATES[filter].includes(group.value)).map(
    (group) => ({
      ...group,
      items: visible
        .filter((issue) => issue.state === group.value)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }),
  );

  return (
    <div className="flex flex-col gap-2">
      <ChipRow
        label="Filter issues"
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active", count: countFor("active") },
          { value: "backlog", label: "Backlog", count: countFor("backlog") },
          { value: "done", label: "Done", count: countFor("done") },
        ]}
      />
      <div className="flex items-center gap-1">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-control bg-chrome px-2 shadow-raised focus-within:shadow-focus">
          <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search issues"
            aria-label="Search issues"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-faint"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={creating}
          onClick={() => setCreating((open) => !open)}
        >
          <Icon icon={Add01Icon} />
          New
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={task.busy === "sync"}
          onClick={() =>
            void task.run("sync", () => syncForgeIssues(agent.id), "Could not sync issues.")
          }
        >
          {task.busy === "sync" ? (
            <DotSpinner variant="working" label="Syncing" />
          ) : (
            <Icon icon={RefreshIcon} />
          )}
          Sync
        </Button>
      </div>
      {creating && <NewIssueForm agent={agent} onDone={() => setCreating(false)} />}
      <ErrorLine message={task.error} />
      {issues.length === 0 && !creating ? (
        <EmptyLine>No issues yet. Sync from your forge or add one with New.</EmptyLine>
      ) : (
        groups.map((group) => (
          <InspectorSection
            key={group.value}
            title={group.label}
            count={group.items.length}
            defaultOpen={!COLLAPSED_BY_DEFAULT.includes(group.value)}
          >
            {group.items.length === 0 ? (
              <EmptyLine>{q.length > 0 ? "No matches." : "Nothing here."}</EmptyLine>
            ) : (
              <ul className="flex flex-col gap-px">
                {group.items.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    agent={agent}
                    issue={issue}
                    busy={task.busy === issue.id}
                    onStateChange={(state) =>
                      void task.run(
                        issue.id,
                        () => updateIssue(agent.id, issue.id, { state }),
                        "Could not update the issue.",
                      )
                    }
                    onAssign={(mode) =>
                      void task.run(
                        issue.id,
                        () => assignIssue(agent.id, issue.id, { mode }),
                        "Could not assign the issue.",
                      )
                    }
                    onDelete={() => setDeleting(issue)}
                  />
                ))}
              </ul>
            )}
          </InspectorSection>
        ))
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete ${deleting?.key ?? "issue"}?`}
        description={`“${deleting?.title ?? "This issue"}” will be removed from ${agent.name}. Issues on your forge are not touched.`}
        confirmLabel="Delete issue"
        onConfirm={async () => {
          if (deleting !== null) await deleteIssue(agent.id, deleting.id);
        }}
      />
    </div>
  );
}

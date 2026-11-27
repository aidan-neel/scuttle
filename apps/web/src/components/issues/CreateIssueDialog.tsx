import { describeApiError } from "@scuttle/client-runtime";
import type {
  Agent,
  AgentIssue,
  AgentIssueAssignee,
  AgentIssuePriority,
  AgentIssueState,
} from "@scuttle/contracts";
import type { AgentId } from "@scuttle/shared/ids";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import {
  DialogAlert,
  DialogCloseButton,
  DialogFooter,
  DialogSettingRow,
  DialogSettings,
  DialogShell,
} from "@/components/ui/DialogShell.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { useWorkspaceActions } from "@/lib/workspace.tsx";
import {
  ISSUE_PRIORITY_META,
  ISSUE_PRIORITY_ORDER,
  ISSUE_STATE_META,
  ISSUE_STATE_ORDER,
} from "./issueMeta.ts";

interface CreateIssueDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly agents: ReadonlyArray<Agent>;
  readonly initialState: AgentIssueState;
  readonly defaultAgentId?: AgentId | undefined;
  readonly onCreated?: (issue: AgentIssue) => void;
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  agents,
  initialState,
  defaultAgentId,
  onCreated,
}: CreateIssueDialogProps) {
  const { createIssue } = useWorkspaceActions();
  const [agentId, setAgentId] = useState<string>(defaultAgentId ?? agents[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<AgentIssueState>(initialState);
  const [priority, setPriority] = useState<AgentIssuePriority>("normal");
  const [assigneeValue, setAssigneeValue] = useState<string>(
    defaultAgentId ? `agent:${defaultAgentId}` : agents[0] ? `agent:${agents[0].id}` : "unassigned",
  );
  const [labelsText, setLabelsText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAgentId = agents.some((a) => a.id === agentId)
    ? agentId
    : (defaultAgentId ?? agents[0]?.id ?? "");

  const parseAssignee = (val: string): AgentIssueAssignee => {
    if (val === "user") return { kind: "user" };
    if (val.startsWith("agent:")) {
      const target = agents.find((a) => a.id === val.slice("agent:".length));
      if (target) return { kind: "agent", agentId: target.id };
    }
    return { kind: "unassigned" };
  };

  const resetForm = (nextState: AgentIssueState) => {
    setTitle("");
    setDescription("");
    setState(nextState);
    setPriority("normal");
    setLabelsText("");
    setDueDate("");
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    const targetAgent = agents.find((a) => a.id === effectiveAgentId);
    if (!targetAgent) {
      setError("Create an agent first so issues belong to a project.");
      return;
    }
    if (trimmed.length === 0) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const labels = labelsText
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      const created = await createIssue(targetAgent.id, {
        title: trimmed,
        description: description.trim(),
        state,
        priority,
        assignee: parseAssignee(assigneeValue),
        labels,
        ...(dueDate.trim().length > 0 ? { dueDate: dueDate.trim() } : {}),
        actor: "user",
      });
      resetForm(initialState);
      onOpenChange(false);
      onCreated?.(created);
    } catch (err) {
      setError(describeApiError(err, "Failed to create issue."));
    } finally {
      setSubmitting(false);
    }
  };

  const selectClass =
    "h-7 rounded-control bg-panel px-2 text-label text-fg shadow-raised outline-none focus-visible:shadow-focus";

  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (next) setState(initialState);
        onOpenChange(next);
      }}
      className="top-[10vh] w-[min(34rem,calc(100vw-2rem))]"
    >
      <DialogCloseButton />
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
        <header className="px-5 pt-4 pb-3">
          <h2 className="text-title font-semibold text-fg">New issue</h2>
          <p className="mt-0.5 text-label text-fg-muted">
            Assigning an agent sends them a task update right away.
          </p>
        </header>

        <div className="space-y-3 px-5 pb-4">
          <input
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title"
            className="w-full rounded-control bg-panel px-3 py-2 text-body font-medium text-fg shadow-raised outline-none placeholder:text-fg-faint focus-visible:shadow-focus"
          />
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add context, repro steps, or acceptance criteria (Markdown supported)…"
            className="w-full resize-y rounded-control bg-panel px-3 py-2 text-label leading-[1.5] text-fg shadow-raised outline-none placeholder:text-fg-faint focus-visible:shadow-focus"
          />
        </div>

        <DialogSettings>
          <DialogSettingRow label="Agent workspace">
            <div className="flex items-center gap-2">
              {agents.find((a) => a.id === effectiveAgentId) && (
                <Identicon
                  name={agents.find((a) => a.id === effectiveAgentId)!.name}
                  style={agents.find((a) => a.id === effectiveAgentId)!.identiconStyle}
                  size="sm"
                />
              )}
              <select
                value={effectiveAgentId}
                onChange={(e) => setAgentId(e.target.value)}
                className={selectClass}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.projectName})
                  </option>
                ))}
              </select>
            </div>
          </DialogSettingRow>

          <DialogSettingRow label="Status">
            <select
              value={state}
              onChange={(e) => setState(e.target.value as AgentIssueState)}
              className={selectClass}
            >
              {ISSUE_STATE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {ISSUE_STATE_META[s].label}
                </option>
              ))}
            </select>
          </DialogSettingRow>

          <DialogSettingRow label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as AgentIssuePriority)}
              className={selectClass}
            >
              {ISSUE_PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {ISSUE_PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </DialogSettingRow>

          <DialogSettingRow label="Assignee">
            <select
              value={assigneeValue}
              onChange={(e) => setAssigneeValue(e.target.value)}
              className={selectClass}
            >
              <option value="unassigned">Unassigned</option>
              <option value="user">Me</option>
              {agents.map((agent) => (
                <option key={agent.id} value={`agent:${agent.id}`}>
                  {agent.name}
                </option>
              ))}
            </select>
          </DialogSettingRow>

          <DialogSettingRow label="Labels">
            <input
              type="text"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder="bug, migration"
              className="h-7 w-48 rounded-control bg-panel px-2 text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus-visible:shadow-focus"
            />
          </DialogSettingRow>

          <DialogSettingRow label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={selectClass}
            />
          </DialogSettingRow>
        </DialogSettings>

        <DialogFooter>
          <div className="min-w-0 flex-1">{error && <DialogAlert message={error} />}</div>
          <Button type="button" variant="ghost" size="dialog" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="dialog"
            disabled={submitting || agents.length === 0}
          >
            {submitting ? "Creating…" : "Create issue"}
          </Button>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}

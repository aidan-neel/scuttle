import type {
  Agent,
  AgentDelegationKind,
  AgentModelRole,
  ModelSelection,
} from "@scuttle/contracts";
import { useState } from "react";
import { GitInput, GitTextarea } from "@/components/git/fields.tsx";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { ChipRow, ErrorLine } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

type DelegateRole = "workhorse" | "design" | "review" | "pr";

const DELEGATE_ROLES: Record<
  DelegateRole,
  { readonly role: AgentModelRole; readonly kind: AgentDelegationKind; readonly label: string }
> = {
  workhorse: { role: "workhorse", kind: "task", label: "Workhorse" },
  design: { role: "design", kind: "task", label: "Design" },
  review: { role: "review", kind: "review", label: "Review" },
  pr: { role: "workhorse", kind: "pr", label: "PR" },
};

const ROLE_OPTIONS = (["workhorse", "design", "review", "pr"] as const).map((value) => ({
  value,
  label: DELEGATE_ROLES[value].label,
}));

interface DelegateFormProps {
  readonly agent: Agent;
  readonly onDone: () => void;
}

export function DelegateForm({ agent, onDone }: DelegateFormProps) {
  const { providers, delegateTask } = useWorkspace();
  const task = useTask();
  const [roleKey, setRoleKey] = useState<DelegateRole>("workhorse");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [override, setOverride] = useState<ModelSelection | null>(null);
  const target = DELEGATE_ROLES[roleKey];
  const roleModel = agent.modelStack[target.role] ?? agent.modelSelection;
  const ready = title.trim().length > 0 && brief.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    const ok = await task.run(
      "delegate",
      () =>
        delegateTask(agent.id, {
          role: target.role,
          kind: target.kind,
          title: title.trim(),
          brief: brief.trim(),
          ...(override !== null ? { modelSelection: override } : {}),
        }),
      "Could not start the subagent.",
    );
    if (ok) onDone();
  };

  return (
    <form
      aria-label="Delegate a task"
      className="mb-2 flex flex-col gap-1.5 border-b border-line px-1 pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ChipRow label="Role" value={roleKey} options={ROLE_OPTIONS} onValueChange={setRoleKey} />
      <GitInput
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
        aria-label="Subagent title"
        autoFocus
      />
      <GitTextarea
        rows={3}
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder="Brief: the goal, where to look, and what done means"
        aria-label="Subagent brief"
      />
      <div className="flex items-center gap-1">
        <ModelPicker
          providers={providers}
          selection={override ?? roleModel}
          onChange={setOverride}
        />
        {override !== null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOverride(null)}>
            Reset
          </Button>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!ready || task.busy !== null}>
          {task.busy !== null && <DotSpinner variant="working" label="Delegating" />}
          Delegate
        </Button>
      </div>
      <ErrorLine message={task.error} />
    </form>
  );
}

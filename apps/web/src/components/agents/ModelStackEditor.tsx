import type {
  Agent,
  AgentModelRole,
  AgentModelStack,
  ModelSelection,
  UpdateAgentInput,
} from "@scuttle/contracts";
import type { ReactNode } from "react";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { ErrorLine } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

type StackRole = Exclude<AgentModelRole, "captain">;

const STACK_ROLES: ReadonlyArray<{
  readonly role: StackRole;
  readonly label: string;
  readonly hint: string;
}> = [
  { role: "workhorse", label: "Workhorse", hint: "Code tasks and PRs" },
  { role: "design", label: "Design", hint: "UI and visual work" },
  { role: "review", label: "Review", hint: "Reviews and audits" },
  { role: "fast", label: "Fast", hint: "Quick lookups" },
  { role: "large", label: "Large", hint: "Hardest problems" },
];

const withoutRole = (stack: AgentModelStack, role: StackRole): AgentModelStack => {
  const { [role]: _removed, ...rest } = stack;
  return rest;
};

function StackRow({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex min-h-9 items-center gap-2 pl-2">
      <span className="flex w-28 shrink-0 flex-col">
        <span className="text-label font-medium text-fg-secondary">{label}</span>
        <span className="truncate text-meta text-fg-faint">{hint}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-0.5">{children}</span>
    </li>
  );
}

export function ModelStackEditor({ agent }: { readonly agent: Agent }) {
  const { providers, updateAgent } = useWorkspace();
  const task = useTask();

  const save = (key: string, input: UpdateAgentInput) =>
    void task.run(key, () => updateAgent(agent.id, input), "Could not save the model stack.");

  const setPrimary = (modelSelection: ModelSelection) =>
    save("captain", {
      modelSelection,
      modelStack: { ...agent.modelStack, captain: modelSelection },
    });

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-px">
        <StackRow label="Captain (primary)" hint="Conversation model">
          <ModelPicker
            providers={providers}
            selection={agent.modelSelection}
            onChange={setPrimary}
          />
        </StackRow>
        {STACK_ROLES.map(({ role, label, hint }) => {
          const own = agent.modelStack[role];
          return (
            <StackRow key={role} label={label} hint={own === undefined ? "Inherits primary" : hint}>
              <span className={own === undefined ? "opacity-60" : undefined}>
                <ModelPicker
                  providers={providers}
                  selection={own ?? agent.modelSelection}
                  onChange={(selection) =>
                    save(role, { modelStack: { ...agent.modelStack, [role]: selection } })
                  }
                />
              </span>
              {own !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={task.busy === role}
                  onClick={() => save(role, { modelStack: withoutRole(agent.modelStack, role) })}
                >
                  Reset
                </Button>
              )}
            </StackRow>
          );
        })}
      </ul>
      <ErrorLine message={task.error} />
    </div>
  );
}

import { AiMagicIcon } from "@hugeicons/core-free-icons";
import type { Agent } from "@scuttle/contracts";
import { useState } from "react";
import { GitTextarea } from "@/components/git/fields.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { ModelStackEditor } from "./ModelStackEditor.tsx";
import { ErrorLine, InspectorSection } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

export function AgentSetupTab({ agent }: { readonly agent: Agent }) {
  const { updateAgent, startAgentSetup } = useWorkspace();
  const task = useTask();
  const [purposeDraft, setPurposeDraft] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<string | null>(null);
  const purpose = purposeDraft ?? agent.purpose;
  const skill = skillDraft ?? agent.instructionsMd;
  const dirty = purpose !== agent.purpose || skill !== agent.instructionsMd;

  const discard = () => {
    setPurposeDraft(null);
    setSkillDraft(null);
  };

  const saveDrafts = async () => {
    const ok = await task.run(
      "save",
      () => updateAgent(agent.id, { purpose: purpose.trim(), instructionsMd: skill }),
      "Could not save the setup.",
    );
    if (ok) discard();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-card bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-edge)]">
        <div className="flex flex-col gap-0.5 px-2 pt-2">
          <h3 className="text-label font-medium text-fg">Ask {agent.name} to set up</h3>
          <p className="text-label leading-[1.5] text-fg-muted">
            {agent.name} reads {agent.projectName}, saves its first memories, and refines its setup
            skill. You can edit both below.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="self-start"
          disabled={task.busy !== null}
          onClick={() =>
            void task.run("setup", () => startAgentSetup(agent.id), "Could not start setup.")
          }
        >
          {task.busy === "setup" ? (
            <DotSpinner variant="working" label="Starting setup" />
          ) : (
            <Icon icon={AiMagicIcon} />
          )}
          Start setup
        </Button>
      </div>

      <InspectorSection title="Purpose and setup skill">
        <form
          className="flex flex-col gap-1.5 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty) void saveDrafts();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="px-1 text-meta font-medium text-fg-muted">Purpose</span>
            <GitTextarea
              rows={3}
              value={purpose}
              onChange={(event) => setPurposeDraft(event.target.value)}
              placeholder={`What ${agent.name} owns and what it should do first`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="px-1 text-meta font-medium text-fg-muted">Setup skill (Markdown)</span>
            <GitTextarea
              rows={12}
              value={skill}
              onChange={(event) => setSkillDraft(event.target.value)}
              placeholder="Commands, conventions, and rules this agent follows on every turn"
              spellCheck={false}
              className="font-mono text-meta leading-[1.6]"
            />
          </label>
          <div className="flex items-center justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={!dirty} onClick={discard}>
              Discard
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!dirty || task.busy === "save"}
            >
              {task.busy === "save" && <DotSpinner variant="working" label="Saving" />}
              Save
            </Button>
          </div>
        </form>
      </InspectorSection>

      <InspectorSection title="Model stack">
        <ModelStackEditor agent={agent} />
      </InspectorSection>
      <ErrorLine message={task.error} />
    </div>
  );
}

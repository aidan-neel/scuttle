import { Dialog } from "@base-ui/react/dialog";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { IdenticonStyle, ModelSelection, ThreadRuntime } from "@scuttle/contracts";
import { DEFAULT_IDENTICON_STYLE } from "@scuttle/shared/identicon";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { RUNTIMES } from "@/components/home/ComposerContextBar.tsx";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import {
  DialogAlert,
  DialogCloseButton,
  DialogFooter,
  DialogSettingRow,
  DialogSettings,
  DialogShell,
} from "@/components/ui/DialogShell.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon, identiconStyleOptions } from "@/components/ui/Identicon.tsx";
import { PillLabel, Picker, pillTriggerClass } from "@/components/ui/Picker.tsx";
import { formatAgentName } from "@/lib/format.ts";
import { useWorkspace } from "@/lib/workspace.tsx";
import { AddProjectDialog } from "./AddProjectDialog.tsx";

interface CreateAgentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps) {
  const { projects, providers, selectedProjectId, defaultModelSelection, createAgent } =
    useWorkspace();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [identiconStyle, setIdenticonStyle] = useState<IdenticonStyle>(DEFAULT_IDENTICON_STYLE);
  const [projectChoice, setProjectChoice] = useState<ProjectId | null>(null);
  const [runtime, setRuntime] = useState<ThreadRuntime>("local");
  const [modelChoice, setModelChoice] = useState<ModelSelection | null>(null);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project =
    projects.find((p) => p.id === projectChoice) ??
    projects.find((p) => p.id === selectedProjectId) ??
    projects[0] ??
    null;
  const modelSelection = modelChoice ?? defaultModelSelection;
  const fallbackName = project === null ? "Agent" : formatAgentName(project.name);
  const finalName = name.trim().length > 0 ? name.trim() : fallbackName;

  const reset = () => {
    setName("");
    setIdenticonStyle(DEFAULT_IDENTICON_STYLE);
    setProjectChoice(null);
    setRuntime("local");
    setModelChoice(null);
    setError(null);
  };

  const requestOpenChange = (next: boolean) => {
    if (creating && !next) return;
    onOpenChange(next);
  };

  const create = async () => {
    if (project === null || creating) return;
    setCreating(true);
    setError(null);
    try {
      const agent = await createAgent({
        projectId: project.id,
        name: finalName,
        identiconStyle,
        runtime,
        modelSelection,
        startOnboarding: true,
      });
      onOpenChange(false);
      void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } });
    } catch (cause) {
      setError(describeApiError(cause, "Could not create the agent."));
    }
    setCreating(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={requestOpenChange}
      onExitComplete={reset}
      initialFocus={nameRef}
      className="top-[15vh] w-[min(28.25rem,calc(100vw-2rem))]"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Dialog.Title className="sr-only">New agent</Dialog.Title>
        <DialogCloseButton />

        <div className="flex flex-col items-center px-8 pt-11 pb-7">
          <Identicon
            name={finalName}
            style={identiconStyle}
            size="xl"
            className="size-16 rounded-dialog"
          />
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={fallbackName}
            aria-label="Agent name"
            spellCheck={false}
            className="mt-3.5 w-full rounded-control bg-transparent px-2 py-0.5 text-center text-[1.375rem] leading-7 font-semibold tracking-[-0.02em] text-fg caret-fg outline-none transition-colors duration-(--dur-hover) placeholder:text-fg-faint hover:bg-fg/3 focus-visible:bg-fg/4"
          />
        </div>

        <DialogSettings className="pb-1.5">
          <DialogSettingRow label="Avatar">
            <Picker
              label="Avatar style"
              value={identiconStyle}
              options={identiconStyleOptions(finalName)}
              onValueChange={setIdenticonStyle}
              variant="field"
            />
          </DialogSettingRow>
          <DialogSettingRow label="Project">
            {project === null ? (
              <button
                type="button"
                onClick={() => setAddFolderOpen(true)}
                className={pillTriggerClass(undefined, "field")}
              >
                <Icon icon={Add01Icon} />
                <PillLabel>Add folder…</PillLabel>
              </button>
            ) : (
              <Picker
                label="Project"
                value={project.id}
                options={projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  icon: <Identicon name={p.name} size="sm" className="size-3.5" />,
                }))}
                onValueChange={(id) => setProjectChoice(id)}
                action={{
                  label: "Add folder…",
                  icon: Add01Icon,
                  onSelect: () => setAddFolderOpen(true),
                }}
                variant="field"
                className="max-w-60"
              />
            )}
          </DialogSettingRow>
          <DialogSettingRow label="Runtime">
            <Picker
              label="Runtime"
              value={runtime}
              options={RUNTIMES}
              onValueChange={setRuntime}
              variant="field"
            />
          </DialogSettingRow>
          <DialogSettingRow label="Model">
            <ModelPicker
              providers={providers}
              selection={modelSelection}
              onChange={setModelChoice}
              align="end"
              variant="field"
            />
          </DialogSettingRow>
        </DialogSettings>

        <DialogFooter>
          <div className="min-w-0 flex-1">{error !== null && <DialogAlert message={error} />}</div>
          <Button
            type="button"
            variant="ghost"
            size="dialog"
            disabled={creating}
            onClick={() => requestOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="dialog"
            disabled={project === null || creating}
            className="px-3.5"
          >
            {creating && <DotSpinner variant="working" label="Creating" />}
            Create Agent
          </Button>
        </DialogFooter>
      </form>
      <AddProjectDialog
        open={addFolderOpen}
        onOpenChange={setAddFolderOpen}
        onAdded={(added) => setProjectChoice(added.id)}
      />
    </DialogShell>
  );
}

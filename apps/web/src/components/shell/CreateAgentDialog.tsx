import { Dialog } from "@base-ui/react/dialog";
import { Add01Icon, Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ModelSelection, ThreadRuntime } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { RUNTIMES } from "@/components/home/ComposerContextBar.tsx";
import { ModelPicker } from "@/components/home/ModelPicker.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { PillLabel, Picker, pillTriggerClass } from "@/components/ui/Picker.tsx";
import { easeOut, spring } from "@/lib/motion.ts";
import { useWorkspace } from "@/lib/workspace.tsx";
import { AddProjectDialog } from "./AddProjectDialog.tsx";

interface CreateAgentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function FieldRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 rounded-chip px-2.5 transition-colors duration-100 hover:bg-white/3">
      <span className="w-20 shrink-0 text-label font-medium text-fg-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps) {
  const { projects, providers, selectedProjectId, defaultModelSelection, createAgent } =
    useWorkspace();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
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
  const fallbackName = project === null ? "Captain" : `${project.name} Captain`;
  const finalName = name.trim().length > 0 ? name.trim() : fallbackName;

  const reset = () => {
    setName("");
    setPurpose("");
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
      const trimmedPurpose = purpose.trim();
      const agent = await createAgent({
        projectId: project.id,
        name: finalName,
        runtime,
        modelSelection,
        ...(trimmedPurpose.length > 0 ? { purpose: trimmedPurpose } : {}),
      });
      onOpenChange(false);
      void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } });
    } catch (cause) {
      setError(describeApiError(cause, "Could not create the agent."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={requestOpenChange}>
      <AnimatePresence onExitComplete={reset}>
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.16, ease: easeOut } }}
                  exit={{ opacity: 0, transition: { duration: 0.12, ease: easeOut } }}
                />
              }
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
            />
            <Dialog.Popup
              initialFocus={nameRef}
              render={
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring.snappy }}
                  exit={{ opacity: 0, y: 4, scale: 0.985, transition: { duration: 0.12 } }}
                />
              }
              className="fixed inset-x-0 top-[16vh] z-50 mx-auto flex w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-canvas bg-menu shadow-menu outline-none"
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <header className="flex h-11 items-center gap-2 pr-2 pl-4">
                  <Dialog.Title className="flex-1 text-body font-medium text-fg">
                    New agent
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    render={<Button type="button" variant="ghost" size="icon-sm" />}
                  >
                    <Icon icon={Cancel01Icon} />
                  </Dialog.Close>
                </header>

                <div className="flex flex-col items-center gap-2 px-4 pt-2 pb-3">
                  <Identicon name={finalName} size="xl" />
                  <input
                    ref={nameRef}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={fallbackName}
                    aria-label="Agent name"
                    spellCheck={false}
                    className="w-full bg-transparent text-center text-title font-medium text-fg outline-none placeholder:text-fg-faint"
                  />
                </div>

                <div className="flex flex-col gap-px border-t border-line p-1.5">
                  <FieldRow label="Project">
                    {project === null ? (
                      <button
                        type="button"
                        onClick={() => setAddFolderOpen(true)}
                        className={pillTriggerClass()}
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
                        className="max-w-60"
                      />
                    )}
                  </FieldRow>
                  <FieldRow label="Runtime">
                    <Picker
                      label="Runtime"
                      value={runtime}
                      options={RUNTIMES}
                      onValueChange={setRuntime}
                    />
                  </FieldRow>
                  <FieldRow label="Model">
                    <ModelPicker
                      providers={providers}
                      selection={modelSelection}
                      onChange={setModelChoice}
                    />
                  </FieldRow>
                  <label className="flex flex-col gap-1 rounded-chip px-2.5 py-2">
                    <span className="text-label font-medium text-fg-secondary">Purpose</span>
                    <textarea
                      rows={2}
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                      placeholder="What should this agent own? You can refine it later."
                      className="resize-none bg-transparent text-label leading-[1.5] text-fg outline-none placeholder:text-fg-faint"
                    />
                  </label>
                </div>

                <footer className="flex h-12 items-center gap-2 border-t border-line bg-black/10 px-3">
                  <div className="min-w-0 flex-1">
                    {error !== null && (
                      <p role="alert" className="flex items-center gap-1.5 text-label text-danger">
                        <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
                        <span className="truncate">{error}</span>
                      </p>
                    )}
                  </div>
                  <Button type="submit" variant="primary" disabled={project === null || creating}>
                    {creating && <DotSpinner variant="working" label="Creating" />}
                    Create agent
                  </Button>
                </footer>
              </form>
              <AddProjectDialog
                open={addFolderOpen}
                onOpenChange={setAddFolderOpen}
                onAdded={(added) => setProjectChoice(added.id)}
              />
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

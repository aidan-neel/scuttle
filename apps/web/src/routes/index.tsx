import { ComputerIcon, Folder01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import type { ThreadRuntime } from "@scuttle/contracts";
import { ProjectId } from "@scuttle/shared/ids";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DitherHorizon } from "@/components/dithercn/dither-horizon.tsx";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { AddProjectDialog } from "@/components/shell/AddProjectDialog.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { Picker } from "@/components/ui/Picker.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const RUNTIMES = [
  { value: "local", label: "Local", icon: <Icon icon={ComputerIcon} /> },
  { value: "worktree", label: "Worktree", icon: <Icon icon={GitBranchIcon} /> },
] as const satisfies ReadonlyArray<{ value: ThreadRuntime; label: string; icon: unknown }>;

function HomePage() {
  const navigate = useNavigate();
  const {
    projects,
    providers,
    selectedProjectId,
    selectProject,
    branchesByProject,
    loadBranches,
    defaultModelSelection,
    setDefaultModelSelection,
    createThread,
  } = useWorkspace();

  const [runtime, setRuntime] = useState<ThreadRuntime>("local");
  const [branch, setBranch] = useState<string>("main");
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (!activeProject) return;
    let cancelled = false;
    void loadBranches(activeProject.id)
      .then((list) => {
        if (cancelled) return;
        const preferred =
          list.find((b) => b.isCurrent)?.name ??
          list.find((b) => b.isDefault)?.name ??
          list[0]?.name ??
          activeProject.defaultBranch;
        setBranch(preferred);
      })
      .catch(() => {
        if (!cancelled) setBranch(activeProject.defaultBranch);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id]);

  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.name,
    icon: <Identicon name={project.name} size="sm" />,
  }));

  const rawBranches = activeProject ? (branchesByProject[activeProject.id] ?? []) : [];
  const branchNames =
    rawBranches.length > 0
      ? rawBranches.map((b) => b.name)
      : [activeProject?.defaultBranch ?? "main"];
  const effectiveBranch = branchNames.includes(branch) ? branch : (branchNames[0] ?? "main");
  const branchOptions = branchNames.map((name) => ({
    value: name,
    label: <span className="font-mono text-label">{name}</span>,
  }));

  const handleSubmit = async (payload: ComposerSubmitPayload) => {
    if (!activeProject) {
      setAddProjectOpen(true);
      return;
    }
    setSubmitError(null);
    try {
      const detail = await createThread({
        projectId: activeProject.id,
        prompt: payload.prompt,
        runtime,
        branch: effectiveBranch,
        modelSelection: payload.modelSelection,
        runtimeMode: "auto",
        interactionMode: "default",
        ...(payload.attachments.length > 0 ? { attachments: [...payload.attachments] } : {}),
      });
      await navigate({ to: "/threads/$threadId", params: { threadId: detail.thread.id } });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to start thread.");
    }
  };

  return (
    <section className="group/home flex flex-1 flex-col items-center justify-center px-4 pb-24">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-85 transition-opacity duration-300 ease-out group-has-[textarea:focus]/home:opacity-100">
        <DitherHorizon intensity={0.72} className="absolute inset-0" />
      </div>
      <h1 className="sr-only">New thread</h1>
      <div className="w-full max-w-composer">
        <div className="mb-2 flex items-center gap-1 px-1">
          {activeProject ? (
            <Picker
              label="Project"
              value={activeProject.id}
              options={projectOptions}
              onValueChange={(id) => selectProject(ProjectId.make(id))}
              icon={<Icon icon={Folder01Icon} />}
            />
          ) : (
            <Button variant="quiet" size="md" onClick={() => setAddProjectOpen(true)}>
              <Icon icon={Folder01Icon} />
              Add project
            </Button>
          )}
          <Picker label="Runtime" value={runtime} options={RUNTIMES} onValueChange={setRuntime} />
          <span className="flex-1" />
          <Picker
            label="Branch"
            value={effectiveBranch}
            options={branchOptions}
            onValueChange={setBranch}
            icon={<Icon icon={GitBranchIcon} />}
          />
        </div>
        {submitError && (
          <div className="mb-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-label text-danger">
            {submitError}
          </div>
        )}
        <Composer
          providers={providers}
          modelSelection={defaultModelSelection}
          onModelSelectionChange={setDefaultModelSelection}
          disabled={!activeProject}
          onSubmit={handleSubmit}
        />
      </div>
      <AddProjectDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} />
    </section>
  );
}

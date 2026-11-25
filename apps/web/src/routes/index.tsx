import type { GitBranchInfo, ThreadRuntime } from "@scuttle/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DitherHorizon } from "@/components/dithercn/dither-horizon.tsx";
import { Composer, type ComposerSubmitPayload } from "@/components/home/Composer.tsx";
import { ComposerContextBar } from "@/components/home/ComposerContextBar.tsx";
import { useDitherBackground } from "@/components/settings/preferences.ts";
import { AddProjectDialog } from "@/components/shell/AddProjectDialog.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";

export const Route = createFileRoute("/")({
  component: HomePage,
});

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

  const ditherBackground = useDitherBackground();
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

  const loadedBranches = activeProject ? (branchesByProject[activeProject.id] ?? []) : [];
  const branches: ReadonlyArray<GitBranchInfo> =
    loadedBranches.length > 0
      ? loadedBranches
      : [
          {
            name: activeProject?.defaultBranch ?? "main",
            isCurrent: false,
            isDefault: true,
            isWorktree: false,
          },
        ];
  const effectiveBranch = branches.some((b) => b.name === branch)
    ? branch
    : (branches[0]?.name ?? "main");

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
      {ditherBackground && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-canvas opacity-85 transition-opacity duration-300 ease-out [clip-path:inset(0_round_var(--radius-canvas))] group-has-[textarea:focus]/home:opacity-100">
          <DitherHorizon intensity={0.72} className="absolute inset-0 rounded-[inherit]" />
        </div>
      )}
      <h1 className="sr-only">New thread</h1>
      <div className="w-full max-w-composer">
        <ComposerContextBar
          projects={projects}
          activeProject={activeProject}
          onSelectProject={(project) => selectProject(project.id)}
          onAddProject={() => setAddProjectOpen(true)}
          runtime={runtime}
          onRuntimeChange={setRuntime}
          branches={branches}
          branch={effectiveBranch}
          onBranchChange={setBranch}
        />
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

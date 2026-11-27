import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import type { Project } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AddProjectDialog } from "@/components/shell/AddProjectDialog.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SettingsGroup } from "./primitives.tsx";

export function ProjectsSection() {
  const navigate = useNavigate();
  const { projects, modelTiers, deleteProject } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Project | null>(null);
  return (
    <>
      <SettingsGroup
        title={`${projects.length} project${projects.length === 1 ? "" : "s"}`}
        action={
          <Button variant="secondary" size="md" onClick={() => setAddOpen(true)}>
            <Icon icon={Add01Icon} />
            Add project
          </Button>
        }
      >
        {projects.map((project) => {
          const age = formatRelativeAge(project.lastActivityAt);
          return (
            <div key={project.id} className="flex items-center gap-3 px-4 py-3">
              <Identicon name={project.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-body font-medium text-fg">{project.name}</span>
                  {project.isGitRepo && (
                    <span className="shrink-0 rounded-chip bg-fg/6 px-1.5 py-0.5 font-mono text-meta text-fg-muted">
                      {project.defaultBranch}
                    </span>
                  )}
                </div>
                <div className="text-label text-fg-muted">
                  {project.isGitRepo ? "Git repository" : "Local folder"}
                  {age.length > 0 && ` · active ${age === "now" ? "just now" : `${age} ago`}`}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/settings/$section",
                    params: { section: "stack" },
                    search: { scope: "project", projectId: project.id },
                  })
                }
                className="text-meta text-fg-muted"
              >
                {Object.keys(modelTiers.projects[project.id] ?? {}).length > 0
                  ? `Stack (${Object.keys(modelTiers.projects[project.id] ?? {}).length})`
                  : "Model stack"}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${project.name} from Scuttle`}
                onClick={() => setRemoving(project)}
                className="hover:text-danger"
              >
                <Icon icon={Delete02Icon} />
              </Button>
            </div>
          );
        })}
        {projects.length === 0 && (
          <div className="flex flex-col items-start gap-1 px-4 py-6">
            <span className="text-body text-fg">No projects yet</span>
            <span className="text-label text-fg-muted">
              Add a repository or folder so agents have somewhere to work.
            </span>
          </div>
        )}
      </SettingsGroup>
      <p className="px-0.5 text-label text-fg-muted">
        Removing a project also deletes its threads in Scuttle. Files on disk are not touched.
      </p>
      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={`Remove ${removing?.name ?? "project"}?`}
        description="This removes the project and all of its threads from Scuttle. Files on disk are not touched."
        confirmLabel="Remove project"
        onConfirm={async () => {
          if (removing !== null) await deleteProject(removing.id);
        }}
      />
    </>
  );
}

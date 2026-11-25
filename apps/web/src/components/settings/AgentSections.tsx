import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { AddProjectDialog } from "@/components/shell/AddProjectDialog.tsx";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";
import { ModelList } from "./ModelList.tsx";
import { SettingsGroup } from "./primitives.tsx";

export function ModelsSection() {
  const { providers } = useWorkspace();
  const withModels = providers.filter((p) => p.models.length > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = withModels.find((p) => p.id === selectedId) ?? withModels[0] ?? null;

  if (active === null) {
    return (
      <div className="rounded-card bg-panel px-4 py-5 text-label text-fg-muted shadow-raised">
        No provider has reported models yet. Enable a harness under Providers.
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div role="group" aria-label="Provider" className="flex flex-wrap gap-1">
        {withModels.map((provider) => {
          const selected = provider.id === active.id;
          return (
            <button
              key={provider.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedId(provider.id)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-2 rounded-control px-3 text-label outline-none transition-colors duration-(--dur-hover) ease-hover focus-visible:shadow-focus",
                selected
                  ? "bg-panel text-fg shadow-raised"
                  : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
              )}
            >
              <BrandLogo brand={provider.kind} className="size-3.5" />
              {provider.name}
              <span className="font-mono text-meta text-fg-faint">{provider.models.length}</span>
            </button>
          );
        })}
      </div>
      <ModelList key={active.id} provider={active} />
    </section>
  );
}

export function ProjectsSection() {
  const { projects, deleteProject } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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
                    <span className="shrink-0 rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-meta text-fg-muted">
                      {project.defaultBranch}
                    </span>
                  )}
                </div>
                <div className="text-label text-fg-muted">
                  {project.isGitRepo ? "Git repository" : "Local folder"}
                  {age.length > 0 && ` · active ${age === "now" ? "just now" : `${age} ago`}`}
                </div>
              </div>
              {confirmingId === project.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="md" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="md"
                    onClick={() => {
                      setConfirmingId(null);
                      void deleteProject(project.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${project.name} from Scuttle`}
                  onClick={() => setConfirmingId(project.id)}
                  className="hover:text-danger"
                >
                  <Icon icon={Delete02Icon} />
                </Button>
              )}
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
    </>
  );
}

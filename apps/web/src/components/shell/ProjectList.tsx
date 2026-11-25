import { useNavigate } from "@tanstack/react-router";
import { LayoutGroup, motion } from "motion/react";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { spring } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SectionHeader } from "./SectionHeader.tsx";

export function ProjectList({ onAddProject }: { readonly onAddProject: () => void }) {
  const { projects, selectedProjectId, selectProject } = useWorkspace();
  const navigate = useNavigate();

  return (
    <section aria-labelledby="projects-heading">
      <SectionHeader
        id="projects-heading"
        title="Projects"
        addLabel="Add project"
        onAdd={onAddProject}
      />
      <LayoutGroup id="projects">
        <ul className="mt-0.5 flex flex-col gap-px">
          {projects.map((project) => {
            const isSelected = project.id === selectedProjectId;
            const subtitle =
              project.lastMessage ?? (project.isGitRepo ? project.defaultBranch : "Ready");
            return (
              <li key={project.id}>
                <button
                  type="button"
                  aria-current={isSelected}
                  onClick={() => {
                    selectProject(project.id);
                    void navigate({ to: "/" });
                  }}
                  className="relative flex w-full items-center gap-2.5 rounded-row p-2 text-left outline-none transition-colors duration-100 ease-out hover:bg-white/4 focus-visible:shadow-focus"
                >
                  {isSelected && (
                    <motion.span
                      layoutId="project-selection"
                      transition={spring.layout}
                      className="absolute inset-0 rounded-row bg-white/7"
                    />
                  )}
                  <Identicon name={project.name} size="lg" className="relative" />
                  <span className="relative flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-2">
                      <span className="flex-1 truncate text-body font-medium text-fg">
                        {project.name}
                      </span>
                      <span className="text-meta text-fg-muted tabular-nums">
                        {formatRelativeAge(project.lastActivityAt ?? project.updatedAt)}
                      </span>
                    </span>
                    <span className="truncate text-label text-fg-muted">{subtitle}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {projects.length === 0 && (
            <li className="px-2 py-2 text-label text-fg-muted">
              No projects yet. Press + to add one.
            </li>
          )}
        </ul>
      </LayoutGroup>
    </section>
  );
}

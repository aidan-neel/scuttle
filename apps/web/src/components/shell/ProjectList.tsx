import { ContextMenu } from "@base-ui/react/context-menu";
import { Copy01Icon, Delete02Icon, FilterIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import type { Project } from "@scuttle/contracts";
import type { ProjectId } from "@scuttle/shared/ids";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { ContextMenuItem, ContextMenuPopup, ContextMenuSeparator } from "@/components/ui/Menu.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { spring } from "@/lib/motion";
import { useWorkspace } from "@/lib/workspace.tsx";
import { SectionHeader, type SectionMenuEntry } from "./SectionHeader.tsx";

type ProjectSort = "recent" | "name";

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "name", label: "Name" },
] as const satisfies ReadonlyArray<{ value: ProjectSort; label: string }>;

const activityOf = (project: Project) => project.lastActivityAt ?? project.updatedAt;

const sortProjects = (projects: ReadonlyArray<Project>, sort: ProjectSort) =>
  sort === "name"
    ? projects.toSorted((a, b) => a.name.localeCompare(b.name))
    : projects.toSorted((a, b) => activityOf(b).localeCompare(activityOf(a)));

interface ProjectListProps {
  readonly filterProjectId: ProjectId | null;
  readonly onFilterChange: (projectId: ProjectId | null) => void;
  readonly onAddProject: () => void;
  readonly onNewThread: () => void;
}

export function ProjectList({
  filterProjectId,
  onFilterChange,
  onAddProject,
  onNewThread,
}: ProjectListProps) {
  const { projects, selectedProjectId, selectProject, deleteProject } = useWorkspace();
  const navigate = useNavigate();
  const isHome = useRouterState({ select: (state) => state.location.pathname === "/" });
  const [sort, setSort] = useState<ProjectSort>("recent");

  const clearFilter: SectionMenuEntry = {
    kind: "action",
    label: "Clear project filter",
    onSelect: () => onFilterChange(null),
  };
  const menu: ReadonlyArray<SectionMenuEntry> = [
    {
      kind: "choice",
      label: "Sort by",
      value: sort,
      options: SORT_OPTIONS,
      onValueChange: (value) => setSort(value === "name" ? "name" : "recent"),
    },
    { kind: "separator" },
    { kind: "action", label: "Add project", onSelect: onAddProject },
    ...(filterProjectId === null ? [] : [clearFilter]),
  ];

  return (
    <section aria-labelledby="projects-heading">
      <SectionHeader
        id="projects-heading"
        title="Projects"
        addLabel="Add project"
        onAdd={onAddProject}
        menu={menu}
      />
      <LayoutGroup id="projects">
        <ul className="mt-0.5 flex flex-col gap-px">
          {sortProjects(projects, sort).map((project) => {
            const isSelected =
              filterProjectId === null
                ? isHome && project.id === selectedProjectId
                : project.id === filterProjectId;
            const isFiltered = filterProjectId === project.id;
            const subtitle =
              project.lastMessage ?? (project.isGitRepo ? project.defaultBranch : "Ready");
            return (
              <li key={project.id}>
                <ContextMenu.Root>
                  <ContextMenu.Trigger
                    render={
                      <button
                        type="button"
                        aria-current={isSelected}
                        onClick={() => {
                          selectProject(project.id);
                          if (filterProjectId !== null) onFilterChange(project.id);
                          void navigate({ to: "/" });
                        }}
                        className="relative flex w-full items-center gap-2.5 rounded-row p-2 text-left outline-none transition-colors duration-100 ease-out hover:bg-white/4 focus-visible:shadow-focus"
                      />
                    }
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
                  </ContextMenu.Trigger>
                  <ContextMenuPopup label={`${project.name} actions`}>
                    <ContextMenuItem
                      onClick={() => {
                        selectProject(project.id);
                        onNewThread();
                      }}
                    >
                      <Icon icon={PencilEdit02Icon} className="text-fg-muted" />
                      New thread
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onFilterChange(isFiltered ? null : project.id)}>
                      <Icon icon={FilterIcon} className="text-fg-muted" />
                      {isFiltered ? "Clear thread filter" : "Filter threads"}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        void navigator.clipboard?.writeText(project.path);
                      }}
                    >
                      <Icon icon={Copy01Icon} className="text-fg-muted" />
                      Copy path
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      danger
                      onClick={() => {
                        if (filterProjectId === project.id) onFilterChange(null);
                        void deleteProject(project.id);
                      }}
                    >
                      <Icon icon={Delete02Icon} />
                      Remove project
                    </ContextMenuItem>
                  </ContextMenuPopup>
                </ContextMenu.Root>
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

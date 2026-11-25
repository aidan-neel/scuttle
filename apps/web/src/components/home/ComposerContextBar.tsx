import { Combobox } from "@base-ui/react/combobox";
import {
  Add01Icon,
  ComputerIcon,
  GitBranchIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { GitBranchInfo, Project, ThreadRuntime } from "@scuttle/contracts";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { PillChevron, PillLabel, Picker, pillTriggerClass } from "@/components/ui/Picker.tsx";

export const RUNTIMES = [
  { value: "local", label: "Local", icon: <Icon icon={ComputerIcon} /> },
  { value: "worktree", label: "Worktree", icon: <Icon icon={GitBranchIcon} /> },
] as const satisfies ReadonlyArray<{ value: ThreadRuntime; label: string; icon: unknown }>;

interface ComposerContextBarProps {
  readonly projects: ReadonlyArray<Project>;
  readonly activeProject: Project | null;
  readonly onSelectProject: (project: Project) => void;
  readonly onAddProject: () => void;
  readonly runtime: ThreadRuntime;
  readonly onRuntimeChange: (runtime: ThreadRuntime) => void;
  readonly branches: ReadonlyArray<GitBranchInfo>;
  readonly branch: string;
  readonly onBranchChange: (branch: string) => void;
}

export function ComposerContextBar({
  projects,
  activeProject,
  onSelectProject,
  onAddProject,
  runtime,
  onRuntimeChange,
  branches,
  branch,
  onBranchChange,
}: ComposerContextBarProps) {
  return (
    <div className="mb-1 flex h-6 items-center gap-0.5 px-1">
      {activeProject ? (
        <Picker
          label="Project"
          variant="ghost"
          value={activeProject.id}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
            icon: <Identicon name={project.name} size="sm" className="size-3" />,
          }))}
          onValueChange={(id) => {
            const picked = projects.find((project) => project.id === id);
            if (picked) onSelectProject(picked);
          }}
          action={{ label: "Add project…", icon: Add01Icon, onSelect: onAddProject }}
          className="max-w-[56%] shrink"
        />
      ) : (
        <button
          type="button"
          onClick={onAddProject}
          className={pillTriggerClass(undefined, "ghost")}
        >
          <Icon icon={Add01Icon} />
          <PillLabel>Add project</PillLabel>
        </button>
      )}
      <Picker
        label="Runtime"
        variant="ghost"
        value={runtime}
        options={RUNTIMES}
        onValueChange={onRuntimeChange}
      />
      <span className="min-w-2 flex-1" />
      {activeProject && (
        <BranchPicker branches={branches} value={branch} onValueChange={onBranchChange} />
      )}
    </div>
  );
}

interface BranchPickerProps {
  readonly branches: ReadonlyArray<GitBranchInfo>;
  readonly value: string;
  readonly onValueChange: (branch: string) => void;
}

function BranchPicker({ branches, value, onValueChange }: BranchPickerProps) {
  const names = branches.map((b) => b.name);
  const currentName = branches.find((b) => b.isCurrent)?.name;

  return (
    <Combobox.Root
      items={names}
      value={value}
      onValueChange={(next: string | null) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <Combobox.Trigger
        aria-label={`Branch: ${value}`}
        className={pillTriggerClass("max-w-[46%] shrink", "ghost")}
      >
        <Icon icon={GitBranchIcon} className="size-3 text-fg-muted" />
        <PillLabel mono>{value}</PillLabel>
        <PillChevron />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="end" className="z-50 outline-none">
          <Combobox.Popup
            aria-label="Branch"
            className="flex max-h-[min(20rem,var(--available-height))] w-max min-w-52 max-w-[min(24rem,var(--available-width))] origin-(--transform-origin) flex-col rounded-card bg-menu shadow-menu outline-none transition-[opacity,scale,translate] duration-180 ease-out-quint data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-110 data-starting-style:-translate-y-1 data-starting-style:scale-97 data-starting-style:opacity-0"
          >
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-edge px-2.5 text-fg-muted">
              <Icon icon={Search01Icon} className="size-3.5" />
              <Combobox.Input
                placeholder={
                  names.length > 1 ? `Search ${names.length} branches` : "Search branches"
                }
                className="h-full min-w-0 flex-1 bg-transparent font-mono text-label text-fg outline-none placeholder:font-sans placeholder:text-fg-faint"
              />
            </div>
            <Combobox.Empty>
              <div className="px-2.5 py-2.5 text-label text-fg-muted">No matching branches</div>
            </Combobox.Empty>
            <Combobox.List className="min-h-0 flex-1 scroll-py-1 overflow-y-auto overscroll-contain p-1 empty:hidden">
              {(name: string) => (
                <Combobox.Item
                  key={name}
                  value={name}
                  className="flex h-7 cursor-default items-center gap-2 rounded-chip px-2 text-fg-secondary outline-none select-none data-highlighted:bg-(--wash) data-highlighted:text-fg data-selected:text-fg"
                >
                  <span
                    title={name}
                    className="min-w-0 flex-1 truncate font-mono text-label leading-4"
                  >
                    {name}
                  </span>
                  {name === currentName && (
                    <span className="shrink-0 rounded-[4px] px-1 text-meta leading-4 text-fg-muted shadow-[inset_0_0_0_1px_var(--color-edge)]">
                      current
                    </span>
                  )}
                  <span className="flex size-3.5 shrink-0">
                    <Combobox.ItemIndicator className="flex text-fg transition-[opacity,scale] duration-150 ease-out-quint data-ending-style:scale-75 data-ending-style:opacity-0 data-starting-style:scale-75 data-starting-style:opacity-0">
                      <Icon icon={Tick02Icon} className="size-3.5" />
                    </Combobox.ItemIndicator>
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

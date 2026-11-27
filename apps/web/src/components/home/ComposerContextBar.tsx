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

export interface ComposerProjectControl {
  readonly projects: ReadonlyArray<Project>;
  readonly activeProject: Project | null;
  readonly onSelectProject: (project: Project) => void;
  readonly onAddProject: () => void;
}

interface ProjectPickerProps {
  readonly project: ComposerProjectControl;
  readonly side?: "top" | "bottom";
  readonly className?: string;
}

export function ProjectPicker({ project, side = "top", className }: ProjectPickerProps) {
  const { projects, activeProject, onSelectProject, onAddProject } = project;
  if (!activeProject) {
    return (
      <button type="button" onClick={onAddProject} className={pillTriggerClass(className, "ghost")}>
        <Icon icon={Add01Icon} />
        <PillLabel>Add project</PillLabel>
      </button>
    );
  }
  return (
    <Picker
      label="Project"
      variant="ghost"
      side={side}
      value={activeProject.id}
      options={projects.map((item) => ({
        value: item.id,
        label: item.name,
        icon: <Identicon name={item.name} size="sm" className="size-3" />,
      }))}
      onValueChange={(id) => {
        const picked = projects.find((item) => item.id === id);
        if (picked) onSelectProject(picked);
      }}
      action={{ label: "Add project…", icon: Add01Icon, onSelect: onAddProject }}
      className={className ?? "max-w-40 shrink-0"}
    />
  );
}

interface BranchPickerProps {
  readonly branches: ReadonlyArray<GitBranchInfo>;
  readonly value: string;
  readonly onValueChange: (branch: string) => void;
  readonly side?: "top" | "bottom";
  readonly align?: "start" | "end";
  readonly disabled?: boolean;
  readonly className?: string;
}

export function BranchPicker({
  branches,
  value,
  onValueChange,
  side = "bottom",
  align = "end",
  disabled = false,
  className,
}: BranchPickerProps) {
  const names = branches.some((b) => b.name === value)
    ? branches.map((b) => b.name)
    : [value, ...branches.map((b) => b.name)];
  const currentName = branches.find((b) => b.isCurrent)?.name;

  return (
    <Combobox.Root
      items={names}
      value={value}
      disabled={disabled}
      onValueChange={(next: string | null) => {
        if (next !== null && next !== value) onValueChange(next);
      }}
    >
      <Combobox.Trigger
        disabled={disabled}
        aria-label={`Branch: ${value}`}
        className={pillTriggerClass(className ?? "max-w-[46%] shrink", "ghost")}
      >
        <Icon icon={GitBranchIcon} className="size-3 text-fg-muted" />
        <PillLabel>{value}</PillLabel>
        <PillChevron />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner side={side} sideOffset={4} align={align} className="z-50 outline-none">
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
                className="h-full min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-faint"
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
                    className="min-w-0 flex-1 truncate text-label leading-[1.125rem]"
                  >
                    {name}
                  </span>
                  {name === currentName && (
                    <span className="shrink-0 rounded-[0.25rem] px-1 text-meta leading-4 text-fg-muted shadow-[inset_0_0_0_1px_var(--color-edge)]">
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

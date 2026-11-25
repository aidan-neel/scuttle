import { Delete02Icon, PencilEdit02Icon, PinIcon, PinOffIcon } from "@hugeicons/core-free-icons";
import type { AgentMemory, AgentMemoryCategory } from "@scuttle/contracts";
import { useState } from "react";
import { GitInput, GitTextarea } from "@/components/git/fields.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import { ChipRow, ErrorLine, Pill } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

export const MEMORY_CATEGORIES: ReadonlyArray<{
  readonly value: AgentMemoryCategory;
  readonly label: string;
}> = [
  { value: "fact", label: "Fact" },
  { value: "decision", label: "Decision" },
  { value: "convention", label: "Convention" },
  { value: "context", label: "Context" },
  { value: "issue", label: "Issue" },
  { value: "pr", label: "PR" },
];

const categoryLabel = (category: AgentMemoryCategory) =>
  MEMORY_CATEGORIES.find((item) => item.value === category)?.label ?? category;

export interface MemoryDraft {
  readonly category: AgentMemoryCategory;
  readonly title: string;
  readonly content: string;
}

interface MemoryFormProps {
  readonly initial: MemoryDraft;
  readonly submitLabel: string;
  readonly onSubmit: (draft: MemoryDraft) => Promise<unknown>;
  readonly onCancel: () => void;
}

export function MemoryForm({ initial, submitLabel, onSubmit, onCancel }: MemoryFormProps) {
  const task = useTask();
  const [category, setCategory] = useState(initial.category);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const ready = title.trim().length > 0 && content.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    const ok = await task.run(
      "save",
      () => onSubmit({ category, title: title.trim(), content: content.trim() }),
      "Could not save the memory.",
    );
    if (ok) onCancel();
  };

  return (
    <form
      aria-label={submitLabel}
      className="flex flex-col gap-1.5 border-b border-line pb-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ChipRow
        label="Category"
        value={category}
        options={MEMORY_CATEGORIES}
        onValueChange={setCategory}
      />
      <GitInput
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
        aria-label="Memory title"
        autoFocus
      />
      <GitTextarea
        rows={4}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="What should the agent remember?"
        aria-label="Memory content"
      />
      <div className="flex items-center justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!ready || task.busy !== null}>
          {task.busy !== null && <DotSpinner variant="working" label="Saving" />}
          {submitLabel}
        </Button>
      </div>
      <ErrorLine message={task.error} />
    </form>
  );
}

interface MemoryCardProps {
  readonly memory: AgentMemory;
  readonly onSave: (draft: MemoryDraft) => Promise<unknown>;
  readonly onTogglePin: () => Promise<unknown>;
  readonly onDelete: () => void;
}

export function MemoryCard({ memory, onSave, onTogglePin, onDelete }: MemoryCardProps) {
  const [editing, setEditing] = useState(false);
  const task = useTask();

  if (editing) {
    return (
      <MemoryForm
        initial={memory}
        submitLabel="Save"
        onSubmit={onSave}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <article className="group/memory rounded-card bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-edge)]">
      <header className="flex items-center gap-1.5 pl-1.5">
        <Pill tone={memory.pinned ? "accent" : "neutral"}>{categoryLabel(memory.category)}</Pill>
        <h3 className="min-w-0 flex-1 truncate text-label font-medium text-fg">{memory.title}</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={memory.pinned ? "Unpin memory" : "Pin memory"}
          aria-pressed={memory.pinned}
          title={memory.pinned ? "Unpin" : "Pin"}
          disabled={task.busy !== null}
          onClick={() => void task.run("pin", onTogglePin, "Could not update the memory.")}
          className={cn(
            !memory.pinned &&
              "opacity-0 transition-opacity duration-150 group-hover/memory:opacity-100 focus-visible:opacity-100",
            memory.pinned && "text-input hover:text-input",
          )}
        >
          <Icon icon={memory.pinned ? PinOffIcon : PinIcon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit memory"
          title="Edit"
          onClick={() => setEditing(true)}
          className="opacity-0 transition-opacity duration-150 group-hover/memory:opacity-100 focus-visible:opacity-100"
        >
          <Icon icon={PencilEdit02Icon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete memory"
          title="Delete"
          onClick={onDelete}
          className="opacity-0 transition-opacity duration-150 group-hover/memory:opacity-100 hover:text-danger focus-visible:opacity-100"
        >
          <Icon icon={Delete02Icon} />
        </Button>
      </header>
      <p className="mt-1 line-clamp-5 px-1.5 text-label leading-[1.5] whitespace-pre-wrap text-fg-secondary">
        {memory.content}
      </p>
      <p className="mt-1 px-1.5 pb-1 text-meta text-fg-faint">
        {memory.source === "user" ? "Added by you" : `Saved by ${memory.source}`} ·{" "}
        {formatRelativeAge(memory.updatedAt)}
      </p>
      <ErrorLine message={task.error} />
    </article>
  );
}

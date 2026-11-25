import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import type { Agent, AgentMemory, AgentMemoryCategory } from "@scuttle/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";
import { MEMORY_CATEGORIES, MemoryCard, MemoryForm } from "./MemoryCard.tsx";
import { ChipRow, EmptyLine, ErrorLine } from "./primitives.tsx";
import { useTask } from "./useTask.ts";

type CategoryFilter = "all" | AgentMemoryCategory;

const SEARCH_DEBOUNCE_MS = 200;

const CATEGORY_OPTIONS: ReadonlyArray<{ readonly value: CategoryFilter; readonly label: string }> =
  [{ value: "all", label: "All" }, ...MEMORY_CATEGORIES];

const byPinThenRecent = (a: AgentMemory, b: AgentMemory) =>
  a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt.localeCompare(a.updatedAt);

export function AgentMemoryTab({
  agent,
  memories,
}: {
  readonly agent: Agent;
  readonly memories: ReadonlyArray<AgentMemory>;
}) {
  const { createMemory, updateMemory, deleteMemory, searchMemories } = useWorkspace();
  const search = useTask();
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ReadonlyArray<string> | null>(null);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<AgentMemory | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length === 0) {
      requestRef.current += 1;
      setHits(null);
      return;
    }
    const request = ++requestRef.current;
    const timer = setTimeout(() => {
      void search.run(
        "search",
        async () => {
          const results = await searchMemories(agent.id, trimmed);
          if (request === requestRef.current) setHits(results.map((memory) => memory.id));
        },
        "Search failed.",
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [agent.id, trimmed]);

  const inCategory = (memory: AgentMemory) => category === "all" || memory.category === category;
  const visible =
    hits === null
      ? memories.filter(inCategory).toSorted(byPinThenRecent)
      : hits.flatMap((id) => memories.filter((memory) => memory.id === id && inCategory(memory)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-control bg-chrome px-2 shadow-raised focus-within:shadow-focus">
          {search.busy !== null ? (
            <DotSpinner variant="loading" label="Searching" />
          ) : (
            <Icon icon={Search01Icon} className="size-3.5 shrink-0 text-fg-muted" />
          )}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search memory"
            aria-label="Search memory"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg-faint"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          <Icon icon={Add01Icon} />
          Add
        </Button>
      </div>
      <ChipRow
        label="Memory category"
        value={category}
        options={CATEGORY_OPTIONS}
        onValueChange={setCategory}
      />
      <ErrorLine message={search.error} />
      {adding && (
        <MemoryForm
          initial={{ category: category === "all" ? "fact" : category, title: "", content: "" }}
          submitLabel="Add memory"
          onSubmit={(draft) => createMemory(agent.id, { ...draft, source: "user" })}
          onCancel={() => setAdding(false)}
        />
      )}
      {visible.length === 0 && !adding && (
        <EmptyLine>
          {hits !== null
            ? `No memory matches “${trimmed}”.`
            : memories.length === 0
              ? `${agent.name} has no memory yet. Add facts, decisions, and conventions it should keep.`
              : "No memory in this category."}
        </EmptyLine>
      )}
      <div className="flex flex-col gap-1.5">
        {visible.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onSave={(draft) => updateMemory(agent.id, memory.id, draft)}
            onTogglePin={() => updateMemory(agent.id, memory.id, { pinned: !memory.pinned })}
            onDelete={() => setDeleting(memory)}
          />
        ))}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete memory?"
        description={`“${deleting?.title ?? "This memory"}” will be permanently removed from ${agent.name}'s memory.`}
        confirmLabel="Delete memory"
        onConfirm={async () => {
          if (deleting !== null) await deleteMemory(agent.id, deleting.id);
        }}
      />
    </div>
  );
}

import type { ScuttleSkill } from "@scuttle/contracts";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceSelector } from "@/lib/workspace.tsx";
import { SearchField, SettingsGroup } from "./primitives.tsx";

export function SkillsSection({
  selectedSkillId,
  onSelectSkill,
}: {
  readonly selectedSkillId: string | null;
  readonly onSelectSkill: (skill: ScuttleSkill) => void;
}) {
  const skills = useWorkspaceSelector((s) => s.skills);
  const [query, setQuery] = useState("");
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/^\/?(?:scuttle|skuttle):/, "");

  const visible =
    normalized.length === 0
      ? skills
      : skills.filter(
          (skill) =>
            skill.id.toLowerCase().includes(normalized) ||
            skill.command.toLowerCase().includes(normalized) ||
            skill.description.toLowerCase().includes(normalized),
        );

  return (
    <div className="space-y-4">
      <p className="px-0.5 text-label text-fg-muted">
        Type{" "}
        <code className="rounded-[5px] bg-fg/7 px-1.5 py-0.5 font-mono text-meta text-fg">
          /scuttle:&lt;name&gt;
        </code>{" "}
        in any composer to run a built-in skill. Click any skill to read it.
      </p>

      <SettingsGroup title={`${skills.length} skills`}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search skills"
            className="flex-1"
          />
          <span className="shrink-0 px-1 font-mono text-meta text-fg-faint">
            {visible.length === skills.length
              ? `${skills.length}`
              : `${visible.length}/${skills.length}`}
          </span>
        </div>
        <div role="listbox" aria-label="Built-in skills" className="divide-y divide-line">
          {visible.map((skill) => {
            const selected = selectedSkillId === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelectSkill(skill)}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus",
                  selected ? "bg-fg/[0.06]" : "hover:bg-(--wash)",
                )}
              >
                <div className="flex items-center gap-2">
                  <code className="font-mono text-label font-medium text-fg">{skill.command}</code>
                  {skill.hidden && (
                    <span className="rounded-chip bg-fg/6 px-1.5 py-0.5 text-meta text-fg-muted">
                      Slash only
                    </span>
                  )}
                </div>
                {skill.description.length > 0 && (
                  <p className="line-clamp-2 text-label leading-[1.45] text-fg-muted">
                    {skill.description}
                  </p>
                )}
              </button>
            );
          })}
          {visible.length === 0 && (
            <div className="px-4 py-5 text-label text-fg-muted">
              No skills match “{query.trim()}”.
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
}

import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { SearchField } from "./primitives.tsx";
import { filterSettingsGroups, SETTINGS_GROUPS, type SectionId } from "./sections.ts";

const ITEM =
  "flex h-8 items-center gap-2.5 rounded-row px-2.5 text-body outline-none transition-colors duration-(--dur-hover) ease-hover focus-visible:shadow-focus";

function BackLink({ className }: { readonly className?: string }) {
  return (
    <Link to="/" className={buttonClass("ghost", "md", cn("justify-start", className))}>
      <Icon icon={ArrowLeft01Icon} />
      Back
    </Link>
  );
}

export function SettingsNav({ active }: { readonly active: SectionId }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const groups = filterSettingsGroups(query);
  const first = groups[0]?.sections[0];

  return (
    <nav
      aria-label="Settings"
      className="hidden w-[220px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line px-2 pt-12 pb-4 md:flex"
    >
      <BackLink className="self-start" />
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search settings"
        onEnter={() => {
          if (first !== undefined)
            void navigate({ to: "/settings", search: { section: first.id } });
        }}
      />
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-px">
            <div className="px-2.5 pb-1 text-meta font-medium text-fg-faint">{group.label}</div>
            {group.sections.map((section) => {
              const selected = section.id === active;
              return (
                <Link
                  key={section.id}
                  to="/settings"
                  search={{ section: section.id }}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    ITEM,
                    selected
                      ? "bg-white/[0.07] text-fg"
                      : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
                  )}
                >
                  <Icon icon={section.icon} className="size-4 shrink-0" />
                  {section.label}
                </Link>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-2.5 text-label text-fg-muted">No settings match “{query.trim()}”.</p>
        )}
      </div>
    </nav>
  );
}

const revealInline = (node: HTMLAnchorElement | null) => {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
};

export function SettingsNavCompact({ active }: { readonly active: SectionId }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line px-2 py-2 md:hidden">
      <BackLink className="self-start" />
      <nav
        aria-label="Settings"
        className="flex gap-1 overflow-x-auto px-0.5 pb-0.5 scrollbar-none"
      >
        {SETTINGS_GROUPS.flatMap((group) => group.sections).map((section) => {
          const selected = section.id === active;
          return (
            <Link
              key={section.id}
              ref={selected ? revealInline : undefined}
              to="/settings"
              search={{ section: section.id }}
              aria-current={selected ? "page" : undefined}
              className={cn(
                ITEM,
                "h-7 shrink-0 gap-1.5 px-2 text-label",
                selected
                  ? "bg-white/[0.07] text-fg"
                  : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
              )}
            >
              <Icon icon={section.icon} className="size-3.5 shrink-0" />
              {section.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

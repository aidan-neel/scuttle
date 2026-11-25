import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { SearchField } from "./primitives.tsx";
import { filterSettingsGroups, SETTINGS_GROUPS, type SectionId } from "./sections.ts";

const ITEM =
  "flex h-8 items-center gap-2.5 rounded-row px-2 text-body outline-none transition-colors duration-(--dur-hover) ease-hover focus-visible:shadow-focus";

export function SettingsSidebarNav({ active }: { readonly active: SectionId }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const groups = filterSettingsGroups(query);
  const first = groups[0]?.sections[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search settings"
        onEnter={() => {
          if (first !== undefined)
            void navigate({ to: "/settings", search: { section: first.id } });
        }}
      />
      <nav
        aria-label="Settings"
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto mask-[linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-24px),transparent)]"
      >
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-px">
            <div className="px-2 pb-1 text-meta font-medium text-fg-faint">{group.label}</div>
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
                      ? "bg-white/7 text-fg"
                      : "text-fg-muted hover:bg-white/4 hover:text-fg-secondary",
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
          <p className="px-2 text-label text-fg-muted">No settings match “{query.trim()}”.</p>
        )}
      </nav>
    </div>
  );
}

const revealInline = (node: HTMLAnchorElement | null) => {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
};

export function SettingsNavCompact({ active }: { readonly active: SectionId }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line px-2 py-2 md:hidden">
      <div className="flex items-center gap-1">
        <Link to="/" aria-label="Back" className={buttonClass("ghost", "icon-sm")}>
          <Icon icon={ArrowLeft01Icon} />
        </Link>
        <span className="text-[14px] font-semibold tracking-tight text-fg">Settings</span>
      </div>
      <nav
        aria-label="Settings"
        className="scrollbar-none flex gap-1 overflow-x-auto px-0.5 pb-0.5"
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
                "h-7 shrink-0 gap-1.5 rounded-chip px-2 text-label",
                selected
                  ? "bg-white/7 text-fg"
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

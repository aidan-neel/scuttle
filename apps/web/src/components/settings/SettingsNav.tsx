import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { SearchField } from "./primitives.tsx";
import { filterSettingsGroups, SETTINGS_GROUPS, type SectionId } from "./sections.ts";

const ITEM =
  "relative flex h-8 items-center gap-2.5 rounded-row px-2 text-body outline-none transition-colors duration-(--dur-hover) ease-hover focus-visible:shadow-focus";

export function SettingsSidebarNav({ active }: { readonly active: SectionId }) {
  const navigate = useNavigate();
  const pillId = useId();
  const [query, setQuery] = useState("");
  const groups = filterSettingsGroups(query);
  const first = groups[0]?.sections[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search settings"
        className="h-8 px-2"
        onEnter={() => {
          if (first !== undefined)
            void navigate({ to: "/settings/$section", params: { section: first.id } });
        }}
      />
      <nav
        aria-label="Settings"
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-1 pb-4 mask-[linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-24px),transparent)]"
      >
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-px">
            <div className="px-2 pb-1 text-meta font-medium text-fg-muted">{group.label}</div>
            {group.sections.map((section) => {
              const selected = section.id === active;
              return (
                <Link
                  key={section.id}
                  to="/settings/$section"
                  params={{ section: section.id }}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    ITEM,
                    selected ? "text-fg" : "text-fg-muted hover:bg-fg/4 hover:text-fg-secondary",
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId={`${pillId}-sidebar-nav`}
                      transition={spring.snappy}
                      aria-hidden
                      className="absolute inset-0 rounded-row bg-fg/7"
                    />
                  )}
                  <span className="relative z-10 inline-flex min-w-0 items-center gap-2.5">
                    <Icon icon={section.icon} className="size-4 shrink-0" />
                    <span className="truncate">{section.label}</span>
                  </span>
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
  const pillId = useId();
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line px-2 py-2 md:hidden">
      <Link
        to="/"
        className="flex h-8 w-full items-center gap-2 rounded-row px-2 text-[0.9375rem] font-medium tracking-tight text-fg-secondary outline-none transition-colors duration-(--dur-hover) ease-hover hover:bg-(--wash) hover:text-fg focus-visible:shadow-focus"
      >
        <Icon icon={ArrowLeft02Icon} className="size-4 shrink-0" />
        <span>Settings</span>
      </Link>
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
              to="/settings/$section"
              params={{ section: section.id }}
              aria-current={selected ? "page" : undefined}
              className={cn(
                ITEM,
                "h-7 shrink-0 gap-1.5 rounded-chip px-2 text-label",
                selected ? "text-fg" : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
              )}
            >
              {selected && (
                <motion.span
                  layoutId={`${pillId}-compact-nav`}
                  transition={spring.snappy}
                  aria-hidden
                  className="absolute inset-0 rounded-chip bg-fg/7"
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <Icon icon={section.icon} className="size-3.5 shrink-0" />
                {section.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

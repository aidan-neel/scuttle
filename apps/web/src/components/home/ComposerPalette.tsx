import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly hint?: string;
  readonly icon?: IconSvgElement;
  readonly leading?: ReactNode;
  readonly drill?: boolean;
  readonly badge?: string;
  readonly onSelect: () => void;
}

export interface PaletteSection {
  readonly label?: string;
  readonly items: ReadonlyArray<PaletteItem>;
}

export interface PaletteContent {
  readonly label: string;
  readonly title?: string;
  readonly onBack?: () => void;
  readonly sections: ReadonlyArray<PaletteSection>;
  readonly emptyText: string;
}

export const flattenSections = (sections: ReadonlyArray<PaletteSection>) =>
  sections.flatMap((section) => section.items);

export const paletteOptionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`;

interface ComposerPaletteProps {
  readonly listboxId: string;
  readonly content: PaletteContent;
  readonly activeIndex: number;
  readonly onActiveIndexChange: (index: number) => void;
}

export function ComposerPalette({
  listboxId,
  content,
  activeIndex,
  onActiveIndexChange,
}: ComposerPaletteProps) {
  const offsets = content.sections.map((_, sectionIndex) =>
    content.sections.slice(0, sectionIndex).reduce((sum, section) => sum + section.items.length, 0),
  );
  const hasItems = content.sections.some((section) => section.items.length > 0);

  return (
    <div
      onMouseDown={(event) => event.preventDefault()}
      className="absolute bottom-full left-0 z-40 mb-2 flex max-h-[min(26rem,60vh)] w-[min(24rem,100%)] flex-col rounded-card bg-menu shadow-menu transition-[opacity,translate] duration-150 ease-out-quint starting:translate-y-1 starting:opacity-0"
    >
      {content.title !== undefined && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-edge px-1.5">
          {content.onBack && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Back"
              onClick={content.onBack}
              className="flex size-5 cursor-pointer items-center justify-center rounded-chip text-fg-muted outline-none hover:bg-(--wash) hover:text-fg"
            >
              <Icon icon={ArrowLeft01Icon} className="size-3.5" />
            </button>
          )}
          <span className="min-w-0 truncate px-0.5 text-meta font-medium text-fg-muted">
            {content.title}
          </span>
        </div>
      )}
      <div
        id={listboxId}
        role="listbox"
        aria-label={content.label}
        className="min-h-0 flex-1 scroll-py-1 overflow-y-auto overscroll-contain p-1"
      >
        {!hasItems && <div className="px-2 py-2 text-label text-fg-muted">{content.emptyText}</div>}
        {content.sections.map((section, sectionIndex) =>
          section.items.length === 0 ? null : (
            <div key={section.label ?? sectionIndex} role="group" aria-label={section.label}>
              {section.label !== undefined && (
                <div className="px-2 pt-1.5 pb-1 text-meta font-medium text-fg-muted">
                  {section.label}
                </div>
              )}
              {section.items.map((item, offset) => {
                const itemIndex = (offsets[sectionIndex] ?? 0) + offset;
                return (
                  <PaletteRow
                    key={item.id}
                    id={paletteOptionId(listboxId, itemIndex)}
                    item={item}
                    active={itemIndex === activeIndex}
                    onHover={() => onActiveIndexChange(itemIndex)}
                  />
                );
              })}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

interface PaletteRowProps {
  readonly id: string;
  readonly item: PaletteItem;
  readonly active: boolean;
  readonly onHover: () => void;
}

function PaletteRow({ id, item, active, onHover }: PaletteRowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      ref={(node) => {
        if (active) node?.scrollIntoView({ block: "nearest" });
      }}
      onMouseMove={active ? undefined : onHover}
      onClick={item.onSelect}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-chip px-2 text-label outline-none select-none",
        item.description === undefined ? "h-7" : "py-1.5",
        active ? "bg-(--wash) text-fg" : "text-fg-secondary",
      )}
    >
      {item.leading ??
        (item.icon && <Icon icon={item.icon} className="size-3.5 shrink-0 text-fg-muted" />)}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate leading-4">{item.label}</span>
        {item.description !== undefined && (
          <span className="truncate text-meta text-fg-muted">{item.description}</span>
        )}
      </span>
      {item.badge !== undefined && (
        <span className="shrink-0 rounded-[4px] px-1 text-meta leading-4 text-fg-muted shadow-[inset_0_0_0_1px_var(--color-edge)]">
          {item.badge}
        </span>
      )}
      {item.hint !== undefined && (
        <span className="max-w-32 shrink-0 truncate text-meta text-fg-faint">{item.hint}</span>
      )}
      {item.drill && <Icon icon={ArrowRight01Icon} className="size-3 shrink-0 text-fg-faint" />}
    </div>
  );
}

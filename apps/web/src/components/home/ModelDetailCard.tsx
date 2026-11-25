import { Add01Icon, StarIcon } from "@hugeicons/core-free-icons";
import type { EffortLevel, ProviderStatusKind } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { buttonClass } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import type { ModelEntry } from "@/lib/modelGrouping.ts";
import { spring } from "@/lib/motion.ts";
import { ReasoningSlider } from "./ReasoningSlider.tsx";

const STATUS_DOT: Record<ProviderStatusKind, string> = {
  ready: "bg-success",
  unauthenticated: "bg-warning",
  unavailable: "bg-danger",
  probing: "bg-fg-faint",
  disabled: "bg-fg-faint",
};

interface ModelDetailCardProps {
  readonly entry: ModelEntry;
  readonly effort: EffortLevel | undefined;
  readonly favorited: boolean;
  readonly onEffortChange: (effort: EffortLevel) => void;
  readonly onToggleFavorite: () => void;
}

export function ModelDetailCard({
  entry,
  effort,
  favorited,
  onEffortChange,
  onToggleFavorite,
}: ModelDetailCardProps) {
  const showReasoning = entry.model.efforts.length > 0 && effort !== undefined;

  return (
    <div className="hidden w-[244px] overflow-hidden rounded-card bg-menu p-3.5 shadow-menu sm:block">
      <div className="flex flex-col gap-3.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BrandLogo brand={entry.provider.kind} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">
              {entry.displayName}
            </span>
            <span
              title={entry.provider.status}
              className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[entry.provider.status]}`}
            />
          </div>
          <div className="flex items-center gap-1.5 text-meta text-fg-muted">
            <span className="truncate">{entry.provider.name}</span>
            {entry.upstream && (
              <>
                <span className="text-fg-faint">·</span>
                <span className="truncate">{entry.upstream.label}</span>
              </>
            )}
            {entry.provider.version && (
              <>
                <span className="text-fg-faint">·</span>
                <span className="font-mono text-fg-faint">v{entry.provider.version}</span>
              </>
            )}
          </div>
          {entry.model.slug !== entry.displayName && (
            <div className="truncate font-mono text-[11px] text-fg-faint">{entry.model.slug}</div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {showReasoning && (
            <motion.div
              key="reasoning"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring.snappy}
              className="overflow-hidden"
            >
              <div className="border-t border-edge pt-3">
                <ReasoningSlider
                  efforts={entry.model.efforts}
                  value={effort}
                  onChange={onEffortChange}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={onToggleFavorite}
          className={buttonClass("secondary", "sm", "w-full cursor-pointer justify-center gap-1.5")}
        >
          <Icon
            icon={favorited ? StarIcon : Add01Icon}
            className={`size-3.5 ${favorited ? "text-warning" : ""}`}
          />
          {favorited ? "Favorited" : "Add to favorites"}
        </button>
      </div>
    </div>
  );
}

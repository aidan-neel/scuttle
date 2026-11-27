import type { ScuttleVizSpec, VizBlock, VizCalloutBlock } from "@scuttle/contracts";
import { Tabs } from "@base-ui/react/tabs";
import {
  Alert02Icon,
  ArrowExpand01Icon,
  Cancel01Icon,
  Copy01Icon,
  FilterHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useReducer, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DialogCloseButton, DialogShell } from "@/components/ui/DialogShell.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { VizChart } from "./VizChart.tsx";
import { VizComparison } from "./VizComparison.tsx";
import { VizFlow } from "./VizFlow.tsx";
import { VizKpiStrip } from "./VizKpiStrip.tsx";
import { VizSandboxFrame } from "./VizSandboxFrame.tsx";
import { VizTable } from "./VizTable.tsx";
import { isSameFilter, TONE_TEXT, type VizFilter, vizToMarkdown } from "./vizModel.ts";

export interface VizCardState {
  readonly tabId: string | null;
  readonly filter: VizFilter | null;
  readonly expanded: boolean;
}

export type VizCardAction =
  | { readonly _tag: "SelectTab"; readonly tabId: string }
  | { readonly _tag: "SetFilter"; readonly filter: VizFilter | null }
  | { readonly _tag: "SetExpanded"; readonly expanded: boolean };

type CopyState = "idle" | "copied" | "failed";

export const initialVizCardState = (spec: ScuttleVizSpec): VizCardState => ({
  tabId: spec.mode === "structured" ? (spec.tabs?.[0]?.id ?? null) : null,
  filter: null,
  expanded: false,
});

export const vizCardReducer = (state: VizCardState, action: VizCardAction): VizCardState => {
  switch (action._tag) {
    case "SelectTab":
      return state.tabId === action.tabId ? state : { ...state, tabId: action.tabId };
    case "SetFilter":
      return {
        ...state,
        filter:
          action.filter === null || isSameFilter(state.filter, action.filter)
            ? null
            : action.filter,
      };
    case "SetExpanded":
      return { ...state, expanded: action.expanded };
  }
};

export const activeTabBlocks = (
  spec: ScuttleVizSpec,
  tabId: string | null,
): ReadonlyArray<VizBlock> => {
  if (spec.mode !== "structured") return [];
  const tabs = spec.tabs ?? [];
  return (tabs.find((t) => t.id === tabId) ?? tabs[0])?.blocks ?? [];
};

const CALLOUT_EDGE: Record<NonNullable<VizCalloutBlock["tone"]>, string> = {
  neutral: "before:bg-fg-faint",
  primary: "before:bg-primary",
  success: "before:bg-success",
  warning: "before:bg-warning",
  danger: "before:bg-danger",
};

function Callout({ block }: { readonly block: VizCalloutBlock }) {
  const tone = block.tone ?? "neutral";
  return (
    <aside
      className={cn(
        "relative rounded-row bg-(--wash) py-2.5 pr-3.5 pl-4 before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full",
        CALLOUT_EDGE[tone],
      )}
    >
      {block.title !== undefined && (
        <p className={cn("text-label font-medium", TONE_TEXT[tone])}>{block.title}</p>
      )}
      <p className="text-label whitespace-pre-wrap text-fg-secondary">{block.body}</p>
    </aside>
  );
}

function BlockView({
  block,
  filter,
  onFilter,
}: {
  readonly block: VizBlock;
  readonly filter: VizFilter | null;
  readonly onFilter: (filter: VizFilter | null) => void;
}) {
  switch (block.kind) {
    case "kpis":
      return <VizKpiStrip block={block} filter={filter} onFilter={onFilter} />;
    case "chart":
      return <VizChart block={block} filter={filter} onFilter={onFilter} />;
    case "table":
      return <VizTable block={block} filter={filter} />;
    case "comparison":
      return <VizComparison block={block} filter={filter} />;
    case "flow":
      return <VizFlow block={block} />;
    case "callout":
      return <Callout block={block} />;
  }
}

const TAB =
  "relative flex h-9 cursor-pointer items-center gap-1.5 px-2 text-label text-fg-muted outline-none select-none transition-colors duration-(--dur-hover) hover:text-fg focus-visible:text-fg data-active:text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-active:after:bg-fg";

function CardBody({
  spec,
  state,
  dispatch,
  inDialog,
}: {
  readonly spec: ScuttleVizSpec;
  readonly state: VizCardState;
  readonly dispatch: (action: VizCardAction) => void;
  readonly inDialog: boolean;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const onFilter = (filter: VizFilter | null) => dispatch({ _tag: "SetFilter", filter });
  const onCopy = () => {
    const write = navigator.clipboard?.writeText(vizToMarkdown(spec));
    if (write === undefined) setCopy("failed");
    else
      write.then(
        () => setCopy("copied"),
        () => setCopy("failed"),
      );
    setTimeout(() => setCopy("idle"), 1600);
  };
  const blocks = (scope: string, list: ReadonlyArray<VizBlock>) =>
    list.map((block, i) => (
      <BlockView
        key={`${scope}:${block.kind}:${i}`}
        block={block}
        filter={state.filter}
        onFilter={onFilter}
      />
    ));
  const tabs = spec.mode === "structured" ? (spec.tabs ?? []) : [];

  return (
    <>
      <header className={cn("flex items-start gap-3 px-4 pt-3.5 pb-3", inDialog && "pr-12")}>
        <div className="min-w-0 flex-1">
          <h3 className="text-title font-semibold tracking-[-0.01em] text-fg">{spec.title}</h3>
          {spec.subtitle !== undefined && (
            <p className="mt-0.5 text-label text-fg-muted">{spec.subtitle}</p>
          )}
        </div>
        <div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={copy === "failed" ? "Copy failed" : "Copy as Markdown"}
            title={copy === "failed" ? "Clipboard unavailable" : "Copy as Markdown"}
            onClick={onCopy}
          >
            <Icon
              icon={copy === "copied" ? Tick02Icon : copy === "failed" ? Alert02Icon : Copy01Icon}
              className={cn(
                copy === "copied" && "text-success",
                copy === "failed" && "text-danger",
              )}
            />
          </Button>
          {!inDialog && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Expand"
              title="Expand"
              onClick={() => dispatch({ _tag: "SetExpanded", expanded: true })}
            >
              <Icon icon={ArrowExpand01Icon} />
            </Button>
          )}
        </div>
      </header>
      {spec.mode === "sandbox" ? (
        <div className="px-4 pb-4">
          <VizSandboxFrame title={spec.title} html={spec.html} height={spec.height} />
        </div>
      ) : (
        <>
          {spec.takeaway !== undefined && (
            <p className="mx-4 mb-3.5 border-l-2 border-primary pl-3 text-body text-fg">
              {spec.takeaway}
            </p>
          )}
          {state.filter !== null && (
            <div className="mx-4 mb-3 flex" role="status">
              <span className="flex h-6 items-center gap-1.5 rounded-chip bg-primary/12 pr-0.5 pl-2 text-meta text-primary">
                <Icon icon={FilterHorizontalIcon} className="size-3" />
                <span className="text-fg-muted">{state.filter.key}</span>
                <span className="font-medium">{state.filter.value}</span>
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => onFilter(null)}
                  className="grid size-5 cursor-pointer place-items-center rounded-chip outline-none hover:bg-primary/15 focus-visible:shadow-focus"
                >
                  <Icon icon={Cancel01Icon} className="size-3" />
                </button>
              </span>
            </div>
          )}
          {(spec.blocks?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-6 px-4 pb-4">{blocks("root", spec.blocks ?? [])}</div>
          )}
          {tabs.length > 0 && (
            <Tabs.Root
              value={state.tabId ?? tabs[0]?.id}
              onValueChange={(value) => {
                if (typeof value === "string") dispatch({ _tag: "SelectTab", tabId: value });
              }}
            >
              <Tabs.List className="flex items-center gap-1 border-y border-line px-2.5">
                {tabs.map((tab) => (
                  <Tabs.Tab key={tab.id} value={tab.id} className={TAB}>
                    {tab.label}
                    {tab.badge !== undefined && (
                      <span className="rounded-chip bg-(--wash-strong) px-1 text-meta text-fg-muted tabular-nums">
                        {tab.badge}
                      </span>
                    )}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <Tabs.Panel
                value={state.tabId ?? tabs[0]?.id}
                className="flex flex-col gap-6 p-4 outline-none"
              >
                {blocks(`tab:${state.tabId ?? ""}`, activeTabBlocks(spec, state.tabId))}
              </Tabs.Panel>
            </Tabs.Root>
          )}
        </>
      )}
    </>
  );
}

export function ScuttleVizCard({
  spec,
  className,
}: {
  readonly spec: ScuttleVizSpec;
  readonly className?: string;
}) {
  const [state, dispatch] = useReducer(vizCardReducer, spec, initialVizCardState);
  return (
    <article
      className={cn("flex flex-col overflow-hidden rounded-card bg-panel shadow-raised", className)}
    >
      <CardBody spec={spec} state={state} dispatch={dispatch} inDialog={false} />
      <DialogShell
        open={state.expanded}
        onOpenChange={(expanded) => dispatch({ _tag: "SetExpanded", expanded })}
        className="top-[5vh] max-h-[90vh] w-[min(72rem,calc(100vw-2rem))]"
      >
        <DialogCloseButton />
        <div className="overflow-y-auto">
          <CardBody spec={spec} state={state} dispatch={dispatch} inDialog />
        </div>
      </DialogShell>
    </article>
  );
}

import { Cancel01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { ScuttleSkill, ScuttleSkillDetail } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { Skeleton } from "skullet/react";
import { MarkdownView } from "@/components/thread/MarkdownView.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";

const detailCache = new Map<string, ScuttleSkillDetail>();

const cacheKey = (skillId: string, file: string) => `${skillId}::${file}`;

const isMarkdownFile = (file: string) => /\.(?:md|mdx|markdown)$/i.test(file);

const SAMPLE_SKILL_MARKDOWN = `# Skill instructions

Loads the project context, plans the smallest change that meets the goal, and verifies every step before reporting back.

## Workflow

- Read the relevant source files and tests before editing.
- Keep each change focused on the stated requirement.
- Run formatting, linting, typechecks, and unit tests before finishing.`;

type DetailState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly detail: ScuttleSkillDetail }
  | { readonly kind: "error"; readonly message: string };

function SkillSidebarBody({
  skill,
  onClose,
}: {
  readonly skill: ScuttleSkill;
  readonly onClose: () => void;
}) {
  const { getSkillDetail } = useWorkspace();
  const pillId = useId();
  const [activeFile, setActiveFile] = useState("SKILL.md");
  const [copied, setCopied] = useState(false);
  const [fetched, setFetched] = useState<{
    readonly key: string;
    readonly state: DetailState;
  } | null>(null);

  const activeKey = cacheKey(skill.id, activeFile);
  const cachedDetail = detailCache.get(activeKey);

  useEffect(() => {
    if (cachedDetail !== undefined) return;
    let cancelled = false;
    void getSkillDetail(skill.id, activeFile === "SKILL.md" ? undefined : activeFile)
      .then((detail) => {
        detailCache.set(activeKey, detail);
        if (!cancelled) {
          setFetched({ key: activeKey, state: { kind: "ready", detail } });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFetched({
            key: activeKey,
            state: {
              kind: "error",
              message: error instanceof Error ? error.message : "Could not load skill.",
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeFile, activeKey, cachedDetail, getSkillDetail, skill.id]);

  const state: DetailState =
    cachedDetail !== undefined
      ? { kind: "ready", detail: cachedDetail }
      : fetched !== null && fetched.key === activeKey
        ? fetched.state
        : { kind: "loading" };

  const files = state.kind === "ready" ? state.detail.files : ["SKILL.md"];

  const copyCommand = () => {
    void navigator.clipboard.writeText(skill.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-5 pt-[calc(0.875rem+var(--desktop-controls-top-inset))] pb-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <code className="truncate font-mono text-body font-medium text-fg">
              {skill.command}
            </code>
            {skill.hidden && (
              <span className="shrink-0 rounded-chip bg-fg/6 px-1.5 py-0.5 text-meta text-fg-muted">
                Slash only
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={copyCommand}>
              <Icon icon={copied ? Tick02Icon : Copy01Icon} />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close skill viewer"
              onClick={onClose}
            >
              <Icon icon={Cancel01Icon} />
            </Button>
          </div>
        </div>

        {skill.description.length > 0 && (
          <p className="line-clamp-2 text-label leading-[1.45] text-fg-muted">
            {skill.description}
          </p>
        )}

        {files.length > 1 && (
          <div
            role="tablist"
            aria-label="Skill files"
            className="scrollbar-none -mx-1 flex items-center gap-1 overflow-x-auto pt-0.5 pr-8 pl-1 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]"
          >
            {files.map((file) => {
              const selected = file === activeFile;
              return (
                <button
                  key={file}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveFile(file)}
                  className={cn(
                    "relative inline-flex h-6 shrink-0 cursor-pointer items-center rounded-chip px-2 font-mono text-meta outline-none transition-colors duration-(--dur-hover) active:scale-[0.98] focus-visible:shadow-focus",
                    selected
                      ? "text-fg"
                      : "text-fg-muted hover:bg-(--wash) hover:text-fg-secondary",
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId={`${pillId}-skill-file`}
                      transition={spring.snappy}
                      aria-hidden
                      className="absolute inset-0 rounded-chip bg-fg/10 shadow-[inset_0_0_0_1px_var(--color-edge)]"
                    />
                  )}
                  <span className="relative z-10">{file}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <Skeleton
          loading={state.kind === "loading"}
          id="skill-viewer-body"
          label={`Loading ${skill.command}`}
          error={
            state.kind === "error" ? (
              <div className="text-label text-danger">{state.message}</div>
            ) : undefined
          }
        >
          {state.kind === "ready" ? (
            isMarkdownFile(state.detail.activeFile) ? (
              <MarkdownView content={state.detail.content} streaming={false} />
            ) : (
              <pre className="overflow-x-auto rounded-card bg-chrome/90 p-3.5 font-mono text-[0.8125rem] leading-[1.6] text-fg-secondary shadow-raised">
                <code>{state.detail.content}</code>
              </pre>
            )
          ) : (
            <MarkdownView content={SAMPLE_SKILL_MARKDOWN} streaming={false} />
          )}
        </Skeleton>
      </div>
    </div>
  );
}

export function SkillViewerSidebar({
  skill,
  onClose,
}: {
  readonly skill: ScuttleSkill | null;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    if (skill === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, skill]);

  return (
    <AnimatePresence initial={false}>
      {skill !== null && (
        <>
          <motion.div
            key="skill-sidebar-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          />
          <motion.aside
            key="skill-sidebar-panel"
            aria-label={`${skill.command} viewer`}
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0, transition: { duration: 0.14, ease: "easeOut" } }}
            transition={spring.snappy}
            className="fixed inset-y-0 right-0 z-40 w-[min(32.5rem,100vw)] border-l border-line bg-panel shadow-menu lg:static lg:z-auto lg:w-[30rem] lg:shrink-0 lg:bg-panel/60 lg:shadow-none xl:w-[33.75rem]"
          >
            <SkillSidebarBody key={skill.id} skill={skill} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

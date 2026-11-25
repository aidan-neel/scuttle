import { Dialog } from "@base-ui/react/dialog";
import { Search01Icon } from "@hugeicons/core-free-icons";
import type { Agent, Project, Thread } from "@scuttle/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { isAgentThread } from "@/lib/agentState.ts";
import { formatRelativeAge } from "@/lib/format.ts";
import { easeOut, spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";

const THREAD_LIMIT = 12;

interface SearchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

type Result =
  | { readonly kind: "agent"; readonly agent: Agent }
  | { readonly kind: "thread"; readonly thread: Thread }
  | { readonly kind: "project"; readonly project: Project };

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { agents, projects, threads, selectProject } = useWorkspace();
  const navigate = useNavigate();
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const q = query.trim().toLowerCase();
  const matchedAgents = agents.filter(
    (a) =>
      q.length === 0 ||
      a.name.toLowerCase().includes(q) ||
      a.purpose.toLowerCase().includes(q) ||
      a.projectName.toLowerCase().includes(q),
  );
  const matchedThreads = threads
    .filter(
      (t) =>
        !isAgentThread(agents, t.id) &&
        (q.length === 0 ||
          t.title.toLowerCase().includes(q) ||
          t.projectName.toLowerCase().includes(q) ||
          t.branch.toLowerCase().includes(q)),
    )
    .slice(0, THREAD_LIMIT);
  const matchedProjects = projects.filter(
    (p) => q.length === 0 || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  );
  const results: ReadonlyArray<Result> = [
    ...matchedAgents.map((agent): Result => ({ kind: "agent", agent })),
    ...matchedThreads.map((thread): Result => ({ kind: "thread", thread })),
    ...matchedProjects.map((project): Result => ({ kind: "project", project })),
  ];
  const active = Math.min(activeIndex, results.length - 1);
  const threadOffset = matchedAgents.length;
  const projectOffset = threadOffset + matchedThreads.length;

  const rowId = (index: number) => `${baseId}-row-${index}`;
  const moveTo = (index: number) => {
    setActiveIndex(index);
    document.getElementById(rowId(index))?.scrollIntoView({ block: "nearest" });
  };

  const choose = (result: Result) => {
    onOpenChange(false);
    if (result.kind === "agent") {
      void navigate({ to: "/agents/$agentId", params: { agentId: result.agent.id } });
    } else if (result.kind === "thread") {
      void navigate({ to: "/threads/$threadId", params: { threadId: result.thread.id } });
    } else {
      selectProject(result.project.id);
      void navigate({ to: "/" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo((active + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo((active - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[active];
      if (result !== undefined) choose(result);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence
        onExitComplete={() => {
          setQuery("");
          setActiveIndex(0);
        }}
      >
        {open && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.16, ease: easeOut } }}
                  exit={{ opacity: 0, transition: { duration: 0.12, ease: easeOut } }}
                />
              }
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
            />
            <Dialog.Popup
              initialFocus={inputRef}
              render={
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: spring.snappy }}
                  exit={{ opacity: 0, y: 4, scale: 0.985, transition: { duration: 0.12 } }}
                />
              }
              className="fixed inset-x-0 top-[14vh] z-50 mx-auto flex w-[min(540px,calc(100vw-2rem))] flex-col overflow-hidden rounded-canvas bg-menu shadow-menu outline-none"
            >
              <Dialog.Title className="sr-only">Search</Dialog.Title>
              <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
                <Icon icon={Search01Icon} className="size-4 shrink-0 text-fg-muted" />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-label="Search agents, threads, and projects"
                  aria-expanded
                  aria-controls={`${baseId}-list`}
                  aria-activedescendant={results.length > 0 ? rowId(active) : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Search agents, threads, and projects…"
                  className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted"
                />
                <kbd className="shrink-0 rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                  ESC
                </kbd>
              </div>

              <div
                id={`${baseId}-list`}
                role="listbox"
                aria-label="Results"
                className="h-80 shrink-0 overflow-y-auto overscroll-contain p-1.5"
              >
                {matchedAgents.length > 0 && (
                  <div role="group" aria-label="Agents">
                    <div className="flex h-7 items-center px-2 text-meta font-medium text-fg-muted">
                      Agents
                    </div>
                    {matchedAgents.map((agent, index) => (
                      <ResultRow
                        key={agent.id}
                        id={rowId(index)}
                        active={index === active}
                        onHover={() => setActiveIndex(index)}
                        onChoose={() => choose({ kind: "agent", agent })}
                      >
                        <Identicon name={agent.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">
                          {agent.name}
                        </span>
                        <span className="shrink-0 truncate text-meta text-fg-muted">
                          {agent.projectName}
                        </span>
                      </ResultRow>
                    ))}
                  </div>
                )}

                {matchedThreads.length > 0 && (
                  <div
                    role="group"
                    aria-label="Threads"
                    className={cn(matchedAgents.length > 0 && "mt-1.5")}
                  >
                    <div className="flex h-7 items-center px-2 text-meta font-medium text-fg-muted">
                      Threads
                    </div>
                    {matchedThreads.map((thread, index) => (
                      <ResultRow
                        key={thread.id}
                        id={rowId(threadOffset + index)}
                        active={threadOffset + index === active}
                        onHover={() => setActiveIndex(threadOffset + index)}
                        onChoose={() => choose({ kind: "thread", thread })}
                      >
                        <Identicon name={thread.projectName} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-body text-fg">
                          {thread.title}
                        </span>
                        <BrandLogo
                          brand={thread.modelSelection.providerKind}
                          className="size-3 shrink-0"
                        />
                        <span className="w-8 shrink-0 text-right text-meta text-fg-muted tabular-nums">
                          {formatRelativeAge(thread.updatedAt)}
                        </span>
                      </ResultRow>
                    ))}
                  </div>
                )}

                {matchedProjects.length > 0 && (
                  <div
                    role="group"
                    aria-label="Projects"
                    className={cn(projectOffset > 0 && "mt-1.5")}
                  >
                    <div className="flex h-7 items-center px-2 text-meta font-medium text-fg-muted">
                      Projects
                    </div>
                    {matchedProjects.map((project, index) => (
                      <ResultRow
                        key={project.id}
                        id={rowId(projectOffset + index)}
                        active={projectOffset + index === active}
                        onHover={() => setActiveIndex(projectOffset + index)}
                        onChoose={() => choose({ kind: "project", project })}
                      >
                        <Identicon name={project.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">
                          {project.name}
                        </span>
                        {project.isGitRepo && (
                          <span className="shrink-0 rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-meta text-fg-muted">
                            {project.defaultBranch}
                          </span>
                        )}
                      </ResultRow>
                    ))}
                  </div>
                )}

                {results.length === 0 && (
                  <p className="grid h-full place-items-center px-6 text-center text-label text-fg-muted">
                    {q.length > 0
                      ? `Nothing matches “${query.trim()}”.`
                      : "No agents, threads, or projects yet."}
                  </p>
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface ResultRowProps {
  readonly id: string;
  readonly active: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
  readonly children: ReactNode;
}

function ResultRow({ id, active, onHover, onChoose, children }: ResultRowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => !active && onHover()}
      onClick={onChoose}
      className={cn(
        "flex h-8 cursor-default items-center gap-2.5 rounded-chip px-2 transition-colors duration-(--dur-hover)",
        active && "bg-selected",
      )}
    >
      {children}
    </div>
  );
}

import { Dialog } from "@base-ui/react/dialog";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/ui/BrandLogo.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { formatRelativeAge } from "@/lib/format.ts";
import { useWorkspace } from "@/lib/workspace.tsx";

interface SearchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { projects, threads, selectProject } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const q = query.trim().toLowerCase();
  const matchedProjects = projects.filter(
    (p) => q.length === 0 || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  );
  const matchedThreads = threads.filter(
    (t) =>
      q.length === 0 ||
      t.title.toLowerCase().includes(q) ||
      t.projectName.toLowerCase().includes(q) ||
      t.branch.toLowerCase().includes(q),
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Popup className="fixed top-[18%] left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-canvas bg-menu shadow-menu outline-none">
          <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
            <Icon icon={Search01Icon} className="size-4 text-fg-muted" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search threads and projects…"
              className="flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted"
            />
            <kbd className="rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              ESC
            </kbd>
          </div>
          <div className="max-h-96 overflow-y-auto p-1.5">
            {matchedThreads.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-meta font-medium text-fg-muted">Threads</div>
                {matchedThreads.slice(0, 12).map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      void navigate({ to: "/threads/$threadId", params: { threadId: thread.id } });
                    }}
                    className="flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left transition-colors hover:bg-(--wash)"
                  >
                    <Identicon name={thread.projectName} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-body text-fg">
                      {thread.title}
                    </span>
                    <BrandLogo brand={thread.modelSelection.providerKind} className="size-3" />
                    <span className="text-meta text-fg-muted tabular-nums">
                      {formatRelativeAge(thread.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {matchedProjects.length > 0 && (
              <div>
                <div className="px-2 py-1 text-meta font-medium text-fg-muted">Projects</div>
                {matchedProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      selectProject(project.id);
                      onOpenChange(false);
                      void navigate({ to: "/" });
                    }}
                    className="flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left transition-colors hover:bg-(--wash)"
                  >
                    <Identicon name={project.name} size="sm" />
                    <span className="text-body font-medium text-fg">{project.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg-muted">
                      {project.path}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {matchedThreads.length === 0 && matchedProjects.length === 0 && (
              <p className="px-3 py-6 text-center text-label text-fg-muted">
                No matching threads or projects.
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

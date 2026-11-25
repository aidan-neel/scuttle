import { Dialog } from "@base-ui/react/dialog";
import {
  Alert02Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ComputerIcon,
  Folder01Icon,
  FolderOpenIcon,
  GitBranchIcon,
  Home01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { DirectoryEntry, DirectoryListing, Project } from "@scuttle/contracts";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Identicon } from "@/components/ui/Identicon.tsx";
import { easeOut, spring } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace.tsx";

const LISTING_LIMIT = 100;
const SPINNER_DELAY_MS = 180;

interface AddProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdded?: (project: Project) => void;
}

interface Crumb {
  readonly label: string;
  readonly path: string;
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "adding" }
  | { readonly kind: "error"; readonly message: string };

const IDLE: Status = { kind: "idle" };

const isPathQuery = (query: string) => query.startsWith("/") || query.startsWith("~");

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

function crumbsFor(path: string, home: string | null): ReadonlyArray<Crumb> {
  const root: Crumb =
    home !== null && (path === home || path.startsWith(`${home}/`))
      ? { label: "Home", path: home }
      : { label: "Computer", path: "/" };
  const crumbs = [root];
  let acc = root.path === "/" ? "" : root.path;
  for (const segment of path.slice(root.path.length).split("/").filter(Boolean)) {
    acc = `${acc}/${segment}`;
    crumbs.push({ label: segment, path: acc });
  }
  return crumbs;
}

function filterEntries(entries: ReadonlyArray<DirectoryEntry>, query: string) {
  const q = query.toLowerCase();
  if (q.length === 0) return entries;
  const rank = (entry: DirectoryEntry) =>
    (entry.isGitRepo ? 0 : 2) + Number(!entry.name.toLowerCase().startsWith(q));
  return entries
    .filter((entry) => entry.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b));
}

const keepFocus = (event: MouseEvent) => event.preventDefault();

export function AddProjectDialog({ open, onOpenChange, onAdded }: AddProjectDialogProps) {
  const { addProject, listDirectory } = useWorkspace();
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [knownRepos, setKnownRepos] = useState<Readonly<Record<string, boolean>>>({});
  const [status, setStatus] = useState<Status>(IDLE);
  const [showSpinner, setShowSpinner] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const rememberRepos = (entries: ReadonlyArray<DirectoryEntry>) =>
    setKnownRepos((known) => ({
      ...known,
      ...Object.fromEntries(entries.map((entry) => [entry.path, entry.isGitRepo])),
    }));

  const resetInput = () => {
    setQuery("");
    setActiveIndex(null);
    setStatus(IDLE);
  };

  const labelFor = (path: string | undefined) =>
    path === undefined ? "Home" : path === query.trim() ? path : basename(path);

  useEffect(() => {
    if (status.kind !== "loading") {
      setShowSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status.kind]);

  const browse = async (path?: string) => {
    const request = ++requestRef.current;
    setStatus({ kind: "loading" });
    try {
      const next = await listDirectory(path);
      if (request !== requestRef.current) return;
      setListing(next);
      if (path === undefined) setHomePath((home) => home ?? next.path);
      resetInput();
      listRef.current?.scrollTo({ top: 0 });
      rememberRepos(next.entries);
      if (knownRepos[next.path] === undefined && next.parentPath !== null) {
        listDirectory(next.parentPath).then(
          (parent) => rememberRepos(parent.entries),
          () => undefined,
        );
      }
    } catch {
      if (request !== requestRef.current) return;
      setStatus({ kind: "error", message: `Couldn’t open “${labelFor(path)}”.` });
    }
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(null);
      void browse(listing?.path);
    }
  }, [open]);

  const add = async (path: string) => {
    if (status.kind === "adding") return;
    setStatus({ kind: "adding" });
    try {
      const project = await addProject(path);
      onAdded?.(project);
      setStatus(IDLE);
      onOpenChange(false);
    } catch {
      setStatus({ kind: "error", message: `Couldn’t add “${labelFor(path)}”.` });
    }
  };

  const trimmed = query.trim();
  const pathMode = isPathQuery(trimmed);
  const rows = pathMode || listing === null ? [] : filterEntries(listing.entries, trimmed);
  const active = activeIndex === null ? undefined : rows[activeIndex];
  const crumbs = listing === null ? [] : crumbsFor(listing.path, homePath);
  const visibleCrumbs: ReadonlyArray<Crumb | null> =
    crumbs.length > 4 ? [...crumbs.slice(0, 1), null, ...crumbs.slice(-2)] : crumbs;
  const hiddenCrumb = crumbs.length > 4 ? crumbs[crumbs.length - 3] : undefined;

  const targetPath = pathMode ? trimmed : (active?.path ?? listing?.path ?? null);
  const targetName = targetPath === null ? "project" : basename(targetPath);

  const rowId = (index: number) => `${baseId}-row-${index}`;
  const moveTo = (index: number | null) => {
    setActiveIndex(index);
    if (index !== null) document.getElementById(rowId(index))?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && rows.length > 0) {
      event.preventDefault();
      moveTo(activeIndex === null ? 0 : Math.min(activeIndex + 1, rows.length - 1));
    } else if (event.key === "ArrowUp" && activeIndex !== null) {
      event.preventDefault();
      moveTo(activeIndex === 0 ? null : activeIndex - 1);
    } else if (event.key === "ArrowRight" && active !== undefined) {
      if (event.currentTarget.selectionStart !== query.length) return;
      event.preventDefault();
      void browse(active.path);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && targetPath !== null) void add(targetPath);
      else if (pathMode) void browse(trimmed);
      else if (active?.isGitRepo === true) void add(active.path);
      else if (active !== undefined) void browse(active.path);
    } else if (event.key === "Backspace" && query.length === 0 && !event.repeat) {
      if (listing?.parentPath == null) return;
      event.preventDefault();
      void browse(listing.parentPath);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence onExitComplete={resetInput}>
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
              <Dialog.Title className="sr-only">Add project</Dialog.Title>

              <div className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
                <Icon
                  icon={pathMode ? FolderOpenIcon : Search01Icon}
                  className="size-4 shrink-0 text-fg-muted"
                />
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-label="Filter folders or type a path"
                  aria-expanded
                  aria-controls={`${baseId}-list`}
                  aria-activedescendant={activeIndex === null ? undefined : rowId(activeIndex)}
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => {
                    const next = event.target.value;
                    setQuery(next);
                    const nextTrimmed = next.trim();
                    setActiveIndex(nextTrimmed.length > 0 && !isPathQuery(nextTrimmed) ? 0 : null);
                    if (status.kind === "error") setStatus(IDLE);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Filter folders, or type a path…"
                  className={cn(
                    "min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted",
                    pathMode && "font-mono text-label",
                  )}
                />
                <kbd className="shrink-0 rounded-chip bg-white/6 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
                  ESC
                </kbd>
              </div>

              <nav
                aria-label="Folder location"
                className="flex h-9 shrink-0 items-center gap-1 border-y border-line px-2 text-fg-muted"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Parent folder"
                  disabled={listing?.parentPath == null}
                  onMouseDown={keepFocus}
                  onClick={() => listing?.parentPath != null && void browse(listing.parentPath)}
                >
                  <Icon icon={ArrowUp01Icon} />
                </Button>
                <ol className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                  {visibleCrumbs.map((crumb, index) => {
                    const last = index === visibleCrumbs.length - 1;
                    const jump = crumb ?? hiddenCrumb;
                    return (
                      <li key={crumb?.path ?? "more"} className="flex min-w-0 items-center gap-0.5">
                        {index > 0 && (
                          <Icon icon={ArrowRight01Icon} className="size-3 shrink-0 text-fg-faint" />
                        )}
                        <button
                          type="button"
                          title={jump?.label}
                          aria-current={last ? "location" : undefined}
                          onMouseDown={keepFocus}
                          onClick={() => jump !== undefined && !last && void browse(jump.path)}
                          className={cn(
                            "flex h-6 min-w-0 items-center gap-1.5 rounded-chip px-1.5 text-label transition-colors duration-(--dur-hover)",
                            last
                              ? "font-medium text-fg"
                              : "text-fg-muted hover:bg-(--wash) hover:text-fg",
                          )}
                        >
                          {index === 0 && crumb !== null && (
                            <Icon
                              icon={crumb.label === "Home" ? Home01Icon : ComputerIcon}
                              className="size-3.5 shrink-0"
                            />
                          )}
                          <span className="truncate">{crumb?.label ?? "…"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <span className="flex w-5 shrink-0 items-center justify-center">
                  {showSpinner && <DotSpinner variant="loading" label="Loading" />}
                </span>
              </nav>

              <div
                ref={listRef}
                id={`${baseId}-list`}
                role="listbox"
                aria-label="Folders"
                className="relative h-72 shrink-0 overflow-y-auto overscroll-contain p-1.5"
              >
                {pathMode ? (
                  <div
                    role="option"
                    aria-selected
                    onMouseDown={keepFocus}
                    onClick={() => void browse(trimmed)}
                    className="flex h-8 cursor-default items-center gap-2.5 rounded-chip bg-selected px-2"
                  >
                    <Icon icon={FolderOpenIcon} className="size-4 shrink-0 text-fg-muted" />
                    <span className="shrink-0 text-body text-fg-secondary">Go to</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-label text-fg">
                      {trimmed}
                    </span>
                    <kbd className="shrink-0 font-mono text-[11px] text-fg-faint">↵</kbd>
                  </div>
                ) : (
                  rows.map((entry, index) => (
                    <FolderRow
                      key={entry.path}
                      id={rowId(index)}
                      entry={entry}
                      active={index === activeIndex}
                      adding={status.kind === "adding"}
                      onSelect={() => setActiveIndex(index)}
                      onEnter={() => void browse(entry.path)}
                      onAdd={() => void add(entry.path)}
                    />
                  ))
                )}
                {!pathMode && listing !== null && rows.length === 0 && (
                  <p className="grid h-full place-items-center px-6 text-center text-label text-fg-muted">
                    {trimmed.length > 0
                      ? `No folders match “${trimmed}”.`
                      : `${basename(listing.path)} has no folders inside.`}
                  </p>
                )}
                {!pathMode && listing !== null && listing.entries.length >= LISTING_LIMIT && (
                  <p className="px-2 pt-2 pb-1 text-meta text-fg-faint">
                    Showing the first {LISTING_LIMIT} folders. Type a path to jump elsewhere.
                  </p>
                )}
              </div>

              <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-line bg-black/10 px-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {status.kind === "error" ? (
                    <p
                      role="alert"
                      className="flex min-w-0 flex-1 items-center gap-2 text-label text-danger"
                    >
                      <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{status.message}</span>
                    </p>
                  ) : targetPath !== null ? (
                    <>
                      <Identicon name={targetName} size="md" className="shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body font-medium text-fg">{targetName}</span>
                        <span className="truncate text-meta text-fg-muted">
                          {knownRepos[targetPath] === true ? "Git repository" : "Folder"}
                        </span>
                      </span>
                    </>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={targetPath === null || status.kind === "adding"}
                  onClick={() => targetPath !== null && void add(targetPath)}
                  className="shrink-0"
                >
                  {status.kind === "adding" && <DotSpinner variant="working" label="Adding" />}
                  Add project
                </Button>
              </footer>
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface FolderRowProps {
  readonly id: string;
  readonly entry: DirectoryEntry;
  readonly active: boolean;
  readonly adding: boolean;
  readonly onSelect: () => void;
  readonly onEnter: () => void;
  readonly onAdd: () => void;
}

function FolderRow({ id, entry, active, adding, onSelect, onEnter, onAdd }: FolderRowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active}
      onMouseDown={keepFocus}
      onClick={(event) => {
        if (entry.isGitRepo) onSelect();
        else if (event.detail <= 1) onEnter();
      }}
      onDoubleClick={() => entry.isGitRepo && onEnter()}
      className={cn(
        "group relative flex h-8 cursor-default items-center gap-2.5 rounded-chip px-2 transition-colors duration-(--dur-hover)",
        active ? "bg-selected" : "hover:bg-(--wash)",
      )}
    >
      {entry.isGitRepo ? (
        <Identicon name={entry.name} size="sm" />
      ) : (
        <Icon icon={Folder01Icon} className="size-4 shrink-0 text-fg-muted" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body",
          entry.isGitRepo ? "font-medium text-fg" : "text-fg-secondary group-hover:text-fg",
        )}
      >
        {entry.name}
      </span>
      {entry.isGitRepo ? (
        <div className="relative flex h-6 w-12 shrink-0 items-center justify-end">
          <span className="flex items-center gap-1 rounded-chip bg-white/6 px-1.5 py-0.5 text-meta text-fg-muted transition-opacity duration-100 group-hover:opacity-0 group-data-[active=true]:opacity-0">
            <Icon icon={GitBranchIcon} className="size-3" />
            Git
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            tabIndex={-1}
            disabled={adding}
            onClick={(event) => {
              event.stopPropagation();
              onAdd();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="absolute right-0 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-data-[active=true]:opacity-100"
          >
            Add
          </Button>
        </div>
      ) : (
        <Icon
          icon={ArrowRight01Icon}
          className="size-3.5 shrink-0 text-fg-faint opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-data-[active=true]:opacity-100"
        />
      )}
    </div>
  );
}

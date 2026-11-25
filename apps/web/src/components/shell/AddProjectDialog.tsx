import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUp01Icon,
  Cancel01Icon,
  Folder01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import type { DirectoryListing } from "@scuttle/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { useWorkspace } from "@/lib/workspace.tsx";

interface AddProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps) {
  const { addProject, listDirectory } = useWorkspace();
  const [pathInput, setPathInput] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async (target?: string) => {
    setLoadingDir(true);
    setError(null);
    try {
      const next = await listDirectory(target);
      setListing(next);
      setPathInput(next.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not browse directory.");
    } finally {
      setLoadingDir(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void browse();
  }, [open]);

  const submit = async (targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addProject(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-canvas bg-menu p-4 shadow-menu outline-none">
          <div className="flex items-center justify-between gap-2 pb-3">
            <Dialog.Title className="text-title font-semibold tracking-tight text-fg">
              Add project
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-7 place-items-center rounded-control text-fg-muted hover:bg-(--wash) hover:text-fg"
            >
              <Icon icon={Cancel01Icon} className="size-4" />
            </Dialog.Close>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(pathInput);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="/path/to/repository"
              className="h-8 flex-1 rounded-control bg-chrome px-3 font-mono text-label text-fg shadow-raised outline-none placeholder:text-fg-muted focus:shadow-focus"
            />
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void browse(pathInput)}
            >
              Open
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={saving || pathInput.trim().length === 0}
            >
              Add
            </Button>
          </form>

          {error && (
            <p className="mt-2 rounded-chip border border-danger/25 bg-danger/10 px-2.5 py-1.5 text-label text-danger">
              {error}
            </p>
          )}

          <div className="mt-3 rounded-card border border-line bg-canvas/80">
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!listing?.parentPath || loadingDir}
                aria-label="Parent directory"
                onClick={() => listing?.parentPath && void browse(listing.parentPath)}
              >
                <Icon icon={ArrowUp01Icon} />
              </Button>
              <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg-muted">
                {listing?.path ?? "Loading…"}
              </span>
            </div>
            <ul className="max-h-64 overflow-y-auto p-1">
              {listing && listing.entries.length === 0 && (
                <li className="px-2.5 py-4 text-center text-label text-fg-muted">
                  No subdirectories here. Click Add to register this folder.
                </li>
              )}
              {listing?.entries.map((entry) => (
                <li key={entry.path} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void browse(entry.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-chip px-2 py-1.5 text-left text-label text-fg-secondary transition-colors hover:bg-(--wash) hover:text-fg"
                  >
                    <Icon
                      icon={entry.isGitRepo ? GitBranchIcon : Folder01Icon}
                      className={`size-3.5 shrink-0 ${entry.isGitRepo ? "text-input" : "text-fg-muted"}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.isGitRepo && (
                      <span className="rounded-chip bg-white/6 px-1.5 py-0.5 text-[10px] text-fg-muted">
                        git
                      </span>
                    )}
                  </button>
                  {entry.isGitRepo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => void submit(entry.path)}
                    >
                      Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

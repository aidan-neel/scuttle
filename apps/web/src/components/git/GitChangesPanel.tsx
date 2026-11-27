import { Download04Icon, GitCommitIcon, Upload04Icon } from "@hugeicons/core-free-icons";
import { describeApiError, type GitTargetRef } from "@scuttle/client-runtime";
import type {
  GitActionResult,
  GitChangedFile,
  GitFileStatus,
  GitRepoStatus,
  GitStatus,
} from "@scuttle/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { cn } from "@/lib/utils";
import { type Feedback, FeedbackLine, GitTextarea } from "./fields.tsx";
import { getGitApi } from "./gitApi.ts";

const STATUS_MARK: Record<GitFileStatus, { readonly letter: string; readonly tone: string }> = {
  modified: { letter: "M", tone: "text-warning" },
  added: { letter: "A", tone: "text-success" },
  deleted: { letter: "D", tone: "text-danger" },
  renamed: { letter: "R", tone: "text-fg-secondary" },
  copied: { letter: "C", tone: "text-fg-secondary" },
  typechange: { letter: "T", tone: "text-fg-secondary" },
  untracked: { letter: "U", tone: "text-success" },
  conflicted: { letter: "!", tone: "text-danger" },
};

function FileRow({ file }: { readonly file: GitChangedFile }) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  const mark = STATUS_MARK[file.status];
  return (
    <li
      title={file.originalPath !== null ? `${file.originalPath} → ${file.path}` : file.path}
      className="flex h-7 items-center gap-2 rounded-chip px-2 text-label hover:bg-(--wash)"
    >
      <span className={cn("w-3 shrink-0 text-center font-mono text-meta font-medium", mark.tone)}>
        {mark.letter}
      </span>
      <span className="flex min-w-0 flex-1">
        <span className="truncate text-fg-muted">{dir}</span>
        <span className="shrink-0 text-fg">{name}</span>
      </span>
      {(file.additions > 0 || file.deletions > 0) && (
        <span className="shrink-0 font-mono text-meta tabular-nums">
          <span className="text-success">+{file.additions}</span>{" "}
          <span className="text-danger">−{file.deletions}</span>
        </span>
      )}
    </li>
  );
}

type Busy = "commit" | "push" | "pull" | null;

export function GitChangesPanel({
  target,
  status,
  onStatus,
}: {
  readonly target: GitTargetRef;
  readonly status: GitRepoStatus;
  readonly onStatus: (status: GitStatus) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const hasChanges = status.files.length > 0;
  const canCommit = hasChanges && message.trim().length > 0 && busy === null;

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<GitActionResult>) => {
    setBusy(kind);
    setFeedback(null);
    try {
      const result = await action();
      onStatus(result.status);
      setFeedback({ tone: "ok", text: result.message });
      if (kind === "commit") setMessage("");
    } catch (error) {
      setFeedback({ tone: "error", text: describeApiError(error, `Git ${kind} failed.`) });
    }
    setBusy(null);
  };

  const commit = () =>
    run("commit", async () => (await getGitApi()).commitGit(target, { message: message.trim() }));

  return (
    <div className="space-y-1">
      {hasChanges ? (
        <ul className="max-h-56 overflow-y-auto" aria-label="Changed files">
          {status.files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-3 text-label text-fg-muted">
          Working tree clean{status.ahead > 0 ? ` · ${status.ahead} commit(s) to push` : ""}.
        </p>
      )}
      <div className="space-y-1.5 p-1">
        {hasChanges && (
          <GitTextarea
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canCommit) {
                event.preventDefault();
                void commit();
              }
            }}
            placeholder="Commit message"
            aria-label="Commit message"
          />
        )}
        <div className="flex items-center gap-1">
          {hasChanges && (
            <Button variant="primary" size="md" disabled={!canCommit} onClick={() => void commit()}>
              <Icon icon={GitCommitIcon} />
              {busy === "commit" ? "Committing…" : `Commit ${status.files.length}`}
            </Button>
          )}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="md"
            disabled={busy !== null || status.upstream === null}
            onClick={() => void run("pull", async () => (await getGitApi()).pullGit(target))}
          >
            <Icon icon={Download04Icon} />
            {busy === "pull" ? "Pulling…" : status.behind > 0 ? `Pull ${status.behind}` : "Pull"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={busy !== null || status.branch === null || status.remote === null}
            onClick={() => void run("push", async () => (await getGitApi()).pushGit(target))}
          >
            <Icon icon={Upload04Icon} />
            {busy === "push"
              ? "Pushing…"
              : status.upstream === null
                ? "Publish"
                : status.ahead > 0
                  ? `Push ${status.ahead}`
                  : "Push"}
          </Button>
        </div>
        <FeedbackLine feedback={feedback} />
      </div>
    </div>
  );
}

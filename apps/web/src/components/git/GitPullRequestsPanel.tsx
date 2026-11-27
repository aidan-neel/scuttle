import { GitPullRequestDraftIcon, GitPullRequestIcon } from "@hugeicons/core-free-icons";
import { describeApiError, type GitTargetRef } from "@scuttle/client-runtime";
import type { ForgeKind, GitRepoStatus, PullRequest } from "@scuttle/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { Switch } from "@/components/ui/Switch.tsx";
import { type Feedback, FeedbackLine, GitInput, GitTextarea } from "./fields.tsx";
import { getGitApi, openExternalUrl } from "./gitApi.ts";

export const REQUEST_NOUN: Record<ForgeKind, { readonly short: string; readonly long: string }> = {
  github: { short: "PR", long: "pull request" },
  gitlab: { short: "MR", long: "merge request" },
};

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly items: ReadonlyArray<PullRequest> }
  | { readonly kind: "error"; readonly message: string };

function PullRequestRow({
  forge,
  item,
}: {
  readonly forge: ForgeKind;
  readonly item: PullRequest;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => openExternalUrl(item.url)}
        className="flex w-full items-start gap-2 rounded-chip px-2 py-1.5 text-left outline-none hover:bg-(--wash) focus-visible:shadow-focus"
      >
        <Icon
          icon={item.isDraft ? GitPullRequestDraftIcon : GitPullRequestIcon}
          className={
            item.isDraft ? "mt-0.5 size-3.5 text-fg-muted" : "mt-0.5 size-3.5 text-success"
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label text-fg">{item.title}</span>
          <span className="block truncate font-mono text-meta text-fg-muted">
            {forge === "gitlab" ? "!" : "#"}
            {item.number} · {item.headBranch} → {item.baseBranch}
          </span>
        </span>
      </button>
    </li>
  );
}

function CreateForm({
  target,
  forge,
  onCreated,
  onCancel,
}: {
  readonly target: GitTargetRef;
  readonly forge: ForgeKind;
  readonly onCreated: (item: PullRequest) => void;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const noun = REQUEST_NOUN[forge];

  const submit = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const api = await getGitApi();
      const trimmedBase = base.trim();
      const created = await api.createPullRequest(target, {
        title: title.trim(),
        body,
        draft,
        ...(trimmedBase.length > 0 ? { base: trimmedBase } : {}),
      });
      onCreated(created);
    } catch (error) {
      setFeedback({
        tone: "error",
        text: describeApiError(error, `Could not open the ${noun.long}.`),
      });
    }
    setBusy(false);
  };

  return (
    <form
      className="space-y-1.5 p-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length > 0) void submit();
      }}
    >
      <GitInput
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
        aria-label={`${noun.short} title`}
        autoFocus
      />
      <GitTextarea
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Description (optional)"
        aria-label={`${noun.short} description`}
      />
      <div className="flex items-center gap-2">
        <GitInput
          value={base}
          onChange={(event) => setBase(event.target.value)}
          placeholder="Base: default branch"
          aria-label="Base branch"
          className="min-w-0 flex-1 font-mono"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-label text-fg-secondary">
          <Switch checked={draft} onCheckedChange={setDraft} aria-label="Open as draft" />
          Draft
        </label>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="md" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={busy || title.trim().length === 0}
        >
          {busy ? "Opening…" : `Open ${noun.short}`}
        </Button>
      </div>
      <FeedbackLine feedback={feedback} />
    </form>
  );
}

export function GitPullRequestsPanel({
  target,
  status,
}: {
  readonly target: GitTargetRef;
  readonly status: GitRepoStatus;
}) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<PullRequest | null>(null);
  const forge = status.forge === "gitlab" ? "gitlab" : "github";
  const noun = REQUEST_NOUN[forge];
  const supported = status.forge === "github" || status.forge === "gitlab";

  useEffect(() => {
    if (!supported) return;
    let active = true;
    setList({ kind: "loading" });
    void getGitApi()
      .then((api) => api.listPullRequests(target))
      .then((result) => {
        if (active) setList({ kind: "ready", items: result.items });
      })
      .catch((error: unknown) => {
        if (active) {
          setList({ kind: "error", message: describeApiError(error, "Could not load requests.") });
        }
      });
    return () => {
      active = false;
    };
  }, [target.projectId, target.threadId, supported]);

  if (!supported) {
    return (
      <p className="px-2 py-3 text-label text-fg-muted">
        {status.remote === null
          ? "This repository has no remote."
          : `Remote ${status.remote.name} is not on GitHub or GitLab.`}
      </p>
    );
  }

  if (creating) {
    return (
      <CreateForm
        target={target}
        forge={forge}
        onCancel={() => setCreating(false)}
        onCreated={(item) => {
          setCreating(false);
          setCreated(item);
          setList((current) =>
            current.kind === "ready" ? { kind: "ready", items: [item, ...current.items] } : current,
          );
        }}
      />
    );
  }

  return (
    <div className="space-y-1">
      {list.kind === "loading" && (
        <div className="flex items-center gap-2 px-2 py-3 text-label text-fg-muted">
          <DotSpinner variant="loading" label={`Loading ${noun.long}s`} />
          Loading open {noun.long}s…
        </div>
      )}
      {list.kind === "error" && (
        <div className="space-y-1 px-1 py-2">
          <FeedbackLine feedback={{ tone: "error", text: list.message }} />
          <Link
            to="/settings"
            search={{ section: "git" }}
            className="px-1 text-label text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
          >
            Open Git settings
          </Link>
        </div>
      )}
      {list.kind === "ready" &&
        (list.items.length === 0 ? (
          <p className="px-2 py-3 text-label text-fg-muted">No open {noun.long}s.</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto" aria-label={`Open ${noun.long}s`}>
            {list.items.map((item) => (
              <PullRequestRow key={item.number} forge={forge} item={item} />
            ))}
          </ul>
        ))}
      {created !== null && (
        <FeedbackLine feedback={{ tone: "ok", text: `Opened ${noun.short} ${created.number}.` }} />
      )}
      <div className="flex justify-end p-1">
        <Button
          variant="secondary"
          size="md"
          disabled={status.branch === null}
          onClick={() => {
            setCreated(null);
            setCreating(true);
          }}
        >
          <Icon icon={GitPullRequestIcon} />
          New {noun.short}
        </Button>
      </div>
    </div>
  );
}

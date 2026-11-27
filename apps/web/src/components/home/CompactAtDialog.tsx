import { Dialog } from "@base-ui/react/dialog";
import { describeApiError } from "@scuttle/client-runtime";
import { type RefObject, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import {
  DialogAlert,
  DialogCloseButton,
  DialogFooter,
  DialogShell,
} from "@/components/ui/DialogShell.tsx";
import { DotSpinner } from "@/components/ui/DotSpinner.tsx";
import { formatTokens, parseCompactAtInput } from "./contextUsage.ts";

interface CompactAtDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly currentTokens: number;
  readonly defaultTokens: number;
  readonly windowTokens: number;
  readonly hasThreadOverride: boolean;
  readonly supportsThreadScope: boolean;
  readonly onSaveThread: (tokens: number | null) => Promise<void> | void;
  readonly onSaveDefault: (tokens: number) => Promise<void> | void;
}

const formatExactTokens = (tokens: number) => Math.round(tokens).toLocaleString("en-US");

function CompactAtForm({
  inputRef,
  currentTokens,
  defaultTokens,
  windowTokens,
  hasThreadOverride,
  supportsThreadScope,
  onSaveThread,
  onSaveDefault,
  onClose,
}: Omit<CompactAtDialogProps, "open" | "onOpenChange"> & {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onClose: () => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(() => formatExactTokens(currentTokens));
  const [busy, setBusy] = useState<"save" | "default" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseCompactAtInput(draft, windowTokens);
  const valid = parsed !== null;
  const pct =
    parsed !== null && windowTokens > 0 ? Math.round((parsed / windowTokens) * 100) : null;
  const canReset = hasThreadOverride || (parsed !== null && parsed !== defaultTokens);

  const runAction = async (
    kind: "save" | "default" | "reset",
    action: () => Promise<void> | void,
  ) => {
    if (busy !== null) return;
    setBusy(kind);
    setError(null);
    try {
      await action();
      onClose();
    } catch (cause) {
      setError(describeApiError(cause, "Could not update compaction threshold."));
      setBusy(null);
    }
  };

  const handleSave = () => {
    if (parsed === null) {
      setError("Enter a token count (e.g. 160,000, 160k, or 80%).");
      return;
    }
    if (supportsThreadScope) {
      void runAction("save", () => onSaveThread(parsed === defaultTokens ? null : parsed));
    } else {
      void runAction("save", () => onSaveDefault(parsed));
    }
  };

  const handleSaveDefault = () => {
    if (parsed === null) {
      setError("Enter a token count (e.g. 160,000, 160k, or 80%).");
      return;
    }
    void runAction("default", () => onSaveDefault(parsed));
  };

  const handleReset = () => {
    if (supportsThreadScope) {
      void runAction("reset", () => onSaveThread(null));
    } else {
      void runAction("reset", () => onSaveDefault(defaultTokens));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
    >
      <DialogCloseButton />

      <div className="px-5 pt-5 pb-4">
        <Dialog.Title className="pr-7 text-title font-semibold tracking-[-0.01em] text-fg">
          {supportsThreadScope ? "Compact at (this thread)" : "Compact at"}
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-label text-fg-muted">
          {supportsThreadScope
            ? "Applies to this thread only."
            : "Applies to threads using this context window."}
        </Dialog.Description>

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={inputId} className="text-label text-fg-muted">
              Tokens
            </label>
            {pct !== null && (
              <span className="text-meta text-fg-faint tabular-nums">
                {pct}% of {formatTokens(windowTokens)}
              </span>
            )}
          </div>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error !== null) setError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            placeholder={formatExactTokens(defaultTokens)}
            aria-invalid={error !== null}
            className="mt-2 h-10 w-full rounded-row bg-canvas px-3 text-[0.9375rem] font-medium text-fg tabular-nums shadow-[inset_0_0_0_1px_var(--color-edge),0_0_0_1px_var(--color-edge-outline)] outline-none transition-shadow duration-(--dur-hover) placeholder:text-fg-faint focus:shadow-[inset_0_0_0_1px_var(--color-edge-strong),var(--shadow-focus)]"
          />
          <p className="mt-2.5 text-meta text-fg-muted tabular-nums">
            Default is {formatExactTokens(defaultTokens)}, up to {formatExactTokens(windowTokens)}{" "}
            tokens
          </p>
        </div>

        {error !== null && (
          <div className="mt-3">
            <DialogAlert message={error} />
          </div>
        )}
      </div>

      <DialogFooter>
        <button
          type="button"
          disabled={!canReset || busy !== null}
          onClick={handleReset}
          className="mr-auto cursor-pointer rounded-chip px-1 py-1 text-label text-fg-muted outline-none transition-colors duration-(--dur-hover) hover:text-fg focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40"
        >
          Reset to default
        </button>

        <Button
          type="button"
          variant="ghost"
          size="dialog"
          disabled={busy !== null}
          onClick={onClose}
        >
          Cancel
        </Button>

        {supportsThreadScope && (
          <Button
            type="button"
            variant="secondary"
            size="dialog"
            disabled={!valid || busy !== null}
            onClick={handleSaveDefault}
          >
            {busy === "default" && <DotSpinner variant="working" label="Saving default" />}
            Save as my default
          </Button>
        )}

        <Button
          type="submit"
          variant="primary"
          size="dialog"
          disabled={!valid || busy !== null}
          className="px-3.5"
        >
          {busy === "save" && <DotSpinner variant="working" label="Saving" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CompactAtDialog({ open, onOpenChange, ...props }: CompactAtDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={inputRef}
      className="top-[20vh] w-[min(28.75rem,calc(100vw-2rem))]"
    >
      <CompactAtForm {...props} inputRef={inputRef} onClose={() => onOpenChange(false)} />
    </DialogShell>
  );
}

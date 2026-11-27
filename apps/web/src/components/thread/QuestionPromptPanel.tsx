import { ArrowLeft01Icon, ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { describeApiError } from "@scuttle/client-runtime";
import type { ApprovalOption, PendingApproval, RespondApprovalInput } from "@scuttle/contracts";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Icon } from "@/components/ui/Icon.tsx";
import { easeOut } from "@/lib/motion.ts";
import { cn } from "@/lib/utils";
import {
  buildRespondInput,
  canSubmitFlow,
  createFlow,
  draftAt,
  goToStep,
  isQuestionAnswered,
  nextUnansweredStep,
  normalizeApprovalQuestions,
  setCustomAnswer,
  toggleOption,
  updateDraft,
} from "./questionModel.ts";

const ADVANCE_DELAY_MS = 140;

export type QuestionKeyAction =
  | { readonly kind: "pick"; readonly index: number }
  | { readonly kind: "step"; readonly delta: 1 | -1 }
  | { readonly kind: "advance" }
  | { readonly kind: "dismiss" };

type KeyFlag = "repeat" | "modified" | "composing" | "editable" | "interactive" | "foreign";
export type QuestionKeyInput = { readonly key: string } & Readonly<Record<KeyFlag, boolean>>;

export const questionKeyAction = (input: QuestionKeyInput): QuestionKeyAction | null => {
  if (input.composing || input.editable || input.foreign || input.modified) return null;
  if (input.key === "Escape") return { kind: "dismiss" };
  if (input.key === "Enter") return input.interactive ? null : { kind: "advance" };
  if (input.key === "ArrowLeft") return { kind: "step", delta: -1 };
  if (input.key === "ArrowRight") return { kind: "step", delta: 1 };
  if (!input.repeat && /^[1-9]$/.test(input.key))
    return { kind: "pick", index: Number(input.key) - 1 };
  return null;
};

const OVERLAY = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox]";

const shouldClaimFocus = (active: Element | null): boolean => {
  if (!(active instanceof HTMLElement) || active === document.body) return true;
  if (active.closest(OVERLAY) !== null) return false;
  const typing = active.isContentEditable || active.closest("input,textarea,select") !== null;
  const text = active instanceof HTMLInputElement ? active.value : (active.textContent ?? "");
  return !typing || text.trim().length === 0;
};

const describeKeyEvent = (event: KeyboardEvent, root: HTMLElement | null): QuestionKeyInput => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const overlay = target?.closest(OVERLAY);
  return {
    key: event.key,
    repeat: event.repeat,
    modified: event.ctrlKey || event.metaKey || event.altKey,
    composing: event.isComposing,
    editable:
      target !== null &&
      (target.isContentEditable || target.closest("input,textarea,select") !== null),
    interactive: target?.closest("button,a,[role=button]") != null,
    foreign: overlay != null && !(root?.contains(overlay) ?? false),
  };
};

function SelectionMark({
  multi,
  selected,
}: {
  readonly multi: boolean;
  readonly selected: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center ring-inset transition-[background-color,box-shadow] duration-(--dur-hover)",
        multi ? "rounded-[0.25rem]" : "rounded-full",
        !selected && "ring-1 ring-edge-strong",
        selected && (multi ? "bg-primary text-on-primary" : "ring-[1.5px] ring-primary"),
      )}
    >
      {selected &&
        (multi ? (
          <Icon icon={Tick02Icon} className="size-2.5" />
        ) : (
          <span className="size-1.5 rounded-full bg-primary" />
        ))}
    </span>
  );
}

function OptionRow({
  option,
  index,
  multi,
  selected,
  flashing,
  disabled,
  onPick,
}: {
  readonly option: ApprovalOption;
  readonly index: number;
  readonly multi: boolean;
  readonly selected: boolean;
  readonly flashing: boolean;
  readonly disabled: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 rounded-row px-2 py-1.5 text-left outline-none transition-[background-color,box-shadow] duration-(--dur-hover) focus-visible:shadow-focus disabled:cursor-default",
        selected ? "bg-primary/8 ring-1 ring-primary/35 ring-inset" : "hover:bg-hover",
        flashing && "bg-primary/16",
      )}
    >
      <span
        className={cn(
          "inline-flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-chip px-1 font-mono text-[0.6875rem] tabular-nums transition-colors duration-(--dur-hover)",
          selected ? "bg-primary/15 text-input" : "bg-fg/7 text-fg-muted",
        )}
      >
        {index < 9 ? index + 1 : "·"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label break-words text-fg">{option.label}</span>
        {option.description !== undefined && option.description.length > 0 && (
          <span className="mt-0.5 block text-meta break-words text-fg-muted">
            {option.description}
          </span>
        )}
      </span>
      <SelectionMark multi={multi} selected={selected} />
    </button>
  );
}

interface QuestionPromptPanelProps {
  readonly approval: PendingApproval | null;
  readonly returnFocusId: string;
  readonly onRespond: (approvalId: string, input: RespondApprovalInput) => Promise<void>;
}

function QuestionWizard({
  approval,
  returnFocusId,
  onRespond,
}: QuestionPromptPanelProps & { readonly approval: PendingApproval }) {
  const still = useReducedMotion() === true;
  const questions = normalizeApprovalQuestions(approval);
  const [flow, setFlow] = useState(() => createFlow(questions));
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusSubmitWhenReady = useRef(false);

  const step = flow.stepIndex;
  const question = questions[step];
  const draft = draftAt(flow, step);
  const total = questions.length;
  const isLast = step === total - 1;
  const ready = canSubmitFlow(questions, flow);
  const multi = question?.multiSelect === true;

  const cancelAdvance = () => {
    if (advanceTimer.current !== null) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    setFlash(null);
  };

  const respond = (input: RespondApprovalInput) => {
    if (busy) return;
    cancelAdvance();
    setBusy(true);
    setError(null);
    void onRespond(approval.id, input).then(
      () => {
        const active = document.activeElement;
        if (active === null || active === document.body || rootRef.current?.contains(active)) {
          document.getElementById(returnFocusId)?.focus({ preventScroll: true });
        }
      },
      (cause: unknown) => {
        setError(describeApiError(cause, "Could not send your answer."));
        setBusy(false);
      },
    );
  };

  const moveTo = (index: number) => {
    cancelAdvance();
    setFlow((prev) => goToStep(prev, index));
  };

  const submit = () => {
    if (ready) {
      respond(buildRespondInput(approval, questions, flow));
      return;
    }
    const missing = nextUnansweredStep(questions, { ...flow, stepIndex: -1 });
    if (missing !== null) moveTo(missing);
  };

  const pick = (index: number) => {
    const option = question?.options[index];
    if (question === undefined || option === undefined || busy) return;
    cancelAdvance();
    const picked = updateDraft(flow, step, (current) => toggleOption(question, current, option.id));
    setFlow(picked);
    if (question.multiSelect === true) return;
    if (nextUnansweredStep(questions, picked) === null) {
      focusSubmitWhenReady.current = true;
      return;
    }
    setFlash(option.id);
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      setFlash(null);
      setFlow((prev) => {
        const target = nextUnansweredStep(questions, prev);
        return target === null ? prev : goToStep(prev, target);
      });
    }, ADVANCE_DELAY_MS);
  };

  const advance = () => {
    if (isLast) submit();
    else moveTo(step + 1);
  };

  const run = (action: QuestionKeyAction) => {
    if (action.kind === "pick") pick(action.index);
    else if (action.kind === "step") moveTo(step + action.delta);
    else if (action.kind === "advance") advance();
    else respond({ dismissed: true });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || busy) return;
      const action = questionKeyAction(describeKeyEvent(event, rootRef.current));
      if (action === null) return;
      event.preventDefault();
      run(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (!ready || !focusSubmitWhenReady.current) return;
    focusSubmitWhenReady.current = false;
    submitRef.current?.focus({ preventScroll: true });
  }, [ready]);

  useEffect(() => {
    if (shouldClaimFocus(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (advanceTimer.current !== null) clearTimeout(advanceTimer.current);
    };
  }, []);

  if (question === undefined) return null;
  const allowCustom = question.allowCustom !== false;

  return (
    <div ref={rootRef} tabIndex={-1} className="outline-none">
      <header className="flex h-7 items-center gap-2 px-2">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-input" />
        <span className="shrink-0 text-meta font-medium text-fg-secondary">
          {total > 1 ? "Questions" : "Question"}
        </span>
        {question.header !== undefined && question.header !== question.question && (
          <span className="min-w-0 truncate rounded-chip bg-fg/7 px-1.5 py-px text-meta text-fg-secondary">
            {question.header}
          </span>
        )}
        <span className="flex-1" />
        {total > 1 && (
          <nav aria-label="Question steps" className="flex items-center gap-1">
            {questions.map((item, index) => {
              const answered = isQuestionAnswered(item, draftAt(flow, index));
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Question ${index + 1}${answered ? ", answered" : ""}`}
                  aria-current={index === step ? "step" : undefined}
                  onClick={() => moveTo(index)}
                  className={cn(
                    "inline-flex size-4 cursor-pointer items-center justify-center rounded-full outline-none transition-colors duration-(--dur-hover) focus-visible:shadow-focus",
                    index === step ? "bg-primary/15 text-input" : "text-fg-muted hover:bg-hover",
                  )}
                >
                  {answered ? (
                    <Icon icon={Tick02Icon} className="size-2.5" />
                  ) : (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        index === step ? "bg-input" : "bg-fg/25",
                      )}
                    />
                  )}
                </button>
              );
            })}
            <span className="ml-1 font-mono text-[0.6875rem] text-fg-muted tabular-nums">
              {step + 1} / {total}
            </span>
          </nav>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => respond({ dismissed: true })}
        >
          Skip
          <kbd className="font-mono text-[0.6875rem] text-fg-faint">Esc</kbd>
        </Button>
      </header>

      <motion.div
        key={question.id}
        initial={still ? false : { opacity: 0, x: 6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.14, ease: easeOut }}
        className="px-2 pt-1.5"
      >
        <p className="text-body font-medium break-words text-fg">{question.question}</p>
        {multi && <p className="mt-0.5 text-meta text-fg-muted">Select all that apply</p>}
        <div
          role={multi ? "group" : "radiogroup"}
          aria-label={question.question}
          className="scrollbar-none -mx-0.5 mt-2 flex max-h-64 flex-col gap-px overflow-y-auto px-0.5 py-0.5"
        >
          {question.options.map((option, index) => (
            <OptionRow
              key={option.id}
              option={option}
              index={index}
              multi={multi}
              selected={draft.selected.includes(option.id)}
              flashing={flash === option.id}
              disabled={busy}
              onPick={() => pick(index)}
            />
          ))}
        </div>
        {allowCustom && (
          <input
            type="text"
            value={draft.customText}
            disabled={busy}
            aria-label="Custom answer"
            placeholder={
              question.options.length > 0 ? "Type a custom answer…" : "Type your answer…"
            }
            onChange={(event) => {
              const text = event.target.value;
              cancelAdvance();
              setFlow((prev) =>
                updateDraft(prev, step, (current) => setCustomAnswer(question, current, text)),
              );
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) submit();
                else advance();
              } else if (event.key === "Escape") {
                event.preventDefault();
                rootRef.current?.focus({ preventScroll: true });
              }
            }}
            className={cn(
              "mt-1.5 h-8 w-full rounded-row bg-transparent px-2.5 text-label text-fg outline-none transition-shadow duration-(--dur-hover) placeholder:text-fg-muted focus:shadow-focus disabled:opacity-60",
              draft.usingCustom
                ? "bg-primary/8 ring-1 ring-primary/35 ring-inset"
                : "ring-1 ring-edge ring-inset",
            )}
          />
        )}
      </motion.div>

      <footer className="mt-2 flex items-center gap-1 px-1">
        {total > 1 &&
          ([-1, 1] as const).map((delta) => (
            <Button
              key={delta}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={delta < 0 ? "Previous question" : "Next question"}
              disabled={delta < 0 ? step === 0 : isLast}
              onClick={() => moveTo(step + delta)}
            >
              <Icon icon={delta < 0 ? ArrowLeft01Icon : ArrowRight01Icon} />
            </Button>
          ))}
        {error !== null ? (
          <span role="alert" className="min-w-0 flex-1 truncate px-1 text-meta text-danger">
            {error}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 text-meta text-fg-faint [@media(hover:none)]:invisible">
            {`${multi ? "1-9 toggle" : "1-9 pick"} · Enter ${isLast ? "submit" : "next"} · Esc skip`}
          </span>
        )}
        <Button
          ref={submitRef}
          type="button"
          variant="primary"
          size="md"
          disabled={!ready || busy}
          onClick={submit}
        >
          {total > 1 ? "Send answers" : "Submit"}
        </Button>
      </footer>
    </div>
  );
}

export function QuestionPromptPanel({
  approval,
  returnFocusId,
  onRespond,
}: QuestionPromptPanelProps) {
  const still = useReducedMotion() === true;
  return (
    <AnimatePresence initial={false} mode="wait">
      {approval !== null && (
        <motion.section
          key={approval.id}
          aria-label="Question from the agent"
          initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.16, ease: easeOut }}
          className="mx-3 rounded-t-card bg-panel/95 px-1.5 pt-1.5 pb-2 shadow-raised backdrop-blur-sm"
        >
          <QuestionWizard approval={approval} returnFocusId={returnFocusId} onRespond={onRespond} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}

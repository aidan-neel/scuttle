import { describe, expect, test } from "bun:test";
import type { PendingApproval, ThreadTurn, UserInputQuestion } from "@scuttle/contracts";
import { ApprovalId, ProviderId, ThreadId, TurnId } from "@scuttle/shared/ids";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalCard } from "../../../src/components/thread/ApprovalCard.tsx";
import {
  QuestionPromptPanel,
  questionKeyAction,
  type QuestionKeyInput,
} from "../../../src/components/thread/QuestionPromptPanel.tsx";
import {
  buildRespondInput,
  buildSubmissionAnswers,
  canSubmitFlow,
  createFlow,
  draftAt,
  findPendingQuestion,
  formatResolvedSummary,
  goToStep,
  nextUnansweredStep,
  normalizeApprovalQuestions,
  type QuestionFlow,
  setCustomAnswer,
  toggleOption,
  updateDraft,
} from "../../../src/components/thread/questionModel.ts";
import { ResolvedQuestionCard } from "../../../src/components/thread/ResolvedQuestionCard.tsx";

const AT = "2026-11-27T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

const AUTH: UserInputQuestion = {
  id: "auth",
  header: "Auth",
  question: "Which auth provider?",
  options: [
    { id: "oauth", label: "OAuth", description: "Sign in with GitHub" },
    { id: "magic", label: "Magic link" },
  ],
};
const FEATURES: UserInputQuestion = {
  id: "features",
  header: "Features",
  question: "Which features ship first?",
  options: [
    { id: "search", label: "Search" },
    { id: "export", label: "Export" },
    { id: "sync", label: "Sync" },
  ],
  multiSelect: true,
};
const DB: UserInputQuestion = {
  id: "db",
  question: "Which database?",
  options: [{ id: "sqlite", label: "SQLite" }],
  allowCustom: false,
};
const QUESTIONS = [AUTH, FEATURES, DB];

const approval = (extra: Partial<PendingApproval> = {}): PendingApproval => ({
  id: ApprovalId.make("approval-1"),
  threadId: THREAD_ID,
  turnId: TURN_ID,
  kind: "question",
  title: "Codex needs your input",
  description: "Pick a deploy target",
  options: [
    { id: "fly", label: "Fly.io" },
    { id: "render", label: "Render" },
  ],
  status: "pending",
  createdAt: AT,
  ...extra,
});

const structured = (extra: Partial<PendingApproval> = {}) =>
  approval({ questions: QUESTIONS, options: [], ...extra });

const turn = (approvals: ReadonlyArray<PendingApproval>, id = "turn-1"): ThreadTurn => ({
  id: TurnId.make(id),
  threadId: THREAD_ID,
  userMessage: "Set it up",
  assistantMessage: "",
  thinkingText: "",
  status: "running",
  startedAt: AT,
  modelSelection: { providerId: ProviderId.make("codex"), providerKind: "codex", model: "gpt" },
  activities: [],
  approvals,
});

const pick = (flow: QuestionFlow, index: number, optionId: string): QuestionFlow => {
  const question = QUESTIONS[index];
  if (question === undefined) throw new Error(`No question at ${index}`);
  return updateDraft(flow, index, (draft) => toggleOption(question, draft, optionId));
};

const type = (flow: QuestionFlow, index: number, text: string): QuestionFlow => {
  const question = QUESTIONS[index];
  if (question === undefined) throw new Error(`No question at ${index}`);
  return updateDraft(flow, index, (draft) => setCustomAnswer(question, draft, text));
};

const key = (overrides: Partial<QuestionKeyInput> & { key: string }): QuestionKeyInput => ({
  repeat: false,
  modified: false,
  composing: false,
  editable: false,
  interactive: false,
  foreign: false,
  ...overrides,
});

const noopRespond = async () => undefined;

describe("normalizeApprovalQuestions", () => {
  test("synthesizes one custom-friendly question from a legacy question approval", () => {
    expect(normalizeApprovalQuestions(approval())).toEqual([
      {
        id: "answer",
        header: "Codex needs your input",
        question: "Pick a deploy target",
        options: approval().options,
        allowCustom: true,
      },
    ]);
  });

  test("falls back to the title when a legacy description is blank", () => {
    const [question] = normalizeApprovalQuestions({
      ...approval(),
      description: "  ",
    });
    expect(question?.question).toBe("Codex needs your input");
  });

  test("returns structured questions as given", () => {
    expect(normalizeApprovalQuestions(structured())).toEqual(QUESTIONS);
  });

  test("returns nothing for a permission approval", () => {
    expect(normalizeApprovalQuestions(approval({ kind: "permission" }))).toEqual([]);
  });
});

describe("findPendingQuestion", () => {
  test("returns the newest pending question and ignores permissions and resolved ones", () => {
    const old = approval({ id: ApprovalId.make("old") });
    const permission = approval({ id: ApprovalId.make("perm"), kind: "permission" });
    const resolved = approval({ id: ApprovalId.make("done"), status: "resolved" });
    const found = findPendingQuestion([turn([old]), turn([permission, resolved], "turn-2")]);
    expect(found?.id).toBe(ApprovalId.make("old"));
    expect(findPendingQuestion([turn([permission, resolved])])).toBeNull();
  });

  test("ignores a pending question left on a turn that is no longer running", () => {
    const stale: ThreadTurn = { ...turn([approval()]), status: "interrupted" };
    expect(findPendingQuestion([stale])).toBeNull();
  });
});

describe("question flow", () => {
  test("single-select replaces the choice and multi-select toggles in option order", () => {
    let flow = pick(createFlow(QUESTIONS), 0, "oauth");
    flow = pick(flow, 0, "magic");
    expect(draftAt(flow, 0).selected).toEqual(["magic"]);
    flow = pick(flow, 1, "sync");
    flow = pick(flow, 1, "search");
    flow = pick(flow, 1, "export");
    flow = pick(flow, 1, "export");
    expect(draftAt(flow, 1).selected).toEqual(["search", "sync"]);
  });

  test("custom text overrides a single-select pick and picking again clears custom", () => {
    let flow = type(pick(createFlow(QUESTIONS), 0, "oauth"), 0, "  Passkeys ");
    expect(draftAt(flow, 0)).toEqual({
      selected: [],
      customText: "  Passkeys ",
      usingCustom: true,
    });
    flow = pick(flow, 0, "magic");
    expect(draftAt(flow, 0).usingCustom).toBe(false);
    expect(buildSubmissionAnswers(QUESTIONS, flow.drafts).auth).toBe("magic");
  });

  test("submission is blocked until every question has an answer", () => {
    let flow = pick(createFlow(QUESTIONS), 0, "oauth");
    expect(canSubmitFlow(QUESTIONS, flow)).toBe(false);
    expect(nextUnansweredStep(QUESTIONS, flow)).toBe(1);
    flow = type(flow, 1, "   ");
    expect(canSubmitFlow(QUESTIONS, flow)).toBe(false);
    flow = pick(flow, 1, "search");
    expect(nextUnansweredStep(QUESTIONS, goToStep(flow, 1))).toBe(2);
    flow = pick(flow, 2, "sqlite");
    expect(canSubmitFlow(QUESTIONS, flow)).toBe(true);
    expect(nextUnansweredStep(QUESTIONS, flow)).toBeNull();
  });

  test("unanswered search wraps to earlier steps", () => {
    const flow = goToStep(pick(pick(createFlow(QUESTIONS), 1, "sync"), 2, "sqlite"), 2);
    expect(nextUnansweredStep(QUESTIONS, flow)).toBe(0);
  });

  test("steps clamp to the question range and keep answers", () => {
    const flow = pick(createFlow(QUESTIONS), 0, "oauth");
    expect(goToStep(flow, 9).stepIndex).toBe(2);
    expect(goToStep(flow, -3).stepIndex).toBe(0);
    expect(draftAt(goToStep(goToStep(flow, 2), 0), 0).selected).toEqual(["oauth"]);
  });

  test("answers use strings for single-select and arrays with appended custom text for multi", () => {
    let flow = type(createFlow(QUESTIONS), 0, "Passkeys");
    flow = type(pick(flow, 1, "export"), 1, " Offline mode ");
    flow = pick(flow, 2, "sqlite");
    expect(buildSubmissionAnswers(QUESTIONS, flow.drafts)).toEqual({
      auth: "Passkeys",
      features: ["export", "Offline mode"],
      db: "sqlite",
    });
  });

  test("custom text is ignored when a question disallows it", () => {
    const flow = updateDraft(createFlow(QUESTIONS), 2, (draft) =>
      setCustomAnswer(DB, draft, "Postgres"),
    );
    expect(buildSubmissionAnswers(QUESTIONS, flow.drafts)).toEqual({});
  });
});

describe("buildRespondInput", () => {
  test("legacy approvals also send optionId and customText for older servers", () => {
    const legacy = approval();
    const [question] = normalizeApprovalQuestions(legacy);
    if (question === undefined) throw new Error("expected a legacy question");
    const flow = updateDraft(createFlow([question]), 0, (draft) =>
      setCustomAnswer(question, draft, "Railway"),
    );
    expect(buildRespondInput(legacy, [question], flow)).toEqual({
      answers: { answer: "Railway" },
      optionId: "Railway",
      customText: "Railway",
    });
  });

  test("structured approvals send answers only", () => {
    const flow = pick(pick(pick(createFlow(QUESTIONS), 0, "oauth"), 1, "sync"), 2, "sqlite");
    expect(buildRespondInput(structured(), QUESTIONS, flow)).toEqual({
      answers: { auth: "oauth", features: ["sync"], db: "sqlite" },
    });
  });
});

describe("formatResolvedSummary", () => {
  test("maps option ids to labels and flags custom answers", () => {
    const summary = formatResolvedSummary(
      structured({
        status: "resolved",
        answers: { auth: "oauth", features: ["search", "Offline mode"] },
      }),
    );
    expect(summary.kind).toBe("answered");
    expect(summary.items).toEqual([
      {
        id: "auth",
        header: "Auth",
        question: "Which auth provider?",
        answers: [{ text: "OAuth", custom: false }],
      },
      {
        id: "features",
        header: "Features",
        question: "Which features ship first?",
        answers: [
          { text: "Search", custom: false },
          { text: "Offline mode", custom: true },
        ],
      },
      { id: "db", header: null, question: "Which database?", answers: [] },
    ]);
  });

  test("reads a legacy selectedOptionId when no answers were recorded", () => {
    const summary = formatResolvedSummary(
      approval({ status: "resolved", selectedOptionId: "fly" }),
    );
    expect(summary.items[0]?.answers).toEqual([{ text: "Fly.io", custom: false }]);
  });

  test("is skipped only when dismissed", () => {
    expect(formatResolvedSummary(structured({ status: "resolved", dismissed: true })).kind).toBe(
      "skipped",
    );
    expect(formatResolvedSummary(structured({ status: "resolved" })).kind).toBe("answered");
  });
});

describe("questionKeyAction", () => {
  test("maps digits, arrows, Enter, and Esc outside editable fields", () => {
    expect(questionKeyAction(key({ key: "3" }))).toEqual({ kind: "pick", index: 2 });
    expect(questionKeyAction(key({ key: "ArrowLeft" }))).toEqual({ kind: "step", delta: -1 });
    expect(questionKeyAction(key({ key: "ArrowRight" }))).toEqual({ kind: "step", delta: 1 });
    expect(questionKeyAction(key({ key: "Enter" }))).toEqual({ kind: "advance" });
    expect(questionKeyAction(key({ key: "Escape" }))).toEqual({ kind: "dismiss" });
    expect(questionKeyAction(key({ key: "0" }))).toBeNull();
  });

  test("ignores typing, IME composition, modifiers, repeats, and other overlays", () => {
    expect(questionKeyAction(key({ key: "1", editable: true }))).toBeNull();
    expect(questionKeyAction(key({ key: "Escape", editable: true }))).toBeNull();
    expect(questionKeyAction(key({ key: "1", composing: true }))).toBeNull();
    expect(questionKeyAction(key({ key: "1", modified: true }))).toBeNull();
    expect(questionKeyAction(key({ key: "1", repeat: true }))).toBeNull();
    expect(questionKeyAction(key({ key: "Escape", foreign: true }))).toBeNull();
  });

  test("leaves Enter to a focused button but still picks digits there", () => {
    expect(questionKeyAction(key({ key: "Enter", interactive: true }))).toBeNull();
    expect(questionKeyAction(key({ key: "2", interactive: true }))).toEqual({
      kind: "pick",
      index: 1,
    });
  });
});

describe("rendering", () => {
  test("the docked panel shows the first question with numbered options and step progress", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionPromptPanel, {
        approval: structured(),
        returnFocusId: "composer",
        onRespond: noopRespond,
      }),
    );
    expect(html).toContain("Which auth provider?");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("1 / 3");
    expect(html).toContain("Send answers");
    expect(html).toContain("Type a custom answer");
    expect(html).not.toContain("Which features ship first?");
  });

  test("the docked panel renders nothing without a pending question", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionPromptPanel, {
        approval: null,
        returnFocusId: "composer",
        onRespond: noopRespond,
      }),
    );
    expect(html).toBe("");
  });

  test("the resolved card lists each question with its answers", () => {
    const html = renderToStaticMarkup(
      createElement(ResolvedQuestionCard, {
        approval: structured({ status: "resolved", answers: { auth: "magic", features: [] } }),
      }),
    );
    expect(html).toContain("Answered");
    expect(html).toContain("3 questions");
    expect(html).toContain("Magic link");
    expect(html).toContain("No answer recorded");
  });

  test("the timeline hides pending questions and shows resolved ones", () => {
    const render = (value: PendingApproval) =>
      renderToStaticMarkup(
        createElement(ApprovalCard, { approval: value, onRespond: noopRespond }),
      );
    expect(render(approval())).toBe("");
    expect(render(approval({ status: "resolved", dismissed: true }))).toContain("Skipped");
    expect(render(approval({ kind: "permission", title: "Run rm -rf build" }))).toContain(
      "Run rm -rf build",
    );
  });
});

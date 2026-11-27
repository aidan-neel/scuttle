import type {
  PendingApproval,
  RespondApprovalInput,
  ThreadTurn,
  UserInputAnswers,
  UserInputAnswerValue,
  UserInputQuestion,
} from "@scuttle/contracts";

export interface QuestionDraft {
  readonly selected: ReadonlyArray<string>;
  readonly customText: string;
  readonly usingCustom: boolean;
}

export interface QuestionFlow {
  readonly stepIndex: number;
  readonly drafts: ReadonlyArray<QuestionDraft>;
}

export interface ResolvedAnswer {
  readonly text: string;
  readonly custom: boolean;
}

export interface ResolvedQuestionItem {
  readonly id: string;
  readonly header: string | null;
  readonly question: string;
  readonly answers: ReadonlyArray<ResolvedAnswer>;
}

export interface ResolvedSummary {
  readonly kind: "answered" | "skipped";
  readonly items: ReadonlyArray<ResolvedQuestionItem>;
}

const EMPTY_DRAFT: QuestionDraft = { selected: [], customText: "", usingCustom: false };

export const LEGACY_QUESTION_ID = "answer";

export const isQuestionApproval = (approval: PendingApproval): boolean =>
  approval.kind === "question" || (approval.questions?.length ?? 0) > 0;

export const normalizeApprovalQuestions = (
  approval: PendingApproval,
): ReadonlyArray<UserInputQuestion> => {
  if (approval.questions !== undefined && approval.questions.length > 0) return approval.questions;
  if (approval.kind !== "question") return [];
  return [
    {
      id: LEGACY_QUESTION_ID,
      header: approval.title,
      question: approval.description?.trim() || approval.title,
      options: approval.options,
      allowCustom: true,
    },
  ];
};

export const findPendingQuestion = (turns: ReadonlyArray<ThreadTurn>): PendingApproval | null => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.status !== "running") continue;
    const match = turn.approvals.find(
      (approval) => approval.status === "pending" && isQuestionApproval(approval),
    );
    if (match !== undefined) return match;
  }
  return null;
};

export const createFlow = (questions: ReadonlyArray<UserInputQuestion>): QuestionFlow => ({
  stepIndex: 0,
  drafts: questions.map(() => EMPTY_DRAFT),
});

export const draftAt = (flow: QuestionFlow, index: number): QuestionDraft =>
  flow.drafts[index] ?? EMPTY_DRAFT;

export const updateDraft = (
  flow: QuestionFlow,
  index: number,
  next: (draft: QuestionDraft) => QuestionDraft,
): QuestionFlow => ({
  ...flow,
  drafts: flow.drafts.map((draft, at) => (at === index ? next(draft) : draft)),
});

export const goToStep = (flow: QuestionFlow, index: number): QuestionFlow => ({
  ...flow,
  stepIndex: Math.min(Math.max(index, 0), Math.max(flow.drafts.length - 1, 0)),
});

export const toggleOption = (
  question: UserInputQuestion,
  draft: QuestionDraft,
  optionId: string,
): QuestionDraft => {
  if (question.multiSelect !== true) {
    return { ...draft, selected: [optionId], usingCustom: false };
  }
  const chosen = new Set(draft.selected);
  if (chosen.has(optionId)) chosen.delete(optionId);
  else chosen.add(optionId);
  return {
    ...draft,
    selected: question.options.filter((option) => chosen.has(option.id)).map((o) => o.id),
  };
};

export const setCustomAnswer = (
  question: UserInputQuestion,
  draft: QuestionDraft,
  text: string,
): QuestionDraft => {
  const usingCustom = text.trim().length > 0;
  if (question.multiSelect === true) return { ...draft, customText: text, usingCustom };
  return {
    selected: usingCustom ? [] : draft.selected,
    customText: text,
    usingCustom,
  };
};

export const resolveQuestionAnswer = (
  question: UserInputQuestion,
  draft: QuestionDraft,
): UserInputAnswerValue | null => {
  const custom = question.allowCustom !== false && draft.usingCustom ? draft.customText.trim() : "";
  if (question.multiSelect === true) {
    const values = custom.length > 0 ? [...draft.selected, custom] : [...draft.selected];
    return values.length > 0 ? values : null;
  }
  if (custom.length > 0) return custom;
  return draft.selected[0] ?? null;
};

export const isQuestionAnswered = (question: UserInputQuestion, draft: QuestionDraft): boolean =>
  resolveQuestionAnswer(question, draft) !== null;

export const canSubmitFlow = (
  questions: ReadonlyArray<UserInputQuestion>,
  flow: QuestionFlow,
): boolean =>
  questions.length > 0 &&
  questions.every((question, index) => isQuestionAnswered(question, draftAt(flow, index)));

export const nextUnansweredStep = (
  questions: ReadonlyArray<UserInputQuestion>,
  flow: QuestionFlow,
): number | null => {
  for (let offset = 1; offset <= questions.length; offset += 1) {
    const index = (flow.stepIndex + offset) % questions.length;
    const question = questions[index];
    if (question !== undefined && !isQuestionAnswered(question, draftAt(flow, index))) return index;
  }
  return null;
};

export const buildSubmissionAnswers = (
  questions: ReadonlyArray<UserInputQuestion>,
  drafts: ReadonlyArray<QuestionDraft>,
): UserInputAnswers => {
  const answers: Record<string, UserInputAnswerValue> = {};
  questions.forEach((question, index) => {
    const value = resolveQuestionAnswer(question, drafts[index] ?? EMPTY_DRAFT);
    if (value !== null) answers[question.id] = value;
  });
  return answers;
};

export const buildRespondInput = (
  approval: PendingApproval,
  questions: ReadonlyArray<UserInputQuestion>,
  flow: QuestionFlow,
): RespondApprovalInput => {
  const answers = buildSubmissionAnswers(questions, flow.drafts);
  const legacy = approval.questions === undefined || approval.questions.length === 0;
  const value = answers[LEGACY_QUESTION_ID];
  if (!legacy || typeof value !== "string") return { answers };
  const draft = draftAt(flow, 0);
  return {
    answers,
    optionId: value,
    ...(draft.usingCustom ? { customText: value } : {}),
  };
};

const toAnswerList = (value: UserInputAnswerValue | undefined): ReadonlyArray<string> => {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
};

export const formatResolvedSummary = (approval: PendingApproval): ResolvedSummary => {
  const questions = normalizeApprovalQuestions(approval);
  const recorded: UserInputAnswers = approval.answers ?? {};
  const items = questions.map((question): ResolvedQuestionItem => {
    const fallback =
      question.id === LEGACY_QUESTION_ID && approval.selectedOptionId !== undefined
        ? approval.selectedOptionId
        : undefined;
    const values = toAnswerList(recorded[question.id] ?? fallback);
    return {
      id: question.id,
      header:
        question.header !== undefined && question.header !== question.question
          ? question.header
          : null,
      question: question.question,
      answers: values.map((text) => {
        const option = question.options.find((candidate) => candidate.id === text);
        return option ? { text: option.label, custom: false } : { text, custom: true };
      }),
    };
  });
  return { kind: approval.dismissed === true ? "skipped" : "answered", items };
};

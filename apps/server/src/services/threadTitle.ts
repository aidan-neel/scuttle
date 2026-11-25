const MAX_CHARS = 56;
const MAX_WORDS = 8;
const MIN_WORDS = 3;
const RECENT_TURNS = 3;

export interface TitleTurn {
  readonly userMessage: string;
  readonly assistantMessage: string;
}

const STOP_WORDS = new Set(
  (
    "a an the of to in on for with and or but at by from into as is are was were be been it its " +
    "this that these those them they we you i me my our your so if than then via about over do does " +
    "did done can could would should will just not no yes ok okay go ahead continue proceed"
  ).split(" "),
);

const WEAK_WORDS = new Set(
  (
    "try again retry didn't doesn't don't isn't wasn't won't work works worked looks look good " +
    "great perfect lgtm ship same still more another nope fine correct right wrong cool nice " +
    "awesome quick question how what why where when which who thing stuff something anything"
  ).split(" "),
);

const CODE_FENCE = /(```|~~~)[\s\S]*?(?:\1|$)/g;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const URL = /\b(?:https?|ftp|file):\/\/\S+|\bwww\.\S+/gi;
const INLINE_CODE = /`+([^`\n]*)`+/g;
const CODE_SYNTAX = /[=(){};<>]/;
const LINE_MARKERS = /^[ \t]*(?:#{1,6}|[-*+>]|\d+[.)])[ \t]+/gm;
const EMPHASIS = /[*~]+/g;
const FILLER =
  /(?<![\w'-])(?:hey|hi|hello|please|pls|kindly|also|just|thanks|thank you|can you|could you|would you|will you|i want you to|i want to|i need you to|i need to|i'd like you to|i'd like to|i would like to|make sure to|make sure that|go ahead and)(?![\w'-])/gi;
const LEADING =
  /^(?:(?:and|then|so|ok|okay|now|well|alright|yeah|yes|yep|sure|cool|great|nice|but|next|let's|lets)(?![\w'-])|[/$@][\w:-]+(?=\s|$)|[^\p{L}\p{N}])+/iu;
const ASSISTANT_LEADING =
  /^(?:(?:done|here's|here is|i've|i have|i'll|i will|i'm going to|i am|let me)(?![\w'-])|[^\p{L}\p{N}])+/iu;
const SEGMENT_BREAK = /[.!?;]+(?=\s|$)|\n+/;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const stripMarkup = (text: string): string =>
  text
    .replace(CODE_FENCE, " ")
    .replace(MARKDOWN_LINK, "$1")
    .replace(URL, " ")
    .replace(INLINE_CODE, (_, code: string) => (CODE_SYNTAX.test(code) ? " " : code))
    .replace(/`/g, "")
    .replace(/\u2019/g, "'")
    .replace(LINE_MARKERS, "")
    .replace(EMPHASIS, "");

const CLAUSE_JOIN = /,\s*(?:and|but|then|also|so|or|plus)(?![\w'-])/i;

const cutAtClauseJoin = (segment: string): string => {
  const at = segment.search(CLAUSE_JOIN);
  if (at < 0) return segment;
  const lead = segment.slice(0, at).replace(FILLER, " ").trim();
  return lead.split(/\s+/).length >= MIN_WORDS ? segment.slice(0, at) : segment;
};

const tokenize = (segment: string, assistant: boolean): ReadonlyArray<string> => {
  let text = cutAtClauseJoin(segment).replace(FILLER, " ").trim();
  text = text.replace(assistant ? ASSISTANT_LEADING : LEADING, "").trim();
  if (assistant) text = text.replace(LEADING, "").trim();
  return text
    .split(/\s+/)
    .map((token) => token.replace(EDGE_PUNCTUATION, "").slice(0, MAX_CHARS))
    .filter((token) => token.length > 0);
};

const isStopWord = (word: string): boolean => STOP_WORDS.has(word.toLowerCase());

const fitWords = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const picked: string[] = [];
  let length = 0;
  for (const word of words.slice(0, MAX_WORDS)) {
    const next = length + (picked.length > 0 ? 1 : 0) + word.length;
    if (next > MAX_CHARS) break;
    picked.push(word);
    length = next;
  }
  while (picked.length > 1 && isStopWord(picked[picked.length - 1] ?? "")) picked.pop();
  return picked;
};

interface Candidate {
  readonly title: string;
  readonly contentWords: number;
}

const toCandidate = (words: ReadonlyArray<string>): Candidate => {
  const picked = fitWords(words);
  const joined = picked.join(" ");
  return {
    title: joined.charAt(0).toUpperCase() + joined.slice(1),
    contentWords: picked.filter((word) => !isStopWord(word) && !WEAK_WORDS.has(word.toLowerCase()))
      .length,
  };
};

const candidateFrom = (text: string, assistant: boolean): Candidate => {
  const segments = stripMarkup(text)
    .split(SEGMENT_BREAK)
    .map((segment) => toCandidate(tokenize(segment, assistant)))
    .filter((candidate) => candidate.title.length > 0);
  const strong = segments.find((candidate) => candidate.contentWords >= 2);
  if (strong) return strong;
  return segments.reduce<Candidate>(
    (best, candidate) => (candidate.contentWords > best.contentWords ? candidate : best),
    segments[0] ?? { title: "", contentWords: 0 },
  );
};

export const shouldRefreshThreadTitle = (turnCount: number): boolean =>
  turnCount === 1 || (turnCount >= 3 && turnCount % 3 === 0);

export const deriveThreadTitle = (turns: ReadonlyArray<TitleTurn>): string => {
  const recent = turns.slice(-RECENT_TURNS).reverse();
  const latest = recent[0];
  if (!latest) return "";
  const candidates = [
    candidateFrom(latest.userMessage, false),
    candidateFrom(latest.assistantMessage, true),
    ...recent.slice(1).map((turn) => candidateFrom(turn.userMessage, false)),
  ];
  const best =
    candidates.find((candidate) => candidate.contentWords >= 2) ??
    candidates.find((candidate) => candidate.contentWords >= 1);
  return best?.title ?? "";
};

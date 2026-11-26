import type { TurnUsage } from "@scuttle/contracts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNonNegNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const asPositiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const extractClaudeModelContextWindow = (
  modelUsage: unknown,
  preferredModel?: string,
): number | undefined => {
  if (!isObject(modelUsage)) return undefined;
  const entries = Object.entries(modelUsage);
  const exact = preferredModel ? modelUsage[preferredModel] : undefined;
  const fuzzy =
    preferredModel && !isObject(exact)
      ? entries.find(([key]) => key.includes(preferredModel) || preferredModel.includes(key))?.[1]
      : undefined;
  const target = isObject(exact) ? exact : isObject(fuzzy) ? fuzzy : undefined;
  if (target) {
    const win = asPositiveNumber(target.contextWindow) ?? asPositiveNumber(target.context_window);
    if (win !== undefined) return win;
  }
  for (const [, value] of entries) {
    if (!isObject(value)) continue;
    const win = asPositiveNumber(value.contextWindow) ?? asPositiveNumber(value.context_window);
    if (win !== undefined) return win;
  }
  return undefined;
};

const parseClaudeUsageRecord = (
  record: Record<string, unknown>,
  contextWindowTokens?: number,
): TurnUsage | undefined => {
  const inputTokens = asNonNegNumber(record.input_tokens) ?? asNonNegNumber(record.inputTokens);
  const outputTokens = asNonNegNumber(record.output_tokens) ?? asNonNegNumber(record.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const cacheReadTokens =
    asNonNegNumber(record.cache_read_input_tokens) ?? asNonNegNumber(record.cacheReadTokens);
  const cacheCreationTokens =
    asNonNegNumber(record.cache_creation_input_tokens) ??
    asNonNegNumber(record.cacheCreationTokens);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheReadTokens !== undefined && cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined && cacheCreationTokens > 0
      ? { cacheCreationTokens }
      : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
  };
};

export const parseClaudeUsage = (
  parsed: Record<string, unknown>,
  preferredModel?: string,
): TurnUsage | undefined => {
  const contextWindowTokens = extractClaudeModelContextWindow(parsed.modelUsage, preferredModel);
  if (Array.isArray(parsed.iterations) && parsed.iterations.length > 0) {
    for (let idx = parsed.iterations.length - 1; idx >= 0; idx -= 1) {
      const entry = parsed.iterations[idx];
      if (!isObject(entry)) continue;
      const candidate = isObject(entry.usage) ? entry.usage : entry;
      const usage = parseClaudeUsageRecord(candidate, contextWindowTokens);
      if (usage) return usage;
    }
  }
  if (isObject(parsed.usage)) {
    return parseClaudeUsageRecord(parsed.usage, contextWindowTokens);
  }
  return undefined;
};

export const parseCodexTokenUsage = (params: Record<string, unknown>): TurnUsage | undefined => {
  const tokenUsage = isObject(params.tokenUsage) ? params.tokenUsage : params;
  const last = isObject(tokenUsage.last)
    ? tokenUsage.last
    : isObject(params.last)
      ? params.last
      : undefined;
  if (!last) return undefined;

  const rawInput = asNonNegNumber(last.inputTokens) ?? asNonNegNumber(last.input_tokens);
  const outputTokens = asNonNegNumber(last.outputTokens) ?? asNonNegNumber(last.output_tokens);
  if (rawInput === undefined && outputTokens === undefined) return undefined;

  const cacheReadTokens =
    asNonNegNumber(last.cachedInputTokens) ??
    asNonNegNumber(last.cached_input_tokens) ??
    asNonNegNumber(last.cacheReadTokens);
  const cacheCreationTokens =
    asNonNegNumber(last.cacheWriteInputTokens) ??
    asNonNegNumber(last.cache_write_input_tokens) ??
    asNonNegNumber(last.cacheCreationTokens);
  const totalTokens = asNonNegNumber(last.totalTokens) ?? asNonNegNumber(last.total_tokens);
  const contextWindowTokens =
    asPositiveNumber(tokenUsage.modelContextWindow) ??
    asPositiveNumber(params.modelContextWindow) ??
    asPositiveNumber(tokenUsage.contextWindowTokens) ??
    asPositiveNumber(params.contextWindowTokens);

  const isDisjoint =
    totalTokens !== undefined &&
    rawInput !== undefined &&
    outputTokens !== undefined &&
    cacheReadTokens !== undefined &&
    rawInput + cacheReadTokens + (cacheCreationTokens ?? 0) + outputTokens === totalTokens;

  const inputTokens =
    rawInput === undefined
      ? 0
      : isDisjoint
        ? rawInput
        : Math.max(0, rawInput - (cacheReadTokens ?? 0));

  return {
    inputTokens,
    outputTokens: outputTokens ?? 0,
    ...(cacheReadTokens !== undefined && cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined && cacheCreationTokens > 0
      ? { cacheCreationTokens }
      : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
  };
};

export const parseAcpUsage = (promptRes: Record<string, unknown>): TurnUsage | undefined => {
  const u = isObject(promptRes.usage) ? promptRes.usage : undefined;
  if (!u) return undefined;
  const inputTokens = asNonNegNumber(u.inputTokens) ?? asNonNegNumber(u.input_tokens);
  const outputTokens = asNonNegNumber(u.outputTokens) ?? asNonNegNumber(u.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const cacheReadTokens =
    asNonNegNumber(u.cachedReadTokens) ??
    asNonNegNumber(u.cacheReadTokens) ??
    asNonNegNumber(u.cache_read_input_tokens);
  const cacheCreationTokens =
    asNonNegNumber(u.cachedWriteTokens) ??
    asNonNegNumber(u.cacheCreationTokens) ??
    asNonNegNumber(u.cache_creation_input_tokens);
  const contextWindowTokens =
    asPositiveNumber(u.contextWindowTokens) ??
    asPositiveNumber(u.contextWindow) ??
    asPositiveNumber(promptRes.contextWindowTokens);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cacheReadTokens !== undefined && cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined && cacheCreationTokens > 0
      ? { cacheCreationTokens }
      : {}),
    ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
  };
};

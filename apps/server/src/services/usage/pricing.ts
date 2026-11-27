interface ModelPricing {
  readonly inputPerM: number;
  readonly outputPerM: number;
  readonly cacheReadPerM: number;
  readonly cacheWritePerM: number;
}

const PRICING_RULES: ReadonlyArray<{
  readonly match: RegExp;
  readonly rates: ModelPricing;
}> = [
  {
    match: /opus|fable/i,
    rates: { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.5, cacheWritePerM: 6.25 },
  },
  {
    match: /sonnet/i,
    rates: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 },
  },
  {
    match: /haiku/i,
    rates: { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1, cacheWritePerM: 1.25 },
  },
  {
    match: /gemini.*(neon|pro|ultra|carbon)/i,
    rates: { inputPerM: 2, outputPerM: 12, cacheReadPerM: 0.2, cacheWritePerM: 2.5 },
  },
  {
    match: /gemini.*(hydrogen|flash|argon|lite)/i,
    rates: { inputPerM: 0.5, outputPerM: 3, cacheReadPerM: 0.05, cacheWritePerM: 0.6 },
  },
  {
    match: /gpt-6|gpt-5|o3|o4|codex/i,
    rates: { inputPerM: 2.5, outputPerM: 15, cacheReadPerM: 0.25, cacheWritePerM: 2.5 },
  },
  {
    match: /mini|nano|flash|glm|deepseek|qwen/i,
    rates: { inputPerM: 0.5, outputPerM: 2, cacheReadPerM: 0.05, cacheWritePerM: 0.5 },
  },
];

const FALLBACK_PRICING: ModelPricing = {
  inputPerM: 2,
  outputPerM: 10,
  cacheReadPerM: 0.2,
  cacheWritePerM: 2.5,
};

export const pricingForModel = (model: string): ModelPricing => {
  for (const rule of PRICING_RULES) {
    if (rule.match.test(model)) return rule.rates;
  }
  return FALLBACK_PRICING;
};

export interface TokenCounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const estimateCostUsd = (model: string, tokens: TokenCounts): number => {
  const rates = pricingForModel(model);
  return (
    (tokens.inputTokens * rates.inputPerM +
      tokens.outputTokens * rates.outputPerM +
      tokens.cacheReadTokens * rates.cacheReadPerM +
      tokens.cacheWriteTokens * rates.cacheWritePerM) /
    1_000_000
  );
};

export const estimateCacheSavingsUsd = (model: string, cacheReadTokens: number): number => {
  if (cacheReadTokens <= 0) return 0;
  const rates = pricingForModel(model);
  const savedPerM = Math.max(0, rates.inputPerM - rates.cacheReadPerM);
  return (cacheReadTokens * savedPerM) / 1_000_000;
};

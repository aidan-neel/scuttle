import type { ProviderModel } from "@scuttle/contracts";

export const ALL_UPSTREAMS = "all";
export const UNPREFIXED_UPSTREAM = "";

export interface UpstreamGroup {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

const KNOWN_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "google-vertex": "Google Vertex",
  openrouter: "OpenRouter",
  xai: "xAI",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  groq: "Groq",
  meta: "Meta",
  "meta-llama": "Meta Llama",
  cohere: "Cohere",
  perplexity: "Perplexity",
  togetherai: "Together AI",
  fireworks: "Fireworks",
  "fireworks-ai": "Fireworks",
  cerebras: "Cerebras",
  "amazon-bedrock": "Amazon Bedrock",
  azure: "Azure",
  "github-copilot": "GitHub Copilot",
  "github-models": "GitHub Models",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  vercel: "Vercel",
  moonshotai: "Moonshot AI",
  zai: "Z.ai",
  "zai-coding-plan": "Z.ai Coding Plan",
  qwen: "Qwen",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  huggingface: "Hugging Face",
};

const UPPERCASE_WORDS = new Set(["ai", "llm", "api", "gpt", "lm"]);

export const upstreamOf = (slug: string): string => {
  const slash = slug.indexOf("/");
  return slash > 0 ? slug.slice(0, slash).toLowerCase() : UNPREFIXED_UPSTREAM;
};

export const upstreamLabel = (id: string): string => {
  if (id === UNPREFIXED_UPSTREAM) return "Other";
  const known = KNOWN_LABELS[id];
  if (known !== undefined) return known;
  return id
    .split(/[-_.]+/)
    .filter((word) => word.length > 0)
    .map((word) =>
      UPPERCASE_WORDS.has(word)
        ? word.toUpperCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
};

export const modelDisplayName = (model: ProviderModel): string => {
  const upstream = upstreamOf(model.slug);
  if (upstream === UNPREFIXED_UPSTREAM) return model.name;
  const prefix = `${upstream}/`;
  return model.name.toLowerCase().startsWith(prefix) ? model.name.slice(prefix.length) : model.name;
};

export const upstreamGroups = (
  models: ReadonlyArray<ProviderModel>,
): ReadonlyArray<UpstreamGroup> => {
  const counts = new Map<string, number>();
  for (const model of models) {
    const id = upstreamOf(model.slug);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [...counts]
    .map(([id, count]) => ({ id, label: upstreamLabel(id), count }))
    .sort((a, b) => {
      if (a.id === UNPREFIXED_UPSTREAM) return 1;
      if (b.id === UNPREFIXED_UPSTREAM) return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
};

export interface ModelFilter {
  readonly query: string;
  readonly upstream: string;
}

export const filterModels = (
  models: ReadonlyArray<ProviderModel>,
  { query, upstream }: ModelFilter,
): ReadonlyArray<ProviderModel> => {
  const q = query.trim().toLowerCase();
  return models.filter(
    (model) =>
      (upstream === ALL_UPSTREAMS || upstreamOf(model.slug) === upstream) &&
      (q.length === 0 ||
        model.name.toLowerCase().includes(q) ||
        model.slug.toLowerCase().includes(q) ||
        upstreamLabel(upstreamOf(model.slug)).toLowerCase().includes(q)),
  );
};

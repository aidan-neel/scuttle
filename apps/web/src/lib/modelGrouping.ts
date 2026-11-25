import type { ProviderKind, ProviderModel, ProviderSnapshot } from "@scuttle/contracts";
import { modelFavoriteKey } from "@/lib/modelFavorites.ts";

export interface Upstream {
  readonly label: string;
  readonly rank: number;
}

export interface ModelEntry {
  readonly key: string;
  readonly provider: ProviderSnapshot;
  readonly model: ProviderModel;
  readonly upstream: Upstream | null;
  readonly displayName: string;
}

export interface UpstreamGroup {
  readonly key: string;
  readonly upstream: Upstream;
  readonly entries: ReadonlyArray<ModelEntry>;
}

export type HarnessSection =
  | {
      readonly kind: "flat";
      readonly provider: ProviderSnapshot;
      readonly entries: ReadonlyArray<ModelEntry>;
    }
  | {
      readonly kind: "grouped";
      readonly provider: ProviderSnapshot;
      readonly loose: ReadonlyArray<ModelEntry>;
      readonly groups: ReadonlyArray<UpstreamGroup>;
    };

const KNOWN_UPSTREAMS: ReadonlyArray<readonly [string, string]> = [
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["google-vertex", "Google Vertex"],
  ["gemini", "Google"],
  ["xai", "xAI"],
  ["x-ai", "xAI"],
  ["deepseek", "DeepSeek"],
  ["meta", "Meta"],
  ["meta-llama", "Meta"],
  ["mistral", "Mistral"],
  ["mistralai", "Mistral"],
  ["qwen", "Qwen"],
  ["alibaba", "Alibaba"],
  ["moonshotai", "Moonshot"],
  ["moonshot", "Moonshot"],
  ["zai", "Z.ai"],
  ["z-ai", "Z.ai"],
  ["zai-coding-plan", "Z.ai Coding Plan"],
  ["zhipuai", "Zhipu"],
  ["minimax", "MiniMax"],
  ["cohere", "Cohere"],
  ["perplexity", "Perplexity"],
  ["openrouter", "OpenRouter"],
  ["opencode", "OpenCode"],
  ["opencode-go", "OpenCode Go"],
  ["github-copilot", "GitHub Copilot"],
  ["github-models", "GitHub Models"],
  ["amazon-bedrock", "Amazon Bedrock"],
  ["azure", "Azure"],
  ["groq", "Groq"],
  ["cerebras", "Cerebras"],
  ["together", "Together"],
  ["togetherai", "Together"],
  ["fireworks", "Fireworks"],
  ["fireworks-ai", "Fireworks"],
  ["deepinfra", "DeepInfra"],
  ["nvidia", "NVIDIA"],
  ["huggingface", "Hugging Face"],
  ["vercel", "Vercel"],
  ["ollama", "Ollama"],
  ["lmstudio", "LM Studio"],
];

const KNOWN_BY_ID = new Map<string, Upstream>();
const RANK_BY_LABEL = new Map<string, number>();
for (const [id, label] of KNOWN_UPSTREAMS) {
  const rank = RANK_BY_LABEL.get(label) ?? RANK_BY_LABEL.size;
  RANK_BY_LABEL.set(label, rank);
  KNOWN_BY_ID.set(id, { label, rank });
}

const UPPERCASE_WORDS = new Set(["ai", "api", "llm", "gpt", "lm"]);

function humanizePrefix(prefix: string): string {
  return prefix
    .split(/[-_.\s]+/)
    .filter((word) => word.length > 0)
    .map((word) =>
      UPPERCASE_WORDS.has(word.toLowerCase())
        ? word.toUpperCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function upstreamOf(slug: string): Upstream | null {
  const slash = slug.indexOf("/");
  if (slash <= 0 || slash === slug.length - 1) return null;
  const prefix = slug.slice(0, slash);
  return (
    KNOWN_BY_ID.get(prefix.toLowerCase()) ?? {
      label: humanizePrefix(prefix),
      rank: RANK_BY_LABEL.size,
    }
  );
}

const PREFIXED_NAME = /^([^/:]+?)\s*[/:]\s*(.+)$/;

export function displayModelName(model: ProviderModel, upstream: Upstream | null): string {
  if (!upstream) return model.name;
  const slugPrefix = normalize(model.slug.slice(0, model.slug.indexOf("/")));
  const match = PREFIXED_NAME.exec(model.name);
  const head = match?.[1];
  const rest = match?.[2];
  if (head === undefined || rest === undefined) return model.name;
  const normalizedHead = normalize(head);
  return normalizedHead === slugPrefix || normalizedHead === normalize(upstream.label)
    ? rest
    : model.name;
}

export function buildModelEntries(
  providers: ReadonlyArray<ProviderSnapshot>,
): ReadonlyArray<ModelEntry> {
  return providers.flatMap((provider) =>
    provider.models.map((model) => {
      const upstream = upstreamOf(model.slug);
      return {
        key: modelFavoriteKey(provider.id, model.slug),
        provider,
        model,
        upstream,
        displayName: displayModelName(model, upstream),
      };
    }),
  );
}

export function entryMatches(entry: ModelEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true;
  return (
    entry.displayName.toLowerCase().includes(normalizedQuery) ||
    entry.model.name.toLowerCase().includes(normalizedQuery) ||
    entry.model.slug.toLowerCase().includes(normalizedQuery) ||
    entry.provider.name.toLowerCase().includes(normalizedQuery) ||
    (entry.upstream?.label.toLowerCase().includes(normalizedQuery) ?? false)
  );
}

function compareUpstreams(a: Upstream, b: Upstream): number {
  return a.rank - b.rank || a.label.localeCompare(b.label);
}

export interface UpstreamCount {
  readonly upstream: Upstream;
  readonly count: number;
}

export function upstreamCounts(entries: ReadonlyArray<ModelEntry>): ReadonlyArray<UpstreamCount> {
  const counts = new Map<string, UpstreamCount>();
  for (const entry of entries) {
    if (!entry.upstream) continue;
    const prior = counts.get(entry.upstream.label);
    counts.set(entry.upstream.label, {
      upstream: prior?.upstream ?? entry.upstream,
      count: (prior?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].toSorted((a, b) => compareUpstreams(a.upstream, b.upstream));
}

export function buildHarnessSection(
  provider: ProviderSnapshot,
  providerEntries: ReadonlyArray<ModelEntry>,
  visible: ReadonlyArray<ModelEntry>,
): HarnessSection {
  if (upstreamCounts(providerEntries).length < 2) {
    return { kind: "flat", provider, entries: visible };
  }
  const groups = new Map<string, { upstream: Upstream; entries: ModelEntry[] }>();
  const loose: ModelEntry[] = [];
  for (const entry of visible) {
    if (!entry.upstream) {
      loose.push(entry);
      continue;
    }
    const group = groups.get(entry.upstream.label);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(entry.upstream.label, { upstream: entry.upstream, entries: [entry] });
    }
  }
  return {
    kind: "grouped",
    provider,
    loose,
    groups: [...groups.values()]
      .toSorted((a, b) => compareUpstreams(a.upstream, b.upstream))
      .map((group) => ({
        key: `${provider.id}:${group.upstream.label}`,
        upstream: group.upstream,
        entries: group.entries,
      })),
  };
}

export function sectionSize(section: HarnessSection): number {
  return section.kind === "flat"
    ? section.entries.length
    : section.loose.length +
        section.groups.reduce((total, group) => total + group.entries.length, 0);
}

export const ALL_FILTER = "all";

export interface ChipItem {
  readonly key: string;
  readonly label: string;
  readonly count?: number;
  readonly brand?: ProviderKind;
}

export interface PickerViewInput {
  readonly providers: ReadonlyArray<ProviderSnapshot>;
  readonly entries: ReadonlyArray<ModelEntry>;
  readonly favorites: ReadonlyArray<string>;
  readonly harnessFilter: string;
  readonly upstreamFilter: string;
  readonly normalizedQuery: string;
}

export function buildPickerView(input: PickerViewInput) {
  const { providers, entries, favorites, harnessFilter, upstreamFilter, normalizedQuery } = input;
  const focusedProvider = providers.find((provider) => provider.id === harnessFilter) ?? null;
  const entriesOf = (provider: ProviderSnapshot) =>
    entries.filter((entry) => entry.provider.id === provider.id);
  const focusedUpstreams = focusedProvider ? upstreamCounts(entriesOf(focusedProvider)) : [];
  const activeUpstream = focusedUpstreams.some((item) => item.upstream.label === upstreamFilter)
    ? upstreamFilter
    : ALL_FILTER;

  const passes = (entry: ModelEntry) =>
    (!focusedProvider || entry.provider.id === focusedProvider.id) &&
    (activeUpstream === ALL_FILTER || entry.upstream?.label === activeUpstream) &&
    entryMatches(entry, normalizedQuery);

  const sections = (focusedProvider ? [focusedProvider] : providers)
    .map((provider) => {
      const providerEntries = entriesOf(provider);
      return buildHarnessSection(provider, providerEntries, providerEntries.filter(passes));
    })
    .filter((section) => sectionSize(section) > 0);

  return {
    focusedProvider,
    focusedUpstreams,
    activeUpstream,
    favoriteEntries: entries.filter((entry) => favorites.includes(entry.key) && passes(entry)),
    sections,
    chips: {
      harness: [
        { key: ALL_FILTER, label: "All" },
        ...providers.map((provider) => ({
          key: provider.id,
          label: provider.name,
          brand: provider.kind,
        })),
      ],
      upstream: [
        {
          key: ALL_FILTER,
          label: "All",
          count: focusedUpstreams.reduce((sum, item) => sum + item.count, 0),
        },
        ...focusedUpstreams.map((item) => ({
          key: item.upstream.label,
          label: item.upstream.label,
          count: item.count,
        })),
      ],
    } satisfies Record<string, ReadonlyArray<ChipItem>>,
  };
}

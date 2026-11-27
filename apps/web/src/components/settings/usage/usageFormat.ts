import type { ProviderKind, UsageRange } from "@scuttle/contracts";

export const PROVIDER_META: Record<
  ProviderKind,
  { readonly label: string; readonly color: string }
> = {
  claude: { label: "Claude Code", color: "#d97757" },
  antigravity: { label: "Antigravity", color: "#8f7ef4" },
  codex: { label: "Codex", color: "#d8d8dc" },
  opencode: { label: "OpenCode", color: "#5cb8ff" },
  copilot: { label: "GitHub Copilot", color: "#4fc27a" },
  "acp-registry": { label: "ACP agent", color: "#c9a26b" },
};

export const RANGE_OPTIONS: ReadonlyArray<{ readonly value: UsageRange; readonly label: string }> =
  [
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "90d", label: "90d" },
  ];

export const formatTokens = (count: number): string => {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000_000) {
    const val = count / 1_000_000_000;
    return `${val >= 100 ? Math.round(val) : val >= 10 ? val.toFixed(1) : val.toFixed(2).replace(/\.00$/, "")}B`;
  }
  if (count >= 1_000_000) {
    const val = count / 1_000_000;
    return `${
      val >= 100
        ? Math.round(val)
        : val >= 10
          ? val.toFixed(1).replace(/\.0$/, "")
          : val
              .toFixed(2)
              .replace(/\.00$/, "")
              .replace(/(\.\d)0$/, "$1")
    }M`;
  }
  if (count >= 1_000) {
    const val = count / 1_000;
    return `${val >= 100 ? Math.round(val) : val >= 10 ? val.toFixed(1).replace(/\.0$/, "") : val.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return Math.round(count).toLocaleString();
};

export const formatAxisTokens = (count: number): string => {
  if (count <= 0) return "0";
  if (count >= 1_000_000_000) {
    const val = count / 1_000_000_000;
    return `${Number.isInteger(val) ? val : val.toFixed(2).replace(/0$/, "")}B`;
  }
  if (count >= 1_000_000) {
    const val = count / 1_000_000;
    return `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    const val = count / 1_000;
    return `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(Math.round(count));
};

export const formatUsd = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatShare = (share: number): string => {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const pct = share * 100;
  if (pct < 0.1) return "<0.1%";
  return `${pct >= 10 ? pct.toFixed(1) : pct.toFixed(1)}%`;
};

export const formatSessions = (count: number): string =>
  `${count.toLocaleString()} ${count === 1 ? "session" : "sessions"}`;

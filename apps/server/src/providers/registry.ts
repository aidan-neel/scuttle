import type { ProviderConfig, ProviderKind, ProviderSnapshot } from "@scuttle/contracts";
import type * as Effect from "effect/Effect";
import { createAcpAdapter } from "./acpAdapter.ts";
import { claudeAdapter } from "./claudeAdapter.ts";
import { codexAdapter } from "./codexAdapter.ts";
import type { HarnessAdapter } from "./types.ts";

type ProbeableAdapter = HarnessAdapter & {
  readonly probe: (
    config: ProviderConfig,
    options?: { readonly dataDir?: string },
  ) => Effect.Effect<ProviderSnapshot>;
};

const ADAPTERS: Record<ProviderKind, ProbeableAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: createAcpAdapter("antigravity"),
  opencode: createAcpAdapter("opencode"),
  copilot: createAcpAdapter("copilot"),
  "acp-registry": createAcpAdapter("acp-registry"),
};

export const getHarnessAdapter = (kind: ProviderKind): HarnessAdapter => ADAPTERS[kind];

export const probeHarnessAdapter = (
  config: ProviderConfig,
  options?: { readonly dataDir?: string },
): Effect.Effect<ProviderSnapshot> => ADAPTERS[config.kind].probe(config, options);

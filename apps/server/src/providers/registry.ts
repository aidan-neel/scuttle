import type { ProviderKind } from "@scuttle/contracts";
import { createAcpAdapter } from "./acpAdapter.ts";
import { claudeAdapter } from "./claudeAdapter.ts";
import { codexAdapter } from "./codexAdapter.ts";
import type { HarnessAdapter } from "./types.ts";

const ADAPTERS: Record<ProviderKind, HarnessAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  antigravity: createAcpAdapter("antigravity"),
  opencode: createAcpAdapter("opencode"),
  copilot: createAcpAdapter("copilot"),
};

export const getHarnessAdapter = (kind: ProviderKind): HarnessAdapter => ADAPTERS[kind];

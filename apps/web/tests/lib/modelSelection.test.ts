import { beforeEach, describe, expect, test } from "bun:test";
import type { ModelSelection, ProviderSnapshot } from "@scuttle/contracts";
import { ProviderId } from "@scuttle/shared/ids";
import { setModelDisabled } from "../../src/lib/disabledModels.ts";
import { modelFavoriteKey } from "../../src/lib/modelFavorites.ts";
import {
  pickBestSelection,
  readStoredSelection,
  writeStoredSelection,
} from "../../src/lib/modelSelection.ts";
import {
  createInitialWorkspaceState,
  reduceWorkspaceState,
} from "../../src/lib/workspaceReducer.ts";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

const makeProvider = (
  id: string,
  kind: ProviderSnapshot["kind"],
  status: ProviderSnapshot["status"],
  models: ProviderSnapshot["models"],
  enabled = true,
): ProviderSnapshot => ({
  id: ProviderId.make(id),
  kind,
  name: id,
  enabled,
  status,
  binaryPath: "",
  launchArgs: "",
  models,
  checkedAt: "2026-11-27T00:00:00.000Z",
});

const CLAUDE_READY = makeProvider("claude", "claude", "ready", [
  {
    slug: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    isDefault: true,
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
  },
]);

const CODEX_PROBING = makeProvider("codex", "codex", "probing", [
  {
    slug: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    isDefault: true,
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
  },
]);

const CODEX_READY = makeProvider("codex", "codex", "ready", [
  {
    slug: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    isDefault: true,
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
  },
  {
    slug: "gpt-6-astra",
    name: "GPT-6 Astra",
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
  },
]);

describe("default model selection persistence", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: {
          dispatchEvent: () => true,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        configurable: true,
        writable: true,
      });
    }
  });

  test("preserves stored default model while preferred provider is still probing and after it becomes ready", () => {
    const preferred: ModelSelection = {
      providerId: ProviderId.make("codex"),
      providerKind: "codex",
      model: "gpt-6-astra",
      effort: "xhigh",
    };
    writeStoredSelection(preferred);

    let state = createInitialWorkspaceState();
    expect(state.defaultModelSelection).toEqual(preferred);

    state = reduceWorkspaceState(state, {
      kind: "loaded",
      projects: [],
      threads: [],
      providers: [CLAUDE_READY, CODEX_PROBING],
      agents: [],
    });
    expect(state.defaultModelSelection).toEqual(preferred);

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "provider.updated", provider: CODEX_READY },
    });
    expect(state.defaultModelSelection).toEqual(preferred);
  });

  test("restores stored default model when preferred provider recovers from unavailable to ready", () => {
    const preferred: ModelSelection = {
      providerId: ProviderId.make("codex"),
      providerKind: "codex",
      model: "gpt-6-astra",
      effort: "high",
    };
    writeStoredSelection(preferred);

    let state = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "loaded",
      projects: [],
      threads: [],
      providers: [CLAUDE_READY, makeProvider("codex", "codex", "unavailable", [])],
      agents: [],
    });
    expect(state.defaultModelSelection.providerId).toBe(ProviderId.make("claude"));

    state = reduceWorkspaceState(state, {
      kind: "push",
      event: { kind: "provider.updated", provider: CODEX_READY },
    });
    expect(state.defaultModelSelection).toEqual(preferred);
  });

  test("reconcileModelSelection moves default away from a newly disabled model", () => {
    let state = reduceWorkspaceState(createInitialWorkspaceState(), {
      kind: "loaded",
      projects: [],
      threads: [],
      providers: [CLAUDE_READY, CODEX_READY],
      agents: [],
    });
    state = reduceWorkspaceState(state, {
      kind: "setModelSelection",
      selection: {
        providerId: ProviderId.make("codex"),
        providerKind: "codex",
        model: "gpt-6-astra",
        effort: "high",
      },
    });
    expect(state.defaultModelSelection.model).toBe("gpt-6-astra");

    setModelDisabled(modelFavoriteKey("codex", "gpt-6-astra"), true);
    state = reduceWorkspaceState(state, { kind: "reconcileModelSelection" });

    expect(state.defaultModelSelection.providerId).toBe(ProviderId.make("codex"));
    expect(state.defaultModelSelection.model).toBe("gpt-6.1-sol");
    expect(readStoredSelection()?.model).toBe("gpt-6.1-sol");
  });

  test("pickBestSelection does not keep a disabled probing model", () => {
    const preferred: ModelSelection = {
      providerId: ProviderId.make("codex"),
      providerKind: "codex",
      model: "gpt-6.1-sol",
      effort: "high",
    };
    setModelDisabled(modelFavoriteKey("codex", "gpt-6.1-sol"), true);

    const picked = pickBestSelection([CLAUDE_READY, CODEX_PROBING], preferred);
    expect(picked.providerId).toBe(ProviderId.make("claude"));
  });
});

---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers."
disable-model-invocation: true
---

# Migrate Callers Then Delete Legacy APIs

When a new internal API replaces an old one, move every caller and delete the old API in the same wave. A shim, a deprecated alias, or an adapter that keeps the old shape alive is a second API. Every reader has to learn both, and every later change has to keep both working. "Remove it later" rarely lands.

- **Find every caller first.** Search for the old name, its re-exports, string references, and dynamic lookups. That list is the scope of the wave.
- **Let the compiler find the rest.** Delete or rename the old API early, so the build lists every caller the search missed.
- **Migrate with a lever.** Past a handful of call sites, write the codemod or script (the **principle-build-the-lever** skill) and check each unit as it lands.
- **Delete everything the old API owned.** Its types, flags, config keys, docs, and examples go in the same PR or stack as the last caller's move.
- Update tests to assert the new contract, and delete tests that only protect pre-refactor implementation details.

**When this applies:**
- No external users depend on backward compatibility
- The project can absorb coordinated breaking changes
- The new API is part of a simplification or refactor initiative

When outside users depend on the old API, it is a public contract. Version it, deprecate it with a removal date, and keep the old path a thin call into the new one.

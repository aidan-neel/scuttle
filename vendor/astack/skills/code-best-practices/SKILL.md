---
name: code-best-practices
description: Language-neutral code rules for file length, duplication, and libraries over hand-rolled code. Use when writing or reviewing code in any language, when a file nears 500 lines, when about to write a helper that may already exist, or when choosing between a library and your own code.
---

# Code best practices

Apply the **principle-minimize-reader-load** and **principle-subtract-before-you-add** skills first. Then load the best-practices skill for the language: **typescript-best-practices**, **svelte-best-practices**, **python-best-practices**, **rust-best-practices**, or **golang-best-practices**.

| Rule | Summary |
|------|---------|
| Files under 500 lines | Tests, stylesheets, and components included. Generated files, lockfiles, fixtures, and data don't count. |
| Split by responsibility | `format/tokens.ts` and `format/tables.ts`, not `format-1.ts`. Split first in its own commit, then make the change. |
| Enforce it in CI | Copy [scripts/check-file-length.sh](scripts/check-file-length.sh) into the repository and run it from the check command. Never add a new entry to `.file-length-ignore`. |
| One home per rule | Search before writing a helper. The second copy becomes an extraction both callers use. |
| Usual offenders | Validation, parsing, formatting, permission checks, pricing, and constants. |
| Types from one source | Derive them from the schema, database, or protocol package. |
| Alike isn't duplicate | Code that changes for different reasons can stay separate. Duplicated rules can't. |
| Libraries over hand-rolled | Parsing, validation, HTTP and retries, auth, crypto, protocol SDKs, CLI args, accessible widgets, media. Record any deliberate hand-roll in `AGENTS.md`. |
| Choose packages on purpose | Maintained, widely used, license-compatible, small transitive cost. Reuse one the repository already has first. |

Details: [references/guide.md](references/guide.md).

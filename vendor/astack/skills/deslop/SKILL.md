---
name: deslop
description: Strip AI slop from a code diff before commit. Cuts defensive noise, swallowed errors, escape-hatch types, one-caller abstractions, narrating comments, leftovers, and style that doesn't match the file. Use before every commit, or when the user says "deslop", "clean up this diff", or "remove the slop".
---

# Deslop

Make the diff read as if the best engineer on this codebase wrote it by hand. Remove what an agent added that a careful human would not. Change nothing else.

The **unslop** skill cleans prose. This skill cleans code. The **no-comments** skill audits comments in depth before review, so here you cut only the obvious ones.

## Scope

Use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree. Touch only lines the diff adds or changes. Report slop that was already there, and leave it alone.

## Steps

1. **Read the neighbors first.** For each file in the diff, read the unchanged code around each hunk. Its naming, error handling, and structure are the standard. Needless comments go even when the neighbors have them.
2. **Scan every hunk for each pattern below.** Check them all, not a sample.
3. **Fix each hit with the smallest edit** that makes the code read like its neighbors. Before you remove a guard or a catch, prove it can't fire. Trace the caller, the type, or the schema that rules it out. If you can't prove it, keep it.
4. **Rerun the repository's checks** for the touched paths. A cleanup that breaks a test was not slop. Put it back.
5. **Report** what you removed, by pattern and count, and what you kept because you couldn't prove it safe.

## Patterns

| Pattern | What it looks like | Fix |
|---|---|---|
| Defensive noise | `try`/`catch` around code that can't throw. Null checks on values the type or a schema already guarantees. `?.` on required fields. Validation repeated inside the boundary. | Delete it. Trust validated input. |
| Swallowed errors | `catch {}`, a catch that only logs, a default returned on failure. | Let unexpected errors propagate. Handle expected errors by name, and make the expected case plain in code or in a focused test. |
| Escape-hatch types | `any`, `as unknown as T`, `# type: ignore`, `unwrap()` on input, `@ts-expect-error` with no reason. | Use the real type, or narrow it. |
| Speculative abstraction | A helper, interface, option, or flag with one caller and no second in sight. A factory around one constructor. | Inline it. |
| Duplicated logic | A new helper that does what an existing one does. | Call the existing one. |
| Narrating comments | `// increment the counter`, a docstring that restates the signature, a section banner. | Delete it. Keep only a reason the code can't show. |
| Leftovers | Debug prints, commented-out code, unused imports and variables, a `TODO` with no issue, scratch files. | Delete them. |
| Off-style code | Naming, quoting, or error style that differs from the file. A hand loop where the file calls a library. A new pattern where one is already established. | Match the file. |
| Over-logging | `info` or louder for routine steps. Any log of prompts, file contents, personal data, or credentials. | Remove it, or drop it to `debug` without the sensitive data. |
| Test slop | Tests that assert on mocks, snapshot everything, or sleep for timing. Names like `test 2`. | Assert on behavior, inject the clock, and name the behavior. |

## Don't

- Refactor, rename, or reformat code the diff didn't touch.
- Change behavior. A cleanup that would is not slop. Report it.
- Remove a guard or a catch you can't prove is dead.

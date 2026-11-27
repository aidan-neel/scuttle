---
name: codehygiene
description: Check the shape of code you just wrote with codehygiene, a small local readability model. It flags deep nesting, packed lines, long unbroken statement walls, duplicated blocks, equality ladders, and echoed or commented-out code in 20+ languages, then you fix the real hits. Use after tests pass on new or changed functions, before commit, or when the user says "codehygiene" or "check code hygiene". Not for whole-repository sweeps.
---

# codehygiene

Tests, typecheckers, and formatters check that code runs and is spelled right. They don't check its shape on the page. [codehygiene](https://github.com/brianbell-x/codehygiene) reads source as a grid of bytes and scores that shape. It ignores names, so it never argues about spelling.

## Run it

The script is [`scripts/codehygiene`](scripts/codehygiene) in this skill's folder. Pass it your touched files:

```sh
<this skill's folder>/scripts/codehygiene <touched-files> --check --no-color
```

It runs a pinned commit through `uvx`, so it needs uv and git. The first run fetches that commit from GitHub. Later runs use uv's cache and stay offline. Add `--json` for structured output, including each squiggle's `kind` and probability.

Under `--check`, a clean file prints nothing and exits 0. A flagged file exits 1 and prints its score, the flagged lines (`N!|`), and a `target:` silhouette that scores cleaner. In the silhouette, `■` is two bytes of code, brackets and `;:,=` are kept, indentation is half width, and `<-N` names the source lines a row came from. Read the target as a shape to aim for, not code to paste.

## Steps

1. **Prove behavior first.** Tests, typecheck, and lint pass before you run this.
2. **Scope to the diff.** Pass only files you created or substantially changed. On an existing file, pass `--json` and act only on lines you changed. Warn the user before any broader sweep.
3. **Fix real hits, at most 2 passes.** Use the fix in the table below and the target silhouette. Rerun codehygiene and the tests after each pass.
4. **Skip a hit** when the fix would change behavior, break a project lint rule, fight the language's idiom, or chop a clear line into awkward pieces. Say which you skipped and why.
5. **Report** the refactors codehygiene drove, in one short note.

| `kind` | Trigger | Fix |
|---|---|---|
| `deep_nesting` | 4+ indent steps inside a function | Early `return` or `continue` guards, or a flat helper |
| `dense_line` | Call chains, nested ternaries, `;`-packed or very wide lines | Name the intermediate values |
| `cramped_layout` | 20+ statements with no blank line, or ragged indentation | One blank line between setup, work, and return |
| `duplicate_block` | A 4+ line block copied or renamed nearby | One helper or a data-driven loop |
| `repetitive_structure` | 4+ `if x == literal` branches | A lookup table or dispatch map |
| `comment_echo` | A comment that repeats the next line, `// ...` elisions, commented-out code | Delete it. Keep comments that give a reason |

## Guardrails

- Run the tool. Don't guess a score from reading the code.
- Don't game the score: no crammed statements, padding blank lines, trivial helpers, or a `--threshold` above the default 0.55.
- codehygiene is an early preview and its false positives are expected. When the user dislikes a fix, restore their code. Offer to file an upstream issue with a minimal synthetic reproducer, and file it only if they agree.
- To move to a newer release, change the commit in the script and run the tests.

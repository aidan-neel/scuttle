# Code structure

Applies to every language. Stack-specific rules live in the **typescript-best-practices**, **svelte-best-practices**, **python-best-practices**, **rust-best-practices**, and **golang-best-practices** skills.

## File length

**No hand-written file over 500 lines.** That includes tests, stylesheets, and components. Long files mix responsibilities, take longer to review, and cost an agent context it needs for the actual change.

- Split by responsibility, not by line count. `format.ts` becomes `format/tokens.ts` and `format/tables.ts`, not `format-1.ts` and `format-2.ts`. Tests split along the same lines as the code they test.
- When a change would push a file past 500 lines, split it first, in a commit of its own, then make the change.
- Don't split an existing long file as a side effect of an unrelated change. Split it in its own PR, or when you next change it substantially.
- Generated files, lockfiles, fixtures, and data files don't count.

Enforce it in CI with [the file-length check](../scripts/check-file-length.sh). Copy it to the repository's `scripts/`, run it from the check command, and list generated files and grandfathered long files in `.file-length-ignore`. Remove a file from that list when it's split. Never add a new one.

## Duplication

**Each piece of logic has one home.** Two copies of a rule drift until they disagree, and then one of them is a bug.

- Before writing a helper, search for one (`rg -i '<what it does>'`) and read the repository's shared modules (`lib/`, `utils/`, `internal/`, `packages/*`).
- The second time you'd write the same logic, extract it and make both callers use it. Don't copy and adapt.
- Validation, parsing, formatting, permission checks, pricing, and constants (limits, URLs, error codes) are the usual offenders. Define each once and import it everywhere, across client and server too when they share a package.
- Types come from one source. Derive them from the schema (`z.infer`, Pydantic models), the database schema, or the protocol package. Don't redeclare them by hand.
- Code that looks alike but changes for different reasons isn't duplication. Two endpoints that share three lines today can stay separate. Duplicated *rules* can't.

## Libraries over hand-rolled code

Use a well-maintained library for anything with a long tail of edge cases: parsing (dates, URLs, CSV, YAML, Markdown), validation, HTTP clients and retries, auth, crypto, protocol SDKs, CLI argument parsing, accessible UI widgets, and image or media handling. A library thousands of projects use has already hit the bugs you would hit.

Hand-roll only small, well-understood code where a library would add more than it removes. Record each such choice in the repository's `AGENTS.md` with the reason.

## Choosing a package

Each runtime dependency is code you ship and attack surface you own.

- Reuse a package the repository already depends on before adding a second one for the same job.
- Check that it is maintained (recent releases, issues answered), widely used, and license-compatible.
- Look at what it pulls in. A large transitive tree for a small job is a reason to pick another package or write the small thing yourself.
- Add it with the ecosystem's package manager so the lockfile pins it, and say in the PR why it earns its place.

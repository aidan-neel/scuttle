# Engineering standards

These apply in every repository. A repository's own `AGENTS.md` or `CLAUDE.md` adds commands, layout, and invariants, and can tighten these rules. It loosens one only by naming the rule and the reason. On an unexplained conflict, follow these and point it out.

For rigorous work the user starts **go** (`/go` in Claude Code and Devin, `$go` in Codex, `@go` in OpenCode). It's hidden because it's costly, so suggest it once when a large task arrives without it. Phrases that start a skill: "council" runs **council**; "hillclimb" runs **hillclimb**; "full send" or "full stop" given as a command for a change runs **full-send** or **full-stop**, never the phrase in ordinary prose; "babysit" or "modernize" about a pull request runs **babysit-pr** or **modernize**.

## How to work

1. **Read before you write.** The repository's instructions, the code you change, and its callers. Match their naming, structure, error handling, and test style.
2. **Keep the change focused.** The smallest change that solves the task. Fix an existing problem only when it blocks verification or your change causes it, and list it. Report unrelated problems.
3. **Prove it works.** Run the repository's checks and fix what they report. Verify behavior where users meet it. Say exactly what you couldn't run.
4. **Report honestly.** What changed, what ran, what wasn't verified. A failing test is reported as failing, with its output.
5. **Stop at the irreversible.** Commit, branch, push your own branches, open PRs, and answer review threads without asking. Ask before force-pushing a shared branch, deploying, deleting data, or messaging anyone outside the work.

## Toolchains

For new projects. Migrate an existing one in its own PR.

- **Web**: TypeScript, Vite (SvelteKit for apps), Biome, Tailwind. No ESLint, Prettier, webpack, or hand-written `.js`.
- **Python**: uv for versions, environments, dependencies, and running. Ruff. Never `pip install` or `requirements.txt`.
- **Go**: small sandboxed services.
- **Rust**: native applications and libraries.

Each has a **\*-best-practices** skill.

## Code

- **Files stay under 500 lines**, tests included; generated files and lockfiles excepted. Split by responsibility.
- **One copy of each piece of logic.** Search for a helper before writing one.
- **Comments are rare**: only a reason the code can't show. Run **no-comments** before review.
- **Errors say what went wrong and how to fix it.** Handle expected errors; fix the cause of unexpected ones instead of hiding them.
- **Validate at the boundary** (config, environment, requests, tool input, model output) with a schema. Trust the typed result inside.
- **Read the environment once**, at startup, and pass values down.
- **Use maintained libraries** for parsing, protocols, crypto, auth, dates, validation, and accessible widgets. Justify each new runtime dependency in the PR.
- **Keep decisions pure**: routing, validation, pricing, and layout math map data to data. I/O stays at the edges.
- **No dead code or speculative abstraction.** Delete what you replace.
- **Never hand-edit generated files.** Change the source and regenerate.

## Tests

- Verify every behavior change. For a bug with a cheap local test, write one that fails first (**tdd**). When a test would need brittle mocks, use a reproducible script and say why.
- Unit tests never touch the network, real model APIs, or real config. Inject clients, clocks, and filesystems.
- Test databases against the real engine.
- Test names state the behavior and the condition.

## Security and privacy

- Never commit secrets, `.env` files, credentials, or real user data, and never put a secret in a log, prompt, brief, or chat.
- Don't log prompts, file contents, personal data, or credentials at `info` or above.
- Treat external input as hostile: confine paths, bound sizes and runtimes, allow-list.
- Check authorization and ownership on every access to user data.

## Git and pull requests

- Conventional Commits, imperative, no trailing period: `feat(router): add latency budget rule`.
- One logical change per PR. Finish local checks before pushing; every push runs CI.
- Docs, changelog, and config reference change with the behavior.
- Watch every PR you open until it lands or only a human step remains, fixing failures at their cause. Queue auto-merge when allowed, unless the playbook holds the merge for an independent verdict.
- Never approve your own PR, bypass branch protection, or merge with admin rights.

## Writing

Plain words, short sentences, specific claims (**technical-writing**, **unslop**). The **code-**, **testing-**, **security-**, and **git-best-practices** skills hold the details.

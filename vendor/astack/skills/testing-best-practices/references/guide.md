# Testing

## What every change needs

| Change | Test |
|---|---|
| Bug fix | A focused failing-before test when there is a clear, cheap local path. Otherwise the closest executable regression check. |
| New behavior | Tests for the normal path and each documented edge or error case |
| Pure decision logic (routing, validation, math) | Exhaustive unit tests, including which rule wins when several apply |
| Protocol or API change | A round-trip test through the real server and client |
| Database schema change | A test against the real database engine that exercises the new column or table |
| Generated artifact (JSON Schema, client code, auth schema) | A test that fails when the committed copy is stale |

## Rules

- **Hermetic by default.** Unit tests don't use the network, real model APIs, the user's home directory, or wall-clock time. Inject `fetch`, SDK clients, clocks, and file roots. Point the app's home or config directory at a temporary one the test creates.
- **Real databases.** Test against the engine production runs, in a container (a `compose.yaml` with a separate test database). Never a mock, and never a different engine standing in, such as SQLite for Postgres. Tests that need it skip with a clear message when the test database URL is unset, and wipe the database before each test, so never point them at real data.
- **Real protocols where cheap.** Run auth flows against a real local server (a mock OIDC provider, for example), not stubs of your own code.
- **Live tests are separate.** Anything that calls a real model or a paid third-party service lives in its own directory, runs behind an explicit flag or environment variable (`LIVE_TESTS=1`), prints what it spent, and runs on a schedule, not on every PR.
- **Colocated.** `foo.test.ts` next to `foo.ts`, `foo_test.go` next to `foo.go`, `test_foo.py` beside the module or in `tests/`, following the repository's layout.
- **Names describe behavior.** A failing test's name tells you what broke.
- **Assert on outcomes**, not on how many times an internal function was called.
- **No sleeps.** Wait on a condition or inject the clock. A flaky test gets fixed or deleted the day it flakes, not retried.

## Before you say you're done

Run the repository's full check command (the one its `AGENTS.md` or README names), not only the test file you touched. List the commands you ran and what you checked by hand in the PR's Verification section. "Tests pass" is not a list.

---
name: testing-best-practices
description: What every change must test and how tests are written. Use when writing, reviewing, or fixing tests, when a test is flaky, or when deciding what a change needs to prove before it is done.
---

# Testing best practices

Apply the **principle-test-behavior-not-implementation** and **principle-prove-it-works** skills first.

| Rule | Summary |
|------|---------|
| Bug fix | A focused failing-before test when there is a clear, cheap local path. Otherwise the closest executable regression check, and say why a new test was impractical. |
| New behavior | The normal path plus each documented edge and error case. |
| Pure decision logic | Exhaustive unit tests, including which rule wins when several apply. |
| Protocol or API change | A round trip through the real server and client. |
| Schema change | A test against the real database engine that uses the new column or table. |
| Generated artifact | A test that fails when the committed copy is stale. |
| Hermetic | No network, real model APIs, home directory, or wall clock in unit tests. Inject `fetch`, clients, clocks, and file roots. |
| Real databases | The engine production runs, in a container. Never a mock or a stand-in engine. Skip with a clear message when the test database URL is unset. |
| Live tests apart | Real models and paid services run behind an explicit flag, print what they spent, and run on a schedule, not on every PR. |
| Colocated, named for behavior | `foo.test.ts` beside `foo.ts`. A failing test's name says what broke. |
| Outcomes, not calls | Assert on results, not on how often an internal function ran. |
| No sleeps | Wait on a condition or inject the clock. Fix or delete a flaky test the day it flakes. |
| Full check before done | Run the repository's whole check command and list what you ran in the PR's Verification section. |

Details: [references/guide.md](references/guide.md).

---
name: hillclimb
description: Run a sustained, metric-driven measure, council-review, and fix loop (up to 10 rounds by default) against a frozen benchmark harness. Measures worst-case workloads (such as software rendering without hardware acceleration, high concurrency, or long histories), convenes the three-vendor council to diagnose bottlenecks and audit fixes, delegates scoped changes, keeps only verified wins that pass regressions, and reverts anything else. Trigger when the user runs /hillclimb, $hillclimb, or asks to hillclimb a measurable goal.
---

# Hillclimb

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Drive one or more measurable metrics (performance, memory, latency, throughput, accuracy, bundle size) across a full system through repeated **measure, council review, fix, re-measure, keep or revert** rounds, up to **10 rounds** by default.

This skill builds on [the Hillclimb playbook](../go/playbooks/hillclimb.md) and [the Council playbook](../go/playbooks/council.md). Never stack untested changes, never claim a win from reading code, and never weaken the harness to fake progress.

## 1. Set the checkout, surface, and round cap

1. Start on a clean branch or worktree off trunk with no unrelated changes.
2. Default cap: **10 rounds** (honor a different cap if the user names one).
3. Map every subsystem in scope (for example: client rendering, state and virtualization, network/IPC, server handlers, storage/queries) and list the realistic worst-case workloads the user cares about (for example: software rendering with hardware acceleration disabled, high concurrency, large item counts, long histories).
4. Agree on the target metrics, direction of improvement, and stop condition. Never stop after one easy win while major subsystems in scope remain unmeasured or unfixed.

## 2. Build and freeze the measurement harness

Follow [the Hillclimb playbook](../go/playbooks/hillclimb.md) steps 2 to 4 and the **benchmark-checklist** skill:

1. Create realistic stress fixtures that reproduce the actual pain (not toy empty datasets). For browser/Electron performance without hardware acceleration, drive the real app with GPU acceleration disabled (such as Chromium `--disable-gpu --use-gl=angle --use-angle=swiftshader`) alongside populated large-scale state.
2. Build one repeatable benchmark command that measures every workload in scope using the median of N runs (enough samples to clear noise) and prints structured numbers: primary latencies (p50/p95/p99), frame time / dropped frames / FPS where relevant, memory/CPU, work count, and error count.
3. Prove sensitivity: confirm the worst-case workload separates clearly from light workloads. If it cannot distinguish them, fix the harness before touching product code.
4. Freeze the harness. Do not edit it mid-run to make scores look better. Record the full baseline table and confirm the regression test suite is green.
5. Open a persistent `decision.tsv` via the **show-me-your-work** skill (stored in a gitignored path or under `~/.local/state/astack/hillclimb/<repo>/<slug>/decision.tsv`) with columns: `round`, `subsystem`, `hypothesis`, `source` (profile or council), `before`, `after`, `delta`, `tests`, `verdict` (`kept` or `reverted`), `commit`, `note`.

## 3. Run the loop (up to 10 rounds)

Run up to 10 rounds. Read `decision.tsv` before starting each round so you never retry a dead end.

1. **Profile and diagnose with the council.**
   - Capture profiler traces or hot-path breakdowns for the current slowest workload.
   - Convene a read-only three-vendor **council** pass per [the Council playbook](../go/playbooks/council.md) on **round 1** (after baseline), whenever switching subsystems, on any **plateau** (two reverted rounds in a row), and whenever the user asks for council involvement each round. Give all three council seats the exact frozen baseline/current metrics, profiler traces, `decision.tsv` history, and hot files in scope.
   - Ask the council to rank the highest-leverage root causes (for performance, ordered by the mantras in [the Perf issue playbook](../go/playbooks/perf-issue.md)), flag any correctness or regression risks in recent accepted commits, and propose concrete mechanism-level fixes.
   - Synthesize agreements across vendors first; verify any single-seat claim against the code and profiler before acting.
2. **Delegate scoped fix(es).**
   - Pick one mechanism-level hypothesis per lane ("virtualize message rows and remove per-row layout reads that force synchronous reflow on scroll", not "optimize rendering").
   - Hand each lane to a `go-worker` subagent on `medium` (use `large` for deep cross-module bottlenecks and `xlarge` when `large` stalls). When two or three hypotheses touch completely disjoint subsystems, fan them out in parallel worktrees and measure each one independently before combining.
3. **Re-measure and verify.**
   - Run the frozen measurement harness (full median-of-N suite across all tracked workloads, not just the one you targeted, so cross-workload regressions show up immediately).
   - Run the regression test suite and verify the real user surface (UI, CLI, or API) still behaves and renders accurately.
4. **Keep or revert.**
   - **Keep** only when the target metric improves past measurement noise, no other tracked workload regresses unacceptably, and every regression check passes. Commit only the files changed for that fix with a Conventional Commit that records the before and after numbers.
   - **Revert in full** when the metric does not clearly improve, another workload regresses, or correctness breaks. Never keep a speculative tweak that "might help".
   - Log every round in `decision.tsv`, kept or reverted.
5. **Push past plateaus and stop cleanly.**
   - After two reverts in a row, pivot to a different subsystem or bring the council back to propose a more structural change (algorithmic, caching, batching, incremental rendering, worker offloading) instead of micro-tuning.
   - Stop before round 10 only when every target is met with clear margin and a council pass finds no worthwhile bottleneck left, or when 3 consecutive rounds after a structural pivot produce no accepted win.

## 4. Final council sign-off and handoff

1. Run a final **council** review over the cumulative diff and the baseline-to-final benchmark table.
2. Fix any verified blocker or major correctness/regression finding the council raises, then re-run the frozen harness and regression tests to prove the gains still hold.
3. If the task targets a PR, follow **Opening a PR** with the stacked accepted commits, the baseline-to-final table, and the council review table.

**Reply:** the frozen harness command, baseline-to-final metric table across every workload with percent deltas, rounds run (kept vs. reverted), one-line summary of each accepted commit, council review scores and key findings resolved, the `decision.tsv` path, and the top unpursued next ideas.

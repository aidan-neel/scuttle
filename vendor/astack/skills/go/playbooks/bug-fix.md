### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix to subagents, and stay in the lead. Code delegates take `medium`, read-only exploring takes `nano`, and verification takes `small`.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Settle the checkout before any code change: a branch or a worktree off trunk, with no unrelated changes, per **Opening a PR** step 1.
2. Reproduce it yourself on the matching surface through the **control-ui** or **control-cli** skill, even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
3. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with a trace of the affected subsystem and the **why** skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, and eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. For a long or stubborn hunt, run it as a self-paced loop per the Autonomous run playbook, with the surviving mechanism as its exit condition. Confirm the surviving *mechanism* with runtime evidence before step 4's **architect** or an **interrogate** fan-out.
4. Plan the fix. If it crosses a function boundary, run the **architect** skill first. Delegate implementation to a `go-worker` subagent on `medium` with a specific scope.
5. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
6. Stage the commits so the failing repro lands before the fix in git history, per the **principle-sequence-verifiable-units** skill. When the bug has a cheap local test path, follow the **tdd** skill's failing-test-first cadence. Skip it when the test would be expensive, integration-heavy, or unclear.
7. Run **Opening a PR**.

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.

### Feature

**You own the design. Plan, review, verify.** Delegate implementation by default. Stay in the lead.

1. Settle the checkout before any code change: a branch or a worktree off trunk, with no unrelated changes, per **Opening a PR** step 1.
2. Trace the affected subsystem.
3. Run the **architect** skill for the shape.
4. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **principle-separate-before-serializing-shared-state** skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
5. Delegate code-writing to a `go-worker` subagent on `medium` with a specific scope: file paths, success criteria, and the named data shape and its organizing structure per the **principle-model-the-domain** skill (a state machine over scattered booleans, a table or registry over branching, a typed model over repeated shape assumptions), chosen before the delegate writes logic. Delegation is the default for a non-trivial change, because the gain is review separation, not lines saved. A small change, such as about 30 lines in one area with no open design choice, you may write yourself as the one writer. Say why in the reply. When the choice is consequential and the valid shapes really differ (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. A subagent forbidden to spawn owns the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
6. Change docs, the README, and the config reference in the same change as a new flag or behavior.
7. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
8. Rebase into small, ordered commits. Stack follow-ups.
   Build, verify, and commit each small unit before the next, per the **principle-sequence-verifiable-units** skill.
9. If the design is contested, run the **interrogate** skill before shipping.
10. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.

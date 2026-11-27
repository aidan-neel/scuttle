---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Track todos with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners from the `panel` size, per [Models](../go/references/harnesses/README.md#models). Run one runner on each entry. A missing `panel` line means two runners on your own model. If an entry won't run, follow the Models rule for a rejected model, keep at least two runners, and say so. A model's family is its vendor. When every runner comes from one vendor, say the panel was not diverse. Spawn more runners for multiple design directions, and repeat one entry when the work is generation-bound, not judgment-sensitive.
4. Give each candidate its own output location, per the **principle-separate-before-serializing-shared-state** skill. A candidate that writes code works in its own worktree. Anything else goes in its own folder at `~/.local/state/astack/arena/<slug>/candidate-<n>/`.

## Phase B: Fan out

Spawn all N as general-purpose subagents in one turn, in the background, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, spawn one read-only subagent as the judge. The judge is never from your own vendor, so use the first `panel` entry from another vendor. If you do not know your own model, use the first entry and say that the vendor check did not run. If that entry won't run, try the next one from another vendor. If none runs, or the line is missing, skip the judge and say so. While you read in Phase D, the judge scores each candidate, by path label, on each rubric criterion and recommends a base.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the **principle-laziness-protocol** skill.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **principle-redesign-from-first-principles** skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **principle-prove-it-works** skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.

---
name: no-comments
description: "Strip needless comments from a diff with the comment-auditor agent, fix the workarounds it flags, and offer checks that enforce any real constraint a comment claimed. Use before review, or when the user says \"no comments\" or \"audit the comments\"."
---

# No comments

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Spawn the `comment-auditor` agent and act on the findings you accept. It didn't write the comments, so defer to its fresh read.

## Scope

Use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree.

## Steps

1. **Spawn the auditor.** Spawn the `comment-auditor` agent as a subagent, the way your harness reference spawns a registered agent such as `go-worker`, on the `small` size. Pass it the scope. Its own definition holds its rules, so don't restate them. It edits comments only and never touches application code. If the harness has no `comment-auditor` agent registered, use the fallback the harness references give for a registered agent.
2. **Judge its report and its diff.**
   - Reject application-code edits, edits outside the scope, deletions of comments that an exception protects, `MUST KILL` flags with a misstated reason, and flags that treat intentional code you keep as a bug.
   - A flag that asks to reshape a surprise in our own code stays actionable. Don't restore its comment.
   - A keep survives only with proof that it is about something we cannot change.
   - Look for lint and TypeScript suppressions in scope that it missed. A suppression of a rule that guards correctness or safety stays an actionable `MUST KILL`.
   - Restore a deletion only with the exact exception and proof inside the scope.
   - Before you accept a thin `IMPORTANT` or `do not remove` kill or keep, trace its symbol or run the **why** skill on it. If a kill stays ambiguous, don't restore the comment. If a keep is refuted or stays ambiguous, delete the comment.
   - When you reject a report, revert its edits and rerun the auditor once, with the failure named. If you reject the second report too, report it open and fail this skill.
3. **Fix trivial flags directly.** Delete a dead path, drop a parameter, or call the real API. If any accepted fix needs a new shape, run the **architect** skill once for the accepted set and the code around it. Stop at its sketch. The architect shapes, and step 4 implements.
4. **Fix the root cause in scope.** Make the smallest root-cause fix and remove every named workaround. If the root cause is out of scope, land the smallest in-scope fix and report the rest open. The **principle-fix-root-causes** and **principle-redesign-from-first-principles** skills guide intent only. Neither lets you widen the scope or fix instances outside it. Never bolt on a symptom guard.
5. **Encode constraints.** A constraint comment says `do not remove`, `do not change wording`, or `talk to X before changing`. Leave keeps that are about things we cannot change. For the rest, offer the cheapest in-scope check that enforces the constraint: a type, a runtime check, a test, or a CI lint. Wait for approval in an interactive session. An unattended run or an eval needs the caller's approval up front. If approved, encode the constraint, then delete the comment. Otherwise delete the comment, report the constraint open, and sketch the out-of-scope work.
6. **Report** the deletion count, restored comments, reruns, the architect sketch, fixes, encoding offers, encodings, constraints left unenforced, and other open work.

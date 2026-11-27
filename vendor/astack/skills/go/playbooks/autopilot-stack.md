### Autopilot-stack

**You own the verdicts and the handoff. Run the Autopilot-full playbook, but merge nothing.**

1. **In place of step 5, stop at verified, and queue no auto-merge.** Stop when each PR is verified and green at its current head, then hand the PRs to the operator. After the handoff, nobody pushes without the operator's go. Every scheduled tick's prompt names this file, so each tick sees the no-merge rule.
2. **Stack a PR only when it builds on another PR.** This is the one exception to step 3. Base the PR on the other PR's branch in place of trunk, per `playbooks/opening-a-pr.md`. In place of step 2's rebase onto trunk, each PR rebases onto its parent PR's branch, and the stack root rebases onto trunk. A new head on the lower PR restacks the PRs above it, and a PR whose whole patch the restack leaves unchanged, compared as in step 3 of `playbooks/shipping.md`, keeps its verdict.

**Reply:** list each PR with its verdict and head SHA, in place of what merged, and name what the operator must do to land the stack.

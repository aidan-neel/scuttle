---
name: full-stop
description: The same as full-send, but stops when the PR is ready for the user to merge. It builds and proves one change, has verifiers that never wrote it review it, opens the PR, and babysits it through CI and review bots, with nobody watching. Use only when the user gives a change with "full stop" as a command, or runs /full-stop or $full-stop. Never for "full stop" as ordinary punctuation or emphasis.
---

# full-stop

Run the [full-send](../full-send/SKILL.md) skill with one change: the grant ends at merge-ready.

- The owner never merges, never queues auto-merge, and never asks the forge to merge later.
- Merge-ready means the swarm's verdict covers the current head, CI is green on it, and every review thread is fixed or answered.
- If anything moves the head after the verdict, re-verify per Autopilot-full step 4 before you call it ready.

**Reply:** the PR, the head SHA the verdict covers, CI and review state, what is left for the user, and the command that merges it pinned to that head: `gh pr merge <pr> --squash --match-head-commit <sha>` or `glab mr merge <mr> --squash --sha <sha> --yes`.

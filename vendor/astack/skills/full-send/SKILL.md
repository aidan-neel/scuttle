---
name: full-send
description: Takes one change all the way to a merged PR with nobody watching. It builds and proves the change, has verifiers that never wrote it review it, opens the PR, babysits it through CI and review bots, and merges it. Use only when the user says "full send" or runs /full-send or $full-send. Never for "ship it", "merge it", or other wording, because this merges code.
---

# full-send

Read the **go** skill ([../go/SKILL.md](../go/SKILL.md)) and follow it, with these settings in place of its routing.

- **Playbook:** [Autopilot-full](../go/playbooks/autopilot-full.md), with a queue of one: the change the user named. The user's message is the operator's go and the grant to merge that one PR, and nothing else.
- **Building it:** the owner builds the change per the playbook that fits it (Bug fix, Feature, Refactoring, Perf issue, Designing UI), then opens the PR per **Opening a PR**.
- **Nobody is watching.** This is an autonomous run. Don't ask questions. Settle a fork by prototyping it, and in Designing UI take your own variant pick.
- **Merging:** only the head the swarm's verdict covers, pinned to that SHA, per Autopilot-full step 5.
- **Still stop and ask** before anything the standards stop at: force-pushing a shared branch, deploying, deleting data, or messaging anyone outside the work. When the forge requires an approval you can't get, never bypass it. Stop at merge-ready and say whose approval it waits on.

**Reply:** per Autopilot-full: the PR, its verdict, the merged head SHA (or why it stopped), and parked follow-ups.

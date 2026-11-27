---
name: modernize
description: Rebases an old pull request onto current trunk and decides whether it should still exist (keep, rewrite, or close), with evidence. Use when the user says "modernize" about a PR, or runs /modernize or $modernize. Not for updating code to newer language features.
---

# modernize

Read the **go** skill ([../go/SKILL.md](../go/SKILL.md)) and run its [Modernize](../go/playbooks/modernize.md) playbook, without routing.

- The PR is the one the user names. With several, take them one at a time, oldest first.
- Rebasing, force-pushing, or closing a PR the user didn't write is a stop-and-ask.

**Reply:** per the Modernize playbook.

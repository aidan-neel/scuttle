---
name: babysit-pr
description: Watches a pull request through CI and review bots and fixes the real findings, until it is merge-ready or only a human step remains. Use when the user says "babysit" about a PR, or runs /babysit-pr or $babysit-pr.
---

# babysit-pr

Read the **go** skill ([../go/SKILL.md](../go/SKILL.md)) and run its [Babysit](../go/playbooks/babysit.md) playbook in `drive` mode, without routing.

- The PR is the one the user names, by number or link. With none named, take the PR for the current branch (`gh pr view --json number,url` or `glab mr view`), and ask when there is none.
- Babysitting never merges. Queue auto-merge only as the Babysit playbook allows.
- A conflict or a stale base is reported, not resolved. To rebase an old PR, use the **modernize** skill.

**Reply:** per the Babysit playbook.

### Opening a PR

**You own a PR a reviewer can read in a minute.** Every other playbook ends here.

1. Check the checkout before you commit. The work sits on its own branch or worktree, cleanly off trunk, with no unrelated changes. Coding playbooks settle this before the first code change. If you are still on trunk, branch off it now. With no remote or no trunk, as in a fresh repository, commit locally, stop before any push, and report that.
2. Run the **deslop** skill over the diff, then the **codehygiene** skill on the touched code files, then the **no-comments** skill. Rebase into small, landable commits.
3. Title the PR `type(scope): subject`, naming a real symbol when one carries the change.
4. Write the body per the **technical-writing** skill as a one-minute briefing under 40 lines, with these `##` headings in order and empty ones dropped: `## Why`, `## What changed`, `## Scope`, `## Tradeoffs` (only rejected alternatives a reviewer would otherwise ask about), `## Blast Radius`, `## Verification`. Put long evidence in a file or a PR comment and link it.
5. Stack follow-ups by base branch. Open the PR ready for review, never as a draft, with the run's PR tool when it has one, otherwise `gh pr create` (or `glab mr create`) without a draft flag.
6. In T3 Code, make sure the PR is linked to the thread. Its PR tool links a PR it creates. Link one you made another way, or pushed to, right after ([t3-code.md](../references/harnesses/t3-code.md#pull-requests)).
7. Hand the PR to the **Babysit** playbook in `drive` mode. It decides whether to watch the PR until it is merge-ready or only a human step remains, or to report its state and hand back. Queue auto-merge when the repository allows it, as the standards say, but only when the playbook that sent you here lets the PR land on checks and approvals alone. Autopilot-full and Shipping land only a head an independent verdict covers, so under them leave merging to their own steps. Autopilot-stack never merges, and neither does a run the **full-stop** skill started. Never merge directly unless the user asked. A delegated child never watches. It ends its report with `PR <full URL>, head <SHA>, checks and reviews <state>.`, and the lead watches.

**Reply:** the PR URL, its base branch, the head SHA, and its state when you stopped.

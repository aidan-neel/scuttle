### Modernize

**You own one verdict on an old PR: keep it, rewrite it, or close it, with the evidence.** A stale PR costs reviewers attention every time it shows up. Bring it onto current trunk only if it still earns a place.

Use the forge CLI, `gh` for GitHub or `glab` for GitLab, read from the repository's remote. In T3 Code, use its pull request tools instead where they are listed ([t3-code.md](../references/harnesses/t3-code.md#pull-requests)).

1. **Read the PR whole.** Its description, linked issues, review threads, diff, base, head SHA, author, and age. Restate in one line what it set out to do. Note whether the author is the user. Rebasing, force-pushing, or closing someone else's PR is a stop-and-ask, though you can judge it in a worktree of your own.
2. **Check whether trunk still needs it.** Work in a fresh worktree off current trunk. Search trunk and recently merged PRs for the same fix or feature. Check whether the code it touches still exists or has moved. When it fixes a bug, reproduce the bug on trunk, because a bug that no longer reproduces means trunk fixed it some other way. When it adds a feature, check that the issue is still open and nothing replaced the need.
3. **Decide.** Write the verdict with its evidence: a commit, a merged PR, a passing or failing repro, a closed issue.
   - **Keep:** trunk still needs it, and the patch still fits the code.
   - **Rewrite:** trunk still needs it, but the code it touched moved so far that most of the rebase would be conflict resolution. Re-apply the intent fresh from trunk.
   - **Close:** trunk already has it, the need went away, or the direction is wrong for the code as it is now.
4. **Keep: rebase it.** Rebase the branch onto current trunk. Resolve each conflict toward the PR's intent on top of trunk's new code, and write one line per resolution for the description. Run the repository's checks for the touched paths, fix what the rebase broke, and sweep trunk for new callers of code the PR changes. Push with `git push --force-with-lease=<branch>:<SHA you read in step 1>`, so a push someone made since then refuses instead of being lost. Update the description with what changed since it was opened. Then hand it to the **Babysit** playbook in `drive` mode.
5. **Rewrite: start fresh.** Branch from trunk, re-apply the intent with today's code per the playbook that fits the change (Bug fix, Feature, or Refactoring), and open it per **Opening a PR**. Its description links the old PR. Close the old PR with a comment that links the new one when it is the user's own. Otherwise leave it, and say who should close it.
6. **Close: show why.** When it is the user's own PR, close it with a comment that gives the evidence in two or three lines. Otherwise post nothing, and report the verdict and the evidence to the user.

**Reply:** what the PR set out to do, the verdict with its evidence, and then by verdict: the new head SHA, each conflict resolution, and the checks run (keep); the new PR (rewrite); or the closing comment, or who should close it (close).

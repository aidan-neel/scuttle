---
name: git-best-practices
description: Branches, Conventional Commits, pull requests, review threads, changelog, and releases. Use when branching, committing, pushing, writing a commit message, opening or updating a PR or merge request, reviewing one, or cutting a release.
---

# Git best practices

The **go** skill's Opening a PR, Babysit, and Shipping playbooks run the full loop. These are the rules they follow.

| Rule | Summary |
|------|---------|
| Issue first | Nontrivial work in a repository with an issue tracker starts from an issue. Use the repository's labels and templates. |
| Branch names | `<type>/<issue>-<slug>` from the default branch, or `<type>/<slug>` without an issue. |
| Commit as you go | Commit coherent increments. Push your own branch and open or update its PR without asking. |
| Ask only at the edge | Before a force-push to a shared branch, a push that deploys, or a release tag. |
| Conventional Commits | `type(scope): summary`, imperative, no period. The scope is the package or area. A body says why. `!` and `BREAKING CHANGE:` for breaks. |
| Bot commits stay bot-written | Never hand-write a commit a bot owns, such as an image pin. |
| One change per PR | A refactor the feature needs lands first, in its own PR. |
| Honest PR bodies | The repository's template when it has one. Otherwise `## Why`, `## What changed`, `## Scope`, `## Tradeoffs`, `## Blast Radius`, `## Verification`, under 40 lines. Link the issue with `Closes #<n>`. Verification names the commands you ran. |
| Ready, not draft | Open every PR ready for review. |
| Squash-merge | CI green first. The squash title becomes the changelog line. |
| Changelog in the same PR | Keep a Changelog form, a line under **Unreleased** for each user-visible change. |
| SemVer releases | A script bumps versions and moves notes, and a `v<version>` tag publishes. Tag only when asked. |
| Review in threads | Findings go in a thread on the diff line, not a top-level comment. |

Details: [references/guide.md](references/guide.md).

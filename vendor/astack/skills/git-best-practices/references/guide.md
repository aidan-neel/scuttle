# Git, pull requests, and releases

These rules hold on GitHub and GitLab. A GitLab merge request follows every pull request rule here. Use the forge CLI (`gh` or `glab`) for forge work.

## Issues

Nontrivial work starts from an issue when the repository uses an issue tracker. Use its issue templates (`.github/ISSUE_TEMPLATE/` or `.gitlab/issue_templates/`) and its existing labels. Don't invent a label scheme in a repository that has one.

## Branches

`<type>/<issue>-<slug>` from the default branch: `feat/58-escalation-ladder`, `fix/31-request-timeout`, `docs/12-routing-table`. Without an issue, drop the number: `fix/reasoning-tokens`.

During a task, work on the branch already checked out, or in a worktree on a new branch for parallel work. If the current branch isn't the intended one, say so in your report and carry on from the right branch. Don't stop to ask.

## Commits

Commit coherent feature or fix increments as they're ready, rather than waiting until all the work is done. Keep each commit focused. Push your own branch and open or update its PR without asking. Ask first only before a force-push to a branch others share, or a push that deploys (a push to the default branch, where every such push deploys).

[Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <summary in imperative mood, no period>
```

- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `style`, `revert`.
- The scope is the package, app, or area (`router`, `cli`, `site`, `deploy`). Omit it only when the change spans the repository.
- The summary says what changed for a user or maintainer: `feat(cli): add a self-update command`, not `update stuff` or `cleanup`.
- A body explains why, when the summary can't.
- Breaking changes use `!` (`feat(protocol)!: ...`) and a `BREAKING CHANGE:` footer.
- Commits a bot owns, such as a deploy workflow's image pin, keep the bot's form. Never write them by hand.

## Pull requests

The title is `type(scope): subject`, the same form as a commit, naming a real symbol when one carries the change.

For the body, use the repository's template (`.github/pull_request_template.md` or `.gitlab/merge_request_templates/`) when it has one. Otherwise write a briefing under 40 lines with these `##` headings in order, dropping empty ones:

- `## Why`: the goal, with `Closes #<n>` when there is an issue.
- `## What changed`
- `## Scope`
- `## Tradeoffs`: only rejected alternatives a reviewer would otherwise ask about.
- `## Blast Radius`
- `## Verification`: the commands you ran and what you checked by hand. Not "tests pass". Say which tests, and what you looked at.

Put long logs and tables in a file or a PR comment and link them from the body. Open every PR ready for review, never as a draft.

Keep PRs to one logical change. A refactor that a feature needs goes in its own PR first, and the feature stacks on it.

Review findings go in a thread on the diff line, so the author can answer and resolve each one: a review on GitHub, a discussion with a position on GitLab. A top-level comment is for the summary only.

CI must be green before review. Squash-merge, and edit the squash title to read well, because it becomes the changelog line.

## Changelog

Projects with releases keep `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com) form. Every user-visible change adds a line under **Unreleased** in the same PR.

## Releases

SemVer. Before 1.0, minor versions may break config or protocol, and the changelog says so. A script cuts the release by bumping every version and moving the Unreleased notes, then a pushed `v<version>` tag runs the release workflow. A release tag publishes to users, so create or push one only when asked.

# astack in OpenCode

This applies to OpenCode 2. Read it once per session before the first tool call a skill names generically. If a field below is missing from a tool's schema, drop it and say so. Inside T3 Code, read [t3-code.md](t3-code.md) next.

## Actions

| Skills say | OpenCode |
|---|---|
| Ask the user | `question`. Subagents don't have it, so a subagent puts its question in its report. |
| Track todos | `todowrite` when the session has it. Without it, keep the list in your reply and update it at each phase. |
| Load the **name** skill | The `skill` tool with the skill's id, such as `go`, or read `../<name>/SKILL.md`. The user mentions a skill as `@go`. |
| Spawn a subagent | `subagent` (older builds call it `task`). See Subagents. |
| Show the user | Write the file and give its absolute path. |
| Ask for a secret | Ask the user to put it in an environment variable or a file outside the repository, and read it from there. Never ask them to paste it in chat. |
| Schedule | OpenCode has none. Use a subagent that waits for the event and returns. |
| The forge CLI | `gh` or `glab` through `bash`. |

## Subagents

| Skills say | `subagent` field |
|---|---|
| A `go-worker` subagent | `agent: "go-worker"`. The setup script registers it in `~/.config/opencode/agents/`. If OpenCode reports the agent as unknown, use `agent: "general"` and make the brief's first line `Read <absolute path to skills/go>/worker.md before anything else.` |
| Another registered agent, such as `comment-auditor` | `agent` set to its name, with the same fallback: `agent: "general"` and the README's first line. |
| A general-purpose subagent | `agent: "general"`. |
| A read-only subagent | `agent: "explore"`, and the brief still says "Do not edit files". |
| Its own worktree | Give each writer its own `git worktree add` and put its absolute path in the brief. |
| In the background | Always. The call returns a `sessionID` at once, and a `<subagent>` message arrives each time the child goes idle. Don't poll. |
| Message a subagent | Call `subagent` again with its `sessionID`. |
| Model | `model`, as `providerID/modelID`. Write those ids in the `## opencode` section of `~/.config/astack/models.md`, from `opencode models`. |
| Reasoning effort | A variant on the model, `providerID/modelID#variant`, where the model has variants. |

## Paths

- astack skills are symlinks in `~/.agents/skills/`, and its agents are files in `~/.config/opencode/agents/`. Edit a skill in the astack repository the symlink points to, never through a copy.
- OpenCode v2 also reads `~/.claude/skills/` and `skill/` or `skills/` under each config folder, keyed by skill id, so a skill found twice is listed once. A skill with `disable-model-invocation: true` stays out of the model's list, and the user can still mention it as `@<name>`.
- Global instructions are `~/.config/opencode/AGENTS.md`. When that file is missing, OpenCode reads `~/.claude/CLAUDE.md` instead.
- Sessions live in a database, not files. List them with `opencode session list`, and print one as JSON with `opencode session export <sessionID>`. Read only this workspace's sessions.

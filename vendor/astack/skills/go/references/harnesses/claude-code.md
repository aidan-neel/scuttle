# astack in Claude Code

Read this once per session before the first tool call a skill names generically. If a field below is missing from a tool's schema, drop it and say so. Never pass a field or value the schema rejects. A tool the session shows only by name, such as `CronCreate`, `Monitor`, `SendMessage`, or `TaskStop`, is deferred: load it with `ToolSearch` and `select:<name>` before the first call. Inside T3 Code, read [t3-code.md](t3-code.md) next.

## Actions

| Skills say | Claude Code |
|---|---|
| Ask the user | `AskUserQuestion`. It is absent in print mode (`-p`), so ask in plain text there and end the turn. |
| Track todos | `TodoWrite`, or a todo tool the session lists. Without one, keep the list in your reply and update it at each phase. |
| Load the **name** skill | `Read` `../<name>/SKILL.md` and follow it. The `Skill` tool refuses skills marked `disable-model-invocation`, which includes `go`. The user types `/<name>`. |
| Spawn a subagent | `Agent`. See Subagents. |
| Show the user | Write the file and give its absolute path. |
| Ask for a secret | Ask the user to put it in an environment variable or a file outside the repository, and read it from there. Never ask them to paste it in chat. |
| Schedule | `CronCreate` when listed. Its jobs live only in this session and fire while the session is idle. `ScheduleWakeup` works only in a self-paced loop session, so don't use it elsewhere. To wait for a background command to finish, run it with `Bash` `run_in_background` and you are notified when it exits. For a stream of events from one, `Monitor` when listed. Without these, a background subagent that returns on the event. |
| The forge CLI | `gh` or `glab` through `Bash`. |

## Subagents

| Skills say | `Agent` field |
|---|---|
| A `go-worker` subagent | `subagent_type: "go-worker"`. The setup script registers it in `~/.claude/agents/`. If the `Agent` tool doesn't list the type, use `subagent_type: "general-purpose"` and make the brief's first line `Read <absolute path to skills/go>/worker.md before anything else.` |
| Another registered agent, such as `comment-auditor` | `subagent_type` set to its name. If the type isn't listed, use `"general-purpose"` with the README's first-line fallback. |
| A general-purpose subagent | `subagent_type: "general-purpose"`. It keeps the session's MCP tools. |
| A read-only subagent | `subagent_type: "general-purpose"`, and the brief says "Do not edit files". Check `git status` after it returns. `Explore` only locates code and reads excerpts, so use it for search, never for a review or an audit. |
| Its own worktree | `isolation: "worktree"`. `Agent` has no field for the branch or commit, so name it in the brief when it matters. |
| In the background | The default. `Agent` runs a child in the background unless you pass `run_in_background: false`, and you are notified when it finishes. Pass `run_in_background: false` for a child whose result your next step needs. In T3 Code, use `delegate_task` for a background child instead. |
| Message a subagent | `SendMessage` to its id or name. Without it, spawn a fresh one with the earlier result in its brief. |
| Stop a subagent | `TaskStop` with its id, for a background child you replaced or no longer need. |
| Model | `model`, one of the short names the `Agent` schema lists (`opus`, `sonnet`, `haiku`, `fable`). Write those in the `## claude-code` section of `~/.config/astack/models.md`. |
| Reasoning effort | `effort`, from the values the schema lists. The schema says to set it only when the user or a skill asks. |

`subagent_type: "go-worker"` defaults to the session's model. A size you resolved overrides it through `model` and `effort`. A size or effort read from `models.md` is a skill instruction, which is the reason the `effort` schema asks for.

## Paths

- astack skills are symlinks in `~/.claude/skills/`, and its agents are files in `~/.claude/agents/`. Edit a skill in the astack repository the symlink points to, never through a copy.
- Project skills live in `.claude/skills/`. Project instructions live in `CLAUDE.md`, or `AGENTS.md` when no `CLAUDE.md` exists.
- Transcripts are `~/.claude/projects/<slug>/<session>.jsonl`. The slug is the workspace path with each `/` and `.` changed to `-`, so `/Users/you/proj` is `-Users-you-proj`. The newest `.jsonl` directly in that folder is the current session. Its `<session>/subagents/` folder holds subagent transcripts. Read only this workspace's folder.

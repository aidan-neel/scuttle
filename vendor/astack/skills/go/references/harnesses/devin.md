# astack in Devin CLI

Read this once per session before the first tool call a skill names generically. If a field below is missing from a tool's schema, drop it and say so. Inside T3 Code, read [t3-code.md](t3-code.md) next.

## Actions

| Skills say | Devin CLI |
|---|---|
| Ask the user | `ask_user_question`. Subagents never have it, so a subagent puts its question in its report. |
| Track todos | `todo_write`. |
| Load the **name** skill | Read `../<name>/SKILL.md` and follow it. The user types `/<name>`. |
| Spawn a subagent | `run_subagent`, which takes a profile, not a model. See Subagents. `read_subagent` reads a background subagent's result. |
| Show the user | Write the file and give its absolute path. |
| Ask for a secret | Ask the user to put it in an environment variable or a file outside the repository, and read it from there. Never ask them to paste it in chat. |
| Schedule | Devin CLI has none. Use a background subagent that waits for the event and returns. |
| The forge CLI | `gh` or `glab` in the shell. |

## Subagents

| Skills say | `run_subagent` |
|---|---|
| A `go-worker` subagent | The `go-worker` profile. The setup script registers it in `~/.config/devin/agents/`. If Devin doesn't list the profile, use `subagent_general` and make the brief's first line `Read <absolute path to skills/go>/worker.md before anything else.` |
| Another registered agent, such as `comment-auditor` | The profile with its name, with the same fallback: `subagent_general` and the README's first line. |
| A general-purpose subagent | The `subagent_general` profile. It runs on your model. |
| A read-only subagent | The `subagent_explore` profile. It can't edit files. |
| Its own worktree | Give each writer its own `git worktree add` and put its absolute path in the brief. |
| In the background | Run it in the background. You are notified when it finishes, and background subagents can only use pre-approved tools. |
| Message a subagent | Spawn a fresh one with the earlier result in its brief. |
| Model | A profile fixes its model. `subagent_general` runs on yours. A custom profile runs on its `model:` field or the default subagent model. To run a size on a specific model, delegate through T3 Code, or say the size ran on the profile's model. |
| Reasoning effort | Not settable per spawn. |

## Paths

- astack skills are symlinks in `~/.agents/skills/`, and its agents are files in `~/.config/devin/agents/`. Edit a skill in the astack repository the symlink points to, never through a copy.
- Global instructions are `~/.config/devin/AGENTS.md`. Devin also reads `~/.claude/CLAUDE.md`.
- `devin skills paths` lists every folder Devin reads skills from.
- Sessions live in the SQLite file `~/.local/share/devin/cli/sessions.db`, opened read-only. The `sessions` table has `id`, `working_directory`, `title`, and `last_activity_at`. Each session's messages are rows of `message_nodes` (`session_id`, `chat_message` as JSON). The row with this workspace's `working_directory` and the newest `last_activity_at` is the current session. Read only this workspace's sessions.

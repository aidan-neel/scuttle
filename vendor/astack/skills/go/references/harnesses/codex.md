# astack in Codex

Read this once per session before the first tool call a skill names generically. If a field below is missing from a tool's schema, drop it and say so. Inside T3 Code, read [t3-code.md](t3-code.md) next.

## Actions

| Skills say | Codex |
|---|---|
| Ask the user | `request_user_input` in Plan mode or `request_user_input_async` in default mode, whichever the session lists. Otherwise ask in plain text, give the options as a short list, and end the turn. |
| Track todos | `update_plan`. |
| Load the **name** skill | Read `../<name>/SKILL.md` and follow it. The user types `$<name>`, such as `$go`. |
| Spawn a subagent | `spawn_agent`. See Subagents. Without it, do the subagent's work yourself in order and say so. |
| Show the user | Write the file and give its absolute path. |
| Ask for a secret | Ask the user to put it in an environment variable or a file outside the repository, and read it from there. Never ask them to paste it in chat. |
| Schedule | Codex has none. Use a subagent that waits for the event and returns, and `wait_agent` on it when you have nothing else to do. |
| The forge CLI | `gh` or `glab` in the shell. |

## Subagents

| Skills say | `spawn_agent` |
|---|---|
| The brief | `message`. Give the child a short `task_name`. |
| A `go-worker` subagent | `agent_type: "go-worker"`. The setup script registers it in `$CODEX_HOME/agents/`. If `spawn_agent` has no `agent_type` field, or Codex reports the type as unknown, leave `agent_type` out and make the brief's first line `Read <absolute path to skills/go>/worker.md before anything else.` |
| Another registered agent, such as `comment-auditor` | `agent_type` set to its name, with the same fallback: leave it out and use the README's first line. |
| A general-purpose subagent | Leave `agent_type` out. |
| A read-only subagent | The brief says "Do not edit files", and you check `git status` after it returns. |
| Its own worktree | All agents share one working directory, so parallel writers overwrite each other. Give each writer its own `git worktree add` and put its absolute path in the brief. |
| In the background | Spawned agents run on their own. `wait_agent` blocks, so call it only when you have nothing else to do. |
| Message a subagent | `send_message` passes a note to a running agent. `followup_task` gives an agent a new task and starts its turn. `list_agents` shows them. To stop one, use `close_agent` or `interrupt_agent`, whichever is listed. |
| Context | `fork_turns: "none"` starts the child fresh, which is the astack default. With `fork_turns` left out or `"all"`, the child inherits your history and your model, and rejects `model` and `reasoning_effort`. |
| Model | `model`, a slug from `codex debug models`, with `fork_turns: "none"`. Write those slugs in the `## codex` section of `~/.config/astack/models.md`. |
| Reasoning effort | `reasoning_effort`, with `fork_turns: "none"`. |

A size read from `models.md` is a skill instruction, which Codex accepts as a reason to set `model` and `reasoning_effort`.

## Paths

- `$CODEX_HOME` is Codex's home folder, `~/.codex` when unset. Under T3 Code it can point at a folder T3 manages, so read it before you look for agents or sessions.
- astack skills are symlinks in `~/.agents/skills/`, and its agents are files in `$CODEX_HOME/agents/` as it was set when setup ran. When T3 Code sets a different one, those agents may be missing, so use the first-line fallback. Edit a skill in the astack repository the symlink points to, never through a copy.
- A skill with `agents/openai.yaml` setting `allow_implicit_invocation: false` (go, the principles, and the other costly skills) is left out of your skill list. The user can still start it with `$<name>`, and you can still read its SKILL.md by path.
- Global instructions are `$CODEX_HOME/AGENTS.md`. Project instructions are `AGENTS.md` files from the repository root down.
- Transcripts are JSONL files under `$CODEX_HOME/sessions/<year>/<month>/<day>/`. Each file name ends in its session id, and its first line records the id and the working directory. Find the current session by its id when you know it. Several sessions can share one working directory, so the newest file for this workspace is only a fallback. Read only this workspace's sessions.

# astack in Antigravity

Read this once per session before the first tool call a skill names generically. If a field below is missing from a tool's schema, drop it and say so. Inside T3 Code, read [t3-code.md](t3-code.md) next.

An Antigravity session checked these facts against its live tool schemas. Where a line says unverified, check before you rely on it. The setup script installs only skills here, no agents and no global instructions.

## Actions

| Skills say | Antigravity |
|---|---|
| Ask the user | `ask_question`, a multiple-choice question. |
| Track todos | Antigravity has no todo tool. Keep the list in your reply and update it at each phase. |
| Load the **name** skill | Read `../<name>/SKILL.md` and follow it. Whether Antigravity honors `disable-model-invocation` is unverified, so `go` and the other costly skills may show in your skill list. Start them only when the user asks. |
| Spawn a subagent | `invoke_subagent`. See Subagents. |
| Show the user | Write the file and give its absolute path. |
| Ask for a secret | Ask the user to put it in an environment variable or a file outside the repository, and read it from there. Never ask them to paste it in chat. |
| Schedule | `schedule`: a one-off timer, a recurring one (`CronExpression`), a daemon (`IsDaemon`), or a wait on a condition (`TimerCondition`). Cancel one with `manage_task`. |
| The forge CLI | `gh` or `glab` in the shell. |

## Subagents

| Skills say | `invoke_subagent` |
|---|---|
| The brief | `Prompt`, required. `Role`, also required, takes a short free-text role, such as reviewer or implementer. |
| A `go-worker` subagent | Setup registers no agents here. Use `TypeName: "self"` and make the brief's first line `Read <absolute path to skills/go>/worker.md before anything else.` |
| Another registered agent, such as `comment-auditor` | `TypeName: "self"`, with the README's first-line fallback. |
| A general-purpose subagent | `TypeName: "self"`. |
| A read-only subagent | `TypeName: "research"`, `Workspace: "inherit"`, and the brief says "Do not edit files". It has no shell (`run_command`), no network, and no MCP tools, so it can only read and search. A reviewer that must run tests or checks uses `TypeName: "self"` with the same brief. Check `git status` after it returns. |
| Its own worktree | `Workspace: "share"` gives the child a new worktree-like workspace on the same repository. `"branch"` gives it an isolated cloned or branched workspace, for full isolation. `"inherit"`, the default, keeps the child in your checkout, which suits a read-only or same-checkout child. |
| In the background | Always. Every spawn runs in the background, and `invoke_subagent` wakes you with a message when the child finishes or needs guidance. Don't poll. `manage_subagents` only lists or kills children (`list`, `kill`, `kill_all`), and no tool reads a child's result. Inside T3 Code, use `delegate_task` instead. |
| Message a subagent | `send_message`. |
| Model | Only `inherit`, `flash_lite`, `flash`, or `pro`. Write those in the `## antigravity` section of `~/.config/astack/models.md`. Inside T3 Code, delegate to reach any other model. |
| Reasoning effort | Not settable per spawn. |

## Paths

- astack skills are symlinks in `~/.gemini/config/skills/<name>/`. Edit a skill in the astack repository the symlink points to, never through a copy.
- The session's user information block gives the App Data Directory and the Conversation ID. The app data directory is `~/.gemini/antigravity-cli` for the standalone `agy` CLI, and `~/.t3/userdata/providers/antigravity/<hash>/antigravity-acp` under T3 Code.
- Transcripts are `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`. The folder for this conversation's id is the current session. Read only this workspace's conversations.

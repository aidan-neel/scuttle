# Harness references

astack skills name tools by what they do, not by any one harness's tool names. Before the first tool call a skill names generically, find where you run and read that harness's file once per session.

## Find your harness

Look at the tools you have. The first match wins.

| You have | You run in | Read |
|---|---|---|
| `Agent`, `Skill` | Claude Code | [claude-code.md](claude-code.md) |
| `spawn_agent`, `update_plan` | Codex | [codex.md](codex.md) |
| `subagent` or `task`, `todowrite`, `skill` | OpenCode | [opencode.md](opencode.md) |
| `run_subagent`, `todo_write` | Devin CLI | [devin.md](devin.md) |
| `invoke_subagent`, `ask_question` | Antigravity | [antigravity.md](antigravity.md) |
| None of the above | Another harness | Map each action below to the closest tool you have. When a skill needs an action you have no tool for, do it yourself in order and say so. |

Then check for T3 Code. You are inside T3 Code when you have `delegate_task` and `orchestrator_capabilities`, or your context holds T3 Code orchestration instructions. The tools carry a prefix that varies by host harness, such as `mcp__t3-code__`, `mcp__t3_code__`, or `mcp_t3-code_`. T3 Code runs on top of the harness above, so read both files. Read [t3-code.md](t3-code.md) second, because its rules win where the two disagree.

## Actions

Skills use these words. Each harness file maps them.

| Skills say | Meaning |
|---|---|
| Ask the user | One short multiple-choice question, through the harness's question tool when it has one. Without one, ask in plain text and end the turn. |
| Track todos | The harness's todo or plan tool. Without one, keep the list in your reply and update it at each phase. |
| Load the **name** skill | Read `../<name>/SKILL.md` from the folder of the skill you are following, and follow it. A harness skill tool also works when it accepts the name. |
| Spawn a subagent | Start a child agent with a self-contained brief. It sees none of your history. |
| A `go-worker` subagent | A subagent that reads [`../../worker.md`](../../worker.md) first. Use the registered `go-worker` agent type where the harness has one. Otherwise make the brief's first line `Read <absolute path to skills/go>/worker.md before anything else.` Only a `go-worker` reads `worker.md`. A council, panel, or interrogate seat, or a blinded eval candidate, gets its own brief from the skill that starts it, because `worker.md` would leak go's rules and the run's meta into it. |
| Another registered agent, such as `comment-auditor` | Spawn it the way your harness file spawns `go-worker`, by its own name. Where there is no registered type for it, as in T3 Code, the brief's first line is `Read <astack>/agents/<name>.md and follow it as your instructions.` `<astack>` is the real path of the astack checkout, the folder that holds `skills/`. Read `{{ASTACK}}` in that file as the same path. |
| A general-purpose subagent | A subagent with the harness's full default tool set, MCP tools included. Use it when the child needs tools a `go-worker` or read-only type may lack. |
| A read-only subagent | The brief says "Do not edit files." Use a read-only agent type only where the harness file says it can do the work, since some only search. Check `git status` after it returns. |
| In its own worktree | The child works in a separate git checkout, so parallel writers never share files. A new worktree starts from the last commit, so commit what the child needs first. |
| In the background | You keep working while the child runs, and the harness tells you when it finishes. Never poll. |
| Message a subagent | Send a follow-up to a running child. Where that's missing, spawn a fresh one with the earlier result in its brief. |
| A size (`nano`, `small`, `medium`, `large`, `xlarge`, `max`, `panel`, `design`, `council`) | A model from `~/.config/astack/models.md`. See [Models](#models). |
| Show the user | Put a visual (a chart, a diagram, a rendered page) in front of the user. Without a display tool, write the file and give its absolute path. |
| Ask for a secret | Get a token, password, or key that only the user has, without it entering the chat or the transcript. |
| Schedule | Wake later or on a recurring cadence. Without a scheduler, a background subagent that waits for the event and returns. |
| The forge CLI | `gh` for GitHub, `glab` for GitLab. In T3 Code, prefer its pull request tools when they are listed. |

## Models

Skills never name a model. They name a size. Each person maps sizes to models with the **setup-models** skill, which writes `~/.config/astack/models.md`.

To pick a spawn's model:

1. Read `~/.config/astack/models.md` once per session. Use the section for where you spawn: `## t3-code` for a `delegate_task` child, otherwise the section for your harness.
2. Use the line for the size the skill names. A size with no line, a line of `inherit`, or no file at all means you leave the model out, so the child runs on your own model.
3. When a skill names no size, pick by the work. Read-only exploring, dispatching, and polling take `nano`. Routine code and verification take `small`. Code delegates in the playbooks take `medium`. Complex changes, judgment, and prose take `large`. Hardest escalations take `xlarge`, and extreme last-resort tasks take `max`. UI and visual work takes `design`.
4. The file's `budget:` line sets the starting reasoning effort. Raise it one step for the hardest work. Lower it one step for judgment and two for routine work. A `panel` or `council` entry keeps the effort it lists.
5. If the harness rejects a model, don't guess another. Leave the model out, run on your own, and say so. In T3 Code, follow its rule instead: say the model is unavailable and don't switch.

Skills that want diverse models read `panel`, a list of two or more models. When every entry comes from one vendor, say in the reply that the panel was not diverse. Agreement from one family is weaker evidence than agreement across families.

A model's vendor is the family that made it, not the provider that runs it. A provider that hosts other vendors' models counts as the vendor of the model it runs. Two accounts of one vendor count once.

## Model trials

When `~/.config/astack/model-trials.md` exists and lists an active trial model, log every completed subagent run on that model after reviewing its diff and checks. Append one row with `python3 <astack>/skills/setup-models/scripts/log-trial.py` recording the project, size, model, task, outcome (`pass`, `partial`, or `fail`), check result, rework level (`none`, `minor`, or `major`), and a one-sentence note on usefulness. Summarize progress on request with `--summary`.

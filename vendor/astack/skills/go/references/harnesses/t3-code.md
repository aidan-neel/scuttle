# astack in T3 Code

T3 Code runs your harness (Claude Code, Codex, OpenCode, Devin, Antigravity, and others) and adds an MCP server, `t3-code`, with tools to delegate across providers, watch pull requests, and talk to the user. Read your harness's file first, then this one. T3 Code also injects its own orchestration instructions into every session. They win wherever they and this file disagree.

This file names T3 tools without their prefix. The prefix varies by host harness, such as `mcp__t3-code__`, `mcp__t3_code__`, or `mcp_t3-code_`, so use the full names your session lists. In Claude Code the T3 tools are deferred. Load the ones you need in one `ToolSearch` call with `select:` and their full names before using them. T3 tools can load late, so try a name once before you treat it as absent.

Some T3 tools appear only in some sessions: `watch_pull_request`, `unwatch_pull_request`, the `pull_request_*` tools, `ci_logs`, `ci_rerun`, `t3_background_wait`, and `t3_environment_links`. A delegated child never has the PR watch tools. Use each one only when it is listed, and use the fallback below when it isn't.

## Spawning

Pick the tool by who the child is.

| The child | Use |
|---|---|
| Same provider, a model it offers, no settings beyond yours | Your harness's native subagent tool, in the foreground (Claude Code: `Agent` with `run_in_background: false`; Codex: `spawn_agent`, then wait). |
| Another provider's model, settings the user asked for, its own worktree, or work that runs in the background | `delegate_task`. |

So a `design` size on another provider, a `go-worker` in its own worktree, and every background child go through `delegate_task`. A native subagent in the background is never right here.

Council, panel, and review seats always go through `delegate_task`, even when a seat runs on your own provider. astack names `delegate_task` for these seats, so they all start the same way and in parallel. So does any spawn where your harness's native subagent tool can only run in the background, such as Antigravity's or OpenCode's.

## Before the first delegation

Call `orchestrator_capabilities` once per thread, before the first `delegate_task`. Call it again only after an error or when the user names a different provider. It lists provider instances, their models, and each model's options. Pass `search` to find a model outside the short list.

Resolve each size from the `## t3-code` section of `~/.config/astack/models.md`. A line there reads `<providerInstanceId>/<model> <optionId>=<value> ...`. Split at the first `/`, since model ids can contain more. A list (`panel`, `council`) separates entries with `, `. Check every entry against the capabilities result:

- The provider instance is listed with `canRunChildTask` true and no constraint such as "disabled". A child on a provider other than your own instance also needs `canRunCrossProviderChildTask` true.
- The model is listed for that instance, or `search` finds it.
- Each option id and value is listed for that model. Option ids vary by model, not only by provider. Examples: `effort` (Claude, and Cursor's hosted Claude model), `reasoning_effort` (Cursor's other models), `reasoningEffort` (Codex, and Grok's own instance), `thought_level` (Antigravity), `variant` (OpenCode). `acpRegistry` models take `mode`, some also take `thought_level`, and Copilot also takes `allow_all`. Read each model's option list from `orchestrator_capabilities` and never pass an id it doesn't list.

A provider can have several instances, such as two accounts. They are separate seats for capacity but the same vendor for diversity. Diversity counts the model's vendor, not the provider instance. The catalog has no vendor field, so infer it from the model id or label: a `claude-*` model is Anthropic's on whatever instance hosts it. `cursor`, `opencode`, `acpRegistry_devin`, and `acpRegistry_github_copilot` all host other vendors' models, and each counts as the vendor of the model it runs. If an entry fails a check, say so and don't switch to another model unless the user asked.

## `delegate_task`

| astack says | `delegate_task` |
|---|---|
| The brief | `task`. The child sees nothing but this, so it carries the goal, absolute paths, the bar, what not to touch, the checks to run, and the report shape. Never put a secret in it. |
| A `go-worker` subagent | The first line of `task` is `Read <absolute path to skills/go>/worker.md before anything else.` `role: "implementation"`, or `role: "design"` on the `design` size. |
| Another registered agent, such as `comment-auditor` | T3 children have no agent types. The first line of `task` is `Read <astack>/agents/<name>.md and follow it as your instructions.`, per the README. `role: "general"`. |
| A general-purpose subagent | Leave `role` out, or set the one that fits the task. Every T3 child keeps its provider's full tool set. |
| A read-only subagent | `role: "review"` or `"research"`, `isolation: "shared"`, and the brief says "Do not edit files." T3 has no read-only mode, and the review role enforces nothing. A narrower `runtimeMode` pauses for approval instead of blocking writes. Run `git status --porcelain --ignored` before the spawn and after it returns, and compare. |
| UI or visual work | `role: "design"`, on the `design` size. |
| Its own worktree | `isolation: "worktree"`. T3 makes the checkout from your current commit. Uncommitted edits stay behind, so commit first. Never make a child's checkout yourself in the shell or in the brief. In a folder that isn't the project's git root, use `shared`. |
| In the background | `mode: "async"`, the default. Use `mode: "wait"` only when this turn can't go on without the result, and know it returns after 45 seconds at most. |
| Model and effort | `target.providerInstanceId`, `target.model`, and `target.options` from the resolved size. Leave `target` out to run on your own model. |
| A short label | `title`. |
| Retry safety | `clientRequestId`, a stable id per logical spawn, so a retried call doesn't start a second child. |

Keep the `taskId` and the `link` it returns.

**Waiting.** Completion wakes you. Never poll with `task_status`, `sleep`, a watcher, or a scheduler. Follow the `next` field of a running delegate. Keep working on what doesn't depend on it, or end your turn. When a result arrives, read it with `task_status`, which marks it delivered.

**Steering.** To change a running child's direction, `t3_thread_send` with `mode: "steer"` to its `childThreadId`. Everything else is a fresh `delegate_task`. Every new review or re-check is a fresh `delegate_task` that carries the brief, the earlier findings, and your objections. Fix small review findings yourself.

**Stopping.** `task_cancel` with the `taskId`, for a child you replaced or no longer need. Never `t3_thread_interrupt` a child thread. When the user asks for fewer delegates, cancel the extras and start no replacements.

**Children don't delegate.** T3 tells every child to do its own work and start no subagents unless its brief says to. When a child must fan out (a swarm, a council inside a worker), say so in its brief.

## Panels and councils

Start one `delegate_task` per entry, all in the same turn, `mode: "async"`. Give every seat the same brief, without the `worker.md` first line. For a review, keep seats on `role: "review"` and `isolation: "shared"`, and don't edit files while any seat is still reviewing that checkout. T3 doesn't make a review seat read-only, so the brief forbids creating, moving, editing, or deleting any file in the checkout, and sends scratch output to a folder outside it, such as one from `mktemp -d`. Before launch, run [`checkout-manifest.sh`](../../scripts/checkout-manifest.sh)` save <scratch>/manifest.txt`, and after each seat returns, `checkout-manifest.sh compare <scratch>/manifest.txt`, which exits 1 on a stray write. It compares file checksums and symlink targets, so it catches another edit to a file that was already modified or untracked, which `git status` can't. It skips `.git`, which T3 writes to itself, and caches such as `__pycache__`. When seats need to write, give each `isolation: "worktree"`. Check each result against the code as it arrives, while the others still run. Read the seat's model from `task_status`. Its `executedModel` is optional and can be null. When it is set, it is the model the seat ran. When it is null, the only other evidence is the seat's own report, so every brief asks the seat to name its model and vendor in its first line. Count the seat when `executedModel`, or else that self-report, names a model whose vendor you know, and say which source you used. When only the requested `model` is known, the seat is unverified.

## Pull requests

- `pull_request_create` links the PR it creates. After you create a PR any other way, take one over, or push to one, call `link_pull_request` (or `link_pull_requests` for a stack, every layer) as your next call.
- Watch a PR only when `watch_pull_request` is listed and either the user asked you to babysit or monitor it, or work they asked for, such as a merge, still waits on checks or reviews. Push your last change first, then link and watch the PR and end your turn. T3 wakes you on failed or passed checks, new comments or reviews, conflicts, and merge or close. Don't watch again on a wake.
- Otherwise finish the current pass, report `PR <full URL>, head <SHA>, checks and reviews <state>.`, and hand back. T3 forbids waiting on a PR with `sleep`, a loop, `gh pr checks --watch`, `Monitor`, or `ScheduleWakeup`, so use none of them here.
- Call `unwatch_pull_request`, when listed, before you hand back for any reason: the PR merged, only a human step remains, or the user stopped asking you to watch.
- When the `pull_request_*` tools are listed, use them, not `gh`, to read, list, open, edit, review, reply to, close, or merge PRs. `pull_request_merge` and approvals need the current head SHA. Use `ci_logs` and `ci_rerun` for checks when listed, otherwise `gh run view --log-failed` and `gh run rerun`.
- Children never watch PRs. A child's last line after PR work is `PR <full URL>, head <SHA>, checks and reviews <state>.`
- For a reviewer's tour of a PR, call `write_pull_request_guides`. It starts runs that take minutes and returns before the guides exist, so `read_pull_request_guide` right after it returns null. Read the guide later, or after the wake.

## Talking to the user

| astack says | T3 Code |
|---|---|
| Show the user | `html_preview` with an HTML file path or inline HTML, then `html_render` with the same source, a `title`, and `height` set to the preview's `contentHeight` clamped to 80–2000, the range the schema allows. On mobile, content past `height` scrolls. Use it for charts, diagrams, and comparisons. Never start a server for it. An image meant for use elsewhere is a `.png` file and its path instead. |
| Text they must read mid-turn | `send_to_user`, for a draft, a code block, or what a question refers to. |
| Ask for a secret | `request_secret`. Use `delivery: "file"` when a shell command consumes it, and read the file only inside that command. |
| Schedule | `schedule_task`. |
| A background shell command you wait on | `t3_background_wait` with its task id before you end the turn, when listed. Otherwise rely on your harness's own background notification. |

Mention a thread by its `link`, exactly as returned. Make new top-level threads (`t3_thread_launch`, `create_threads`) only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean one.

## Other machines

`t3_environment_links`, when listed, lists linked machines. Pass a machine's `environmentId` in `target` or to the thread tools to work there. For a machine that isn't linked yet, call `t3_environment_link` with a `hint` taken from the user's words, never a pairing code in chat. When no link tool is listed in a top-level thread, linked environments are off, so tell the user to turn them on in Settings → Labs → Linked environments. A delegated child may not see these tools at all, so it reports the need to its lead instead.

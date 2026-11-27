---
name: go-help
description: Answers questions about astack, the go skill, and which skill, playbook, or principle fits a task, and hands back a prompt to send. Use for /go-help, $go-help, or "how do I use astack".
disable-model-invocation: true
---

# go help

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Answer the question, hand back one prompt the user can send, and name the file the answer came from by its absolute path. Don't start the work: a go run costs real tokens, so let the user send the prompt. A message that asks for work ("use go to fix this bug") is not a help question. Read [`go`](../go/SKILL.md) and do it.

This file is a map. Read the file you route to before you quote it, and trust it over this map. Skills are symlinks into one astack checkout; resolve this file's real path to find it.

When the need is unclear, ask one multiple-choice question: get set up, start a task, pick a skill, fix a run, or make astack my own.

Mention state only when it changes the answer:

- No `~/.config/astack/models.md`: **setup-models** hasn't run, so every size runs on the session's model.
- No `verify-*` skill in the project: suggest **create-verification-skill** for proving a change works.

## Get set up

1. `./setup` in the checkout links skills, subagents, and `AGENTS.md` into every harness found. `./setup status` shows the plan; `./setup uninstall` removes what it made.
2. **setup-models** maps each size to a model, once per machine.
3. Start a task: `/go` in Claude Code and Devin, `$go` in Codex, `@go` in OpenCode.

`git pull` updates every harness. Rerun `./setup` after a pull that adds a skill or changes `AGENTS.md` or `agents/`. To spend less, rerun **setup-models** with a smaller budget or a shorter `panel`, and save go for work that needs rigor.

## Start a task

go picks a playbook and runs its steps. A good prompt gives the goal and a check that can pass or fail, not a list of skills. Read [`references/prompting.md`](references/prompting.md) before helping word one. go covers one task; start the next with go again or say "new task".

## Pick a skill

Default to go. Name a skill directly when the user wants more or less than a playbook gives.

| The user wants to | Skill |
|---|---|
| Three vendors' models review until the work holds | **council** |
| One change to a merged PR, unattended | **full-send** |
| The same, stopping at merge-ready | **full-stop** |
| Watch a PR through CI and bots | **babysit-pr** |
| Rebase an old PR or close it | **modernize** |
| Check the agent understood the goal | **in-your-own-words** |
| A deeper prompt | **sharpen** |
| The expert words for the thing | **reframe** |
| How code works, or where code belongs | **how** |
| Why code is shaped this way | **why** |
| Deep cited research (arXiv, GitHub, X, docs) | **research** |
| A plain explanation of a change | **teach** |
| Catch up across recent chats | **recall** |
| Catch up on this chat | **catchup** |
| What a small diff could break | **blast-radius** |
| Types and module shape before code | **architect** |
| Several attempts merged into one | **arena** |
| Parallel checks or a race | **swarm** |
| Models try to break a diff | **interrogate** |
| A UI that looks intentional | **design** |
| Drive a UI or CLI and keep proof | **control-ui**, **control-cli** |
| Fix a bug test-first | **tdd** |
| Clean a diff, its comments, or prose | **deslop**, **no-comments**, **unslop** |
| Check the shape of code you changed | **codehygiene** |
| Docs to a standard | **technical-writing** |
| Language or general rules | the **\*-best-practices** skills |
| A scripted way to drive the app | **create-verification-skill**, **maintain-verification-skill** |
| Check a race or invariant formally | **create-formal-verification-skill**, **maintain-formal-verification-skill** |
| User-facing states as a checked chart | **statechart** |
| Vet a performance number | **benchmark-checklist** |
| Plan a large run, or log its decisions | **figure-it-out**, **show-me-your-work** |
| Map sizes to models | **setup-models** |
| A personal mode skill, or skill edits from a session | **automate-me**, **reflect** |
| Stop repeated mistakes in this repo | **correct** |

A skill missing from the table: route by its description.

## Playbooks and principles

Playbooks live inside go and have no command. Describing the task picks one; the Playbooks section of [`go`](../go/SKILL.md) lists them. Principles are one-rule skills go cites; the user steers with their names ("apply prove it works").

## Fix a run

| Symptom | Fix |
|---|---|
| go stopped applying | Start the task with go, or say "new task". |
| A new model choice did nothing | Models load once per session. Start a new one. |
| A subagent used the wrong model | See the harness reference: Codex sets models only on fresh subagents, Devin not per spawn. |
| A skill is missing | `./setup status`, then `./setup`. |
| Setup reported a conflict | Something setup didn't make is at that path. Move it, or put edits in `agents/`, and rerun. |
| Parallel agents clobbered each other | One worktree per writer. |
| An overnight run finished nothing | Give it a check that can pass or fail, not a duration. |
| Success claimed from a green build | Ask for the real output (prove it works). |

More steers are in [`references/prompting.md`](references/prompting.md).

## Make astack my own

Edit the checkout; `AUTHORING.md` in the checkout has the rules and `scripts/check` enforces them. "go write a skill for <workflow>" runs Authoring a skill. Fix a misbehaving skill in its own change.

## Reply

Lead with the answer. Give one example prompt in a code block, from [`references/recipes.md`](references/recipes.md) when one fits, and the source path.

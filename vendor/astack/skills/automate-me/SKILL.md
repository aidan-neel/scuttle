---
name: automate-me
description: "Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode routing skill with the Authoring a skill playbook and unslop, optionally pulling fresh evidence from recent transcripts."
disable-model-invocation: true
---

# Automate me

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

A guided flow for turning the user's working conventions into a skill agents will follow. The output is one `<handle>-mode` routing skill tailored to them (e.g. `jay-mode`, `priya-mode`).

This skill orchestrates three others. They are an inline mining pass (step 1), the [Authoring a skill](../go/playbooks/authoring-a-skill.md) playbook of the **go** skill, and the **unslop** skill. It sequences them. It doesn't replace them.

## Where mode skills live

- **Personal.** The astack repository's `skills/<handle>-mode/SKILL.md`. Find the repository by resolving this skill's symlink (`readlink -f` on this file's folder) and going up two levels. Every harness gets the skill once `setup` runs again.
- **Project.** The project's skills folder, which the Paths section of your harness's file names, when the user wants the mode to apply only in one repository. A project with an established personal category keeps it (`<skills folder>/<handle>/<handle>-mode/`).

Default to personal. Pick project only when the user asks or a mode skill for them already lives there.

## Flow

### 0. Check for an existing skill

Look for a `*-mode/SKILL.md` matching the user's handle in both places above, searching subfolders too. If one exists, ask the user (unless they already said "update my skill" or similar):

- Update the existing skill (default for repeat runs)
- Start fresh (rare, ask why before doing it)

Update mode changes the rest of the flow:
- Step 1 mines only history since the skill was last edited (`git log -1 --format=%cI <path>`).
- Step 2 asks what's changed or missing, not what to capture from zero.
- Step 4 edits the existing file in place. Preserve sections the user hasn't contradicted. Revise ones with new evidence. Add new sections only for genuinely new rules.

### 1. Mine their history

Locate the active workspace's transcripts before fanning out, per the Paths section of your harness's file. Use only this workspace's transcripts. Globbing across every project crosses workspace boundaries and reads private chats from unrelated projects. When your harness's file names no transcript location, say so and skip to step 2. Never guess a path.

Survey recent agent conversations within that scope for recurring patterns. Run parallel read-only subagents on the `nano` size across slices of history (e.g. last 2-4 weeks, split into 3 slices so each has enough material). Each slice subagent reads transcripts from the workspace-scoped path you give it, looks for the signals below, and returns a short structured list of patterns it saw with evidence pointers. Default signals worth hunting:

- Response preferences (length, tone, format, "dumb it down" corrections)
- Delegation habits (subagents, model sizes, specialized workflows, parallelism)
- Verification posture (what "done" means, unit tests vs live repro, reviewers)
- Code and prose discipline (style, principles cited, lint/format tools)
- Process conventions (worktrees, commits, PRs, review/merge tooling)
- Meta preferences (fixing skills mid-task, proposing new ones)

Cross-check across slices before elevating a signal. Patterns seen in 2+ slices are high-confidence. Lone signals are weak and usually get dropped.

### 2. Ask the user directly

Mining misses intent that hasn't come up yet. Ask the user with multiple-choice questions rather than asking them to type from scratch.

Ask one or two questions with 4-6 options each, multiple selections allowed for category questions. Start broad ("Which areas matter most?"), then follow up on selected areas with specific options. After the structured rounds, one free-form question catches anything the options missed.

Don't dump 20 questions.

### 3. Cluster findings

Group the combined signals into sections. Common ones (use only what applies):

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking, MCP tool use.
- **Understand first**: which skills to reach for when scoping or investigating a change.
- **Subagents**: default, parallelism, size-to-task, specialized workflows.
- **Prose / code discipline**: principles, lint tools, style guides.
- **Review and verify**: repro posture, verification skills, live-testing tools.
- **Process**: git worktrees, commits, PRs, review/merge tooling.
- **Skills**: skill-authoring habits, fix-the-skill-first, proposing new skills.

The **go** skill shows the shape. Read it for granularity. Don't copy its content. The user's rules are not the same as go's.

### 4. Draft the skill

Author the skill per the Authoring a skill playbook, at the path from Where mode skills live.

- Handle: the user's first name or chosen identifier.
- Frontmatter: `name`, `description`, and `disable-model-invocation: true`, and no other fields. Keep `description` as one YAML scalar. Quote it or use `description: >-` with indented continuation lines when punctuation or wrapping requires it.
- `description`: trigger on their name, `<handle>-mode`, and "work in their style", not on generic keywords like "write code" or "review PR".
- `disable-model-invocation: true` by default. Opt out only if the user explicitly wants their mode to apply on every turn.
- Name tools by what they do and models by size, the way the **go** skill does, so the mode works in every harness.
- In astack, run `scripts/check` from the repository root and fix what it reports.

### 5. Iterate on prose

Apply the **unslop** skill and the authoring playbook's rules to every line.

Show the draft to the user and take feedback. Expect multiple iterations. Cut ruthlessly. A mode skill is not a manual.

### 6. Land it

Work on a branch off main, in its own worktree. Commit and open a PR. Don't push to main directly. For a personal skill, tell the user to rerun `setup` after it lands so every harness links the new skill.

## Guardrails

- **Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it.
- **Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational.
- **Reference, don't inline.** Name the other skills the user relies on as "the **name** skill", not pasted excerpts. Same for any principle docs they maintain elsewhere.
- **Keep sections minimal.** Only add a section if the user has a specific, non-default rule there. "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is.
- **Name conventions generic.** Use "the user" or "the human" in imperatives, not the author's first name.
- **Don't force symmetry.** If a user has no process rules worth writing down, skip the Process section entirely.

## Evaluation

A `-mode` skill is subjective output. The Eval playbook's benchmark loop isn't useful here. Vibe-check with the user. Does it read like them? Did it miss anything? Then ship.

Run a description-optimization loop only if the skill's trigger accuracy turns out to be a problem in practice.

## When not to use

- User wants a task-specific skill, not working conventions. Use the Authoring a skill playbook alone, with no mining.
- User wants to capture one narrow workflow (e.g. "how I write commit messages"). That's a regular skill, not a mode skill.

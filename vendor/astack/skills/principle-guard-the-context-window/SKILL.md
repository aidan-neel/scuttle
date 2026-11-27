---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk work to subagents (in T3 Code, delegates) and keep summaries in the lead, not raw payloads."
disable-model-invocation: true
---

# Guard the Context Window

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Your context window is your working memory. Reasoning degrades long before it fills, compaction drops the detail you needed and keeps the noise you didn't, and an overflow halts the work. Spend the window on decisions, not raw material.

- **Read narrowly.** Search before you open a file, then read the range you need. Don't reread what you already hold. Send long command output to a file, or through `grep`, `head`, or `tail`, instead of printing all of it.
- **Route bulk to subagents.** Sweeps across many files, long logs, full test output, dependency source, and research fan-out go to a subagent with a narrow brief. Ask for the conclusion and the evidence it rests on (paths, line numbers, the failing line), not the payload. In T3 Code, work that can run while you continue goes to a delegate in the background.
- **Keep the summary in the lead.** The lead holds the goal, the decisions made, and each child's findings in a few lines. Read a child's report, check what it claims, and keep your own summary. Never paste a child's dump into your context or the user's reply.
- **Size phases and cap scope.** Limit files per phase, set turn budgets, and count what each mechanism costs (a full test run, a screenshot, a large diff, a verbose tool) before you reach for it.
- **Write state down.** Before a long phase, put the plan, the decisions, and the open questions in a file in the repository, so a compacted or fresh session resumes from the file and not from memory.

The test: for each large thing in your context, would you miss it if a three-line summary replaced it? If not, it belonged in a child or a file.

---
name: research
description: Deep, cited technical research across arXiv papers, GitHub repositories, issues and PRs, X threads, engineering blogs, and official docs. Synthesizes verified findings, tradeoffs, and concrete recommendations. Use for /research, $research, or when asked to research papers, repos, X posts, or technical approaches.
---

# Research

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Investigate a technical question across external sources and produce a cited decision brief. Do not edit project code during a research run.

## 1. Frame the question

Restate the goal, the target system or decision it serves, and 2 to 4 concrete sub-questions. If the scope is broad, state your focus and proceed without asking.

## 2. Plan source lanes

Match the question to the source types it needs. Read [`references/sources.md`](references/sources.md) for fetch commands and fallbacks per source.

- **arXiv and papers.** Verify exact arXiv IDs, authors, year, benchmark setup, ablation numbers, and stated limitations. Prefer HTML renderings (`arxiv.org/html/<id>` or `ar5iv`) over raw PDFs for tables and equations. Check newer citations or follow-up work when a paper is older than a year.
- **GitHub.** Inspect real source files, schemas, issues, PRs, and release notes with the forge CLI (`gh`) or raw file fetches. Never rely on a README alone when implementation details matter.
- **X and practitioner discussions.** Search by topic, author handle, paper title, or repo name to surface field reports, counterexamples, and benchmarks. Follow links to primary sources whenever present. Mark uncorroborated social claims as unverified.
- **Docs, RFCs, and engineering posts.** Prefer primary specs, changelogs, and first-party engineering write-ups over secondary summaries. Record publication dates so stale guidance is obvious.

## 3. Fan out without flooding context

Apply the **principle-guard-the-context-window** skill.

- For a narrow single-paper or single-repo lookup, run it directly.
- For multi-angle research (for example, literature plus codebase audit plus production patterns), spawn read-only subagents in parallel on the `medium` or `large` size with disjoint source lanes. Each brief names the goal, its exact source lane, the evidence bar, and the report shape, and forbids editing files.
- Keep raw fetches and long transcripts inside subagents. Hold only verified conclusions, numbers, and citations in the lead.

## 4. Verify and synthesize

- Label claims with their basis: verified (URL, arXiv ID, commit, or `file:line`), measured, or inferred. Never fabricate an arXiv ID, benchmark score, author, or URL.
- Separate what a source claims from what fits the user's real architecture and constraints.
- Include failure modes, negative results, and operational costs alongside benefits.
- When a comparison, trend, or architecture is clearer visually, **show the user** a chart or diagram.
- Apply the **unslop** skill to the final brief.

## Reply

Structure the brief with these sections, dropping empty ones:

1. **Bottom line.** 3 to 5 direct takeaways answering the user's question.
2. **Findings.** Grouped by angle or source class, with inline citations and dates.
3. **Tradeoffs.** A comparison table across approaches (mechanism, impact, cost, fit).
4. **Recommendations.** Prioritized (`P0`, `P1`, `P2`) concrete actions tied to the target system.
5. **Sources.** Grouped list of verified links (Papers, GitHub, X and blogs, Docs).
6. **Gaps.** Sources that were paywalled, login-gated, or could not be verified.

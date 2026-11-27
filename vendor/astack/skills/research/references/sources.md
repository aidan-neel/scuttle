# Research source recipes

Concrete commands and verification checks by source type. Use sanctioned public APIs and endpoints only. If a source requires login or hits an anti-bot gate, note the gap instead of trying to bypass it.

## arXiv and academic papers

- **Search by query (Atom XML API):**
  ```sh
  curl -sS "https://export.arxiv.org/api/query?search_query=all:context+compaction+agents&start=0&max_results=10&sortBy=submittedDate&sortOrder=descending"
  ```
- **Fetch metadata for a known ID:**
  ```sh
  curl -sS "https://export.arxiv.org/api/query?id_list=2310.08560"
  ```
- **Read full paper text cleanly:**
  1. Check `https://arxiv.org/html/<id>` first (fast, preserves equations and tables).
  2. Fall back to `https://ar5iv.labs.arxiv.org/html/<id>` for older LaTeX submissions.
  3. Fall back to the abstract page `https://arxiv.org/abs/<id>` or PDF text extraction when no HTML build exists.
- **Verify:** exact arXiv ID, publication or revision date (`v1`/`v2`), authors, dataset or benchmark name, baseline compared against, and stated limitations.

## GitHub repositories, code, issues, and PRs

- **Search repos and code:**
  ```sh
  gh search repos "agent memory sqlite" --sort stars --limit 10
  gh search code "compaction" --repo owner/repo --limit 15
  ```
- **Inspect repo metadata, releases, and source files:**
  ```sh
  gh api repos/owner/repo --jq '{stars: .stargazers_count, pushed: .pushed_at, license: .license.spdx_id, desc: .description}'
  gh release list --repo owner/repo --limit 5
  gh api repos/owner/repo/contents/path/to/file.ts --jq '.content' | base64 -d
  ```
- **Inspect issues and PRs for real failure modes:**
  ```sh
  gh issue list --repo owner/repo --search "context OR memory" --limit 10
  gh pr view 123 --repo owner/repo --json title,body,mergedAt,files
  ```
- **Verify:** commit SHA or release tag, file path and line range, and whether a feature is merged or only proposed in an issue.

## X (Twitter) and practitioner threads

- **Discovery:** Use web search scoped to `site:x.com` or `site:twitter.com` with author handles, paper IDs, or repo names (for example, `site:x.com "context engineering" OR "compaction" agent`).
- **Triage:** Treat X posts as leads to primary artifacts (arXiv links, GitHub commits, blog posts, eval repos). Follow and verify the linked primary artifact whenever one exists.
- **Labeling:** If a technical claim exists only in a post without a reproducible repo or paper, cite the author and date and mark it as a practitioner report rather than a verified benchmark.

## Engineering blogs, docs, and RFCs

- Prefer official docs, RFCs, changelogs, and first-party engineering blogs (model providers, runtime authors, database maintainers).
- Record the publication or last-updated date. Fast-moving areas (model APIs, prompt caching, agent harnesses) go stale within months.
- Cross-check API flags, limits, and pricing against current official reference docs before recommending them.

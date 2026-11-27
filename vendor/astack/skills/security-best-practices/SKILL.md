---
name: security-best-practices
description: Security and privacy rules for secrets, input, output, privacy, network isolation, containers, and dependencies. Use when handling secrets or credentials, external input, auth, logging, file paths, subprocesses, network access, uploads, or user data, or when reviewing a change for security.
---

# Security best practices

Apply the **principle-boundary-discipline** skill first.

| Rule | Summary |
|------|---------|
| No committed secrets | No secrets, `.env` files, keys, tokens, or customer data in git. A found secret goes to a human. Rotating it matters more than deleting the line. |
| Secrets live outside the app | In a secrets manager or the deploy platform's secret store, referenced by name. Dev defaults only when production refuses to start with them. |
| Schema at the boundary | Parse external input with a schema and reject unknown shapes. |
| Allow-list | Hosts, file types, formats, and arguments. Never a deny-list. |
| Confined paths | Resolve symlinks and `..`, then confine to the workspace or work directory. |
| Bound what strangers spend | Request and output size, runtime, concurrency, queue length, storage, and per-client rate. |
| No shells | Argument arrays only. |
| No truncated actions | Never run tool calls from a model response that hit its token limit or was refused. |
| Quiet output | Public errors are stable codes, never stack traces or paths. No prompts, file contents, credentials, or personal data in logs at `info` and above. Set a CSP. |
| Private by default | No third-party analytics, trackers, or ads. Store the minimum, document retention, enforce it in code, honor `DO_NOT_TRACK`. |
| Isolated networks | No outbound network for services that handle untrusted input unless they need it. Internal workers sit behind the gateway that enforces rate limits. |
| Hardened containers | Non-root with a fixed UID, multi-stage, pinned base images. |
| Established auth and crypto | Always from a maintained library, never home-grown. |

Details: [references/guide.md](references/guide.md).

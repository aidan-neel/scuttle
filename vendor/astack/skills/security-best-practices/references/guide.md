# Security and privacy

## Secrets

- Never commit secrets, `.env` files, private keys, tokens, or customer data. `.gitignore` and `.dockerignore` both exclude `.env`.
- Production secrets live in a secrets manager or the deploy platform's secret store, and reach the app as environment variables or mounted files. The repository references them by name only.
- Development defaults (a dev auth secret, a local database password) are allowed only when the app refuses to start with them in production.
- If you find a committed secret, stop and tell a human. Rotating it matters more than deleting the line, because git history keeps it.

## Input

- Parse external input with a schema at the boundary. Reject unknown shapes rather than guessing.
- Allow-list hosts, file types, output formats, and command arguments. A deny-list is a list of bugs you haven't found yet.
- Confine file paths to the workspace or work directory after resolving symlinks and `..`.
- Bound everything a stranger can make you spend: request size, output size, runtime, concurrency, queue length, storage, and requests per client.
- Never pass user input through a shell. Use argument arrays.
- Don't run tool calls or actions from a model response that was truncated at its token limit or refused.

## Output

- Public error responses are stable codes and friendly messages, never stack traces, command output, or internal paths.
- Logs at `info` and above never contain prompts, file contents, credentials, or personal data. Redact credentials in anything sent to a remote model.
- Set a CSP. Bundle fonts and assets where the CSP is `self`-only.

## Privacy

- No third-party analytics, trackers, or ads on anything you publish.
- Store only what the feature needs. Write down what's stored and for how long in user-facing docs, and enforce the retention in code.
- Prefer memory-only state for anything ephemeral (jobs, rate limits).
- Telemetry is anonymous, documented, and honors `DO_NOT_TRACK`.

## Network isolation

- A service that processes untrusted input gets no outbound network unless it needs it: a Kubernetes NetworkPolicy, a container network with egress off, or the platform's equivalent.
- Never expose an internal worker directly. It sits behind the gateway or ingress that enforces auth and rate limits.

## Containers

Run as a non-root user with a fixed UID. Use multi-stage builds, so the runtime image carries only the build output and what it executes. Pin base image versions.

## Dependencies

Each runtime dependency is attack surface that ships to users. Prefer small, maintained, widely used packages, check that the license is compatible, and pin versions in the lockfile. Auth, crypto, and session handling always come from an established library, never home-grown.

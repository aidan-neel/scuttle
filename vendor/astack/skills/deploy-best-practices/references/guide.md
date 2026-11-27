# Deployment

These rules fit services that ship as container images built in CI. The Kubernetes sections apply when the service runs on Kubernetes, usually through GitOps (Flux, Argo CD, or similar). Adapt the names to the repository's own pipeline, and follow its `AGENTS.md` where it is more specific.

## Know what a merge ships

Before you push, find out what the default branch deploys and when. Read the CI workflows and the repository's docs. Where every push to the default branch deploys, anything merged ships within minutes, so run the full check first and ask before a push that deploys.

## Who owns what

The application repository owns its source, its `Dockerfile`, the image build workflow, and its own deploy manifests. Shared infrastructure (namespaces, ingress and TLS, rate limits, secrets, databases and backups) often lives in a separate infrastructure repository or in the hosting platform's settings.

An application change needs no infrastructure change unless it adds a secret, a public route, a database, or a namespace. When it does, say so in the PR and describe the change. Don't invent manifests or settings for things another repository or platform owns.

## Image pipeline

A typical pipeline:

1. A push to the default branch runs the image workflow, which builds and pushes `<registry>/<image>:sha-<commit>`.
2. The workflow pins that tag in the deploy manifest (for example `newTag` in a `kustomization.yaml`) and commits it as a bot.
3. The deploy controller or platform sees the change and rolls it out.

So:

- **Deploy immutable tags.** Every deploy names an image by its commit. A moving tag like `latest` or `main` makes rollback and audit guesswork.
- **Never edit the pinned tag by hand.** The bot owns it. A workflow that ignores pushes changing only that file won't rebuild on a hand edit either.
- **The Dockerfile runs the checks.** Build stages run tests, type checks, and lint before the final build, so a broken change can't produce an image.

## Images

- Multi-stage builds. The runtime image (`node:<version>-alpine`, `alpine`, or distroless) carries only the build output and what it executes.
- Run as a non-root user with a fixed UID. `EXPOSE` the real port, and keep one port convention across the repository's services.
- Every service has a `/healthz` endpoint for readiness and liveness checks.
- Configuration comes from environment variables documented in the repository, with production-required values validated at startup, so a missing value fails the deploy, not the first request.

## Kubernetes manifests

- Plain Kustomize. Render with `kubectl kustomize deploy/k8s` and read the output before you push.
- When an infrastructure repository applies the app's manifests into a namespace, don't set `namespace` in the app's own manifests.
- Set resource requests and limits, a read-only root filesystem where possible, and a size-limited `emptyDir` for scratch space.
- Any pod handling untrusted input gets a NetworkPolicy. Default to no egress.

## CI

Pin actions to a version (`actions/checkout@v5`, or a commit SHA for third-party actions). Grant each workflow only the permissions it needs (an image-and-pin workflow needs `contents: write` and `packages: write`). Use `concurrency` so two deploys of the default branch can't race.

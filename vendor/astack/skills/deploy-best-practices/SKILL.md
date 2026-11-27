---
name: deploy-best-practices
description: Shipping services as container images through CI, with Kubernetes manifests where the service runs on Kubernetes. Use when reading or editing a Dockerfile, a compose file, deploy or Kubernetes manifests, or a CI workflow that builds, publishes, or deploys.
---

# Deploy best practices

Apply the **security-best-practices** skill too. Deploy config is where secrets, images, and network exposure meet.

| Rule | Summary |
|------|---------|
| Know what deploys | Find out what a merge to the default branch ships before you push. Run the full check first. Ask before a push that deploys. |
| Immutable images | Tag each image with its commit (`sha-<commit>`). Deploy that tag, never a moving one. |
| Never hand-edit bot pins | When a workflow commits the deployed tag, the bot owns that line. |
| The Dockerfile checks | Build stages run tests, type checks, and lint, so a broken change can't produce an image. |
| Small images | Multi-stage, minimal runtime, non-root with a fixed UID, a real `EXPOSE`, and a `/healthz` endpoint. |
| Validated config | Environment variables documented in the repository, with production values validated at startup. |
| Infrastructure stays where it lives | A change that needs a new secret, public route, database, or namespace says so in the PR. Don't invent config another repository or platform owns. |
| Plain Kustomize | On Kubernetes, check with `kubectl kustomize`. Requests, limits, a read-only root filesystem, and size-limited `emptyDir`. |
| No egress for untrusted input | A service that handles untrusted input gets no outbound network unless it needs it. |
| Tight CI | Actions pinned to a version, least permissions, and `concurrency` so two deploys can't race. |

Details: [references/guide.md](references/guide.md).

# Go

Go is for small, sandboxed services where a single static binary and a tiny image matter, such as a worker that converts untrusted files.

## Toolchain

- The Go version in `go.mod` matches the builder image (`golang:<version>-alpine`).
- `gofmt` and `go vet` are not optional. `go test ./...` runs in the Docker build, so a failing test fails the image.
- Build with `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`.

## Structure

- `cmd/<binary>/main.go` reads configuration from the environment (with defaults), wires dependencies, and handles signals. Nothing else reads the environment.
- Everything else lives under `internal/`, split by responsibility (`app` for HTTP, `executor` for subprocesses, `safety` for input validation).
- Keep input validation in its own package of pure functions, so it can be tested exhaustively.

## Style

- Standard library first. A dependency needs a reason the standard library can't meet.
- Sentinel errors (`var ErrInvalidInput = errors.New(...)`) for conditions callers branch on. Wrap with `fmt.Errorf("...: %w", err)` and check with `errors.Is`.
- Every external call and subprocess takes a `context.Context` with a deadline.
- Never build a shell command string. Call `exec.CommandContext` with an argument slice, and allow-list every argument that came from a user.
- Set every `http.Server` timeout (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`) and `MaxHeaderBytes`. Shut down gracefully on `SIGTERM`.
- Public error responses are stable machine codes (`file_too_large`, `rate_limited`). Never return internal command output or stack traces to clients. See the **security-best-practices** skill.

## Tests

Table-driven tests in `*_test.go` next to the code. Fake subprocesses and the clock through interfaces. Don't shell out to a real `ffmpeg` in unit tests. See the **testing-best-practices** skill.

## Images

Use a multi-stage build. Build in `golang:<version>-alpine` and run in `alpine` (or distroless) as a non-root user with a fixed UID that owns only its working directory. See the **deploy-best-practices** skill.

# Scuttle

Scuttle is a fast, easily installable local-first app running across **web** and **local desktop** (Electrobun), powered by a **React + Vite + TanStack Router** frontend, a **TypeScript + Effect 4 (Bun)** backend, and **Rust** where native performance matters.

## Stack & Layout

- `apps/web` — React 19 + React Compiler + Vite + TanStack Router + Tailwind CSS v4 + Base UI. Pure client SPA that runs identically in a browser or inside Electrobun.
- `apps/desktop` — Electrobun v2 desktop shell (`hutch.config.ts`, `electrobun.config.ts`). Runs `@scuttle/server` in-process inside the Bun main process, hosts `apps/web`, and exposes a narrow `DesktopBridge`.
- `apps/server` — Bun + Effect 4 backend. Owns SQLite (`bun:sqlite` in WAL mode), domain services, WebSocket/HTTP RPC, and serving `apps/web/dist` in standalone CLI/web mode.
- `packages/contracts` — Shared `effect/Schema` wire contracts and the `DesktopBridge` contract.
- `packages/client-runtime` — Shared connection supervisor, RPC client, and client domain state.
- `packages/shared` — Small pure TypeScript utilities and branded IDs (subpath exports, no heavy deps).
- `crates/scuttle-native` — Rust workspace for performance-critical native capabilities.

## Architecture Rules

1. **One strict boundary.** Execution, persistence, filesystem, git, and process work belong in `apps/server` (or `crates/` called by it). Never reach around the server from `apps/web`.
2. **Same UI on web and desktop.** `apps/web` must run cleanly in a plain browser with `getDesktopBridge() === null`. Desktop-only capabilities live behind `DesktopBridge` in `packages/contracts` and degrade gracefully on web.
3. **Never bake localhost origins into `apps/web`.** Dev is single-origin: Vite proxies `/api` and `/ws` to `apps/server`. Hardcoding `http://localhost:...` in UI code breaks remote and packaged builds.
4. **Thin transport handlers.** HTTP routes, WebSocket RPC handlers, CLI entrypoints, and Electrobun IPC handlers only decode input, call one Effect service method, and map errors. Domain logic lives in Effect services.
5. **Effect 4 service conventions.**
   - Import Effect modules from subpaths: `import * as Effect from "effect/Effect"`, never `import { Effect } from "effect"`.
   - Define services with `Context.Service`, errors with `Schema.TaggedError`, and service operations with `Effect.fn("Service.operation")`.
   - Keep runtime boundaries (`BunRuntime.runMain`, `ManagedRuntime`, `runPromise`) strictly at app entrypoints, never inside domain services.
6. **Type discipline.**
   - Model state with discriminated unions (`kind` / `_tag`) and branded IDs from `effect/Schema` — no optional-field bags.
   - No `any`, no unvalidated `as` casts. Parse external input at boundaries with `effect/Schema`.
   - Prefer inferred types over redundant annotations.
7. **React & UI discipline.**
   - Rely on React Compiler — avoid manual `useMemo` / `useCallback` unless profiling proves a specific need.
   - Use `useEffect` only to synchronize with external systems, never to derive render state.
   - Avoid continuously repainting CSS animations.
   - Keep UI primitives in `apps/web/src/components/ui` owning their variants; pass layout classes from parents.
8. **Rust discipline.**
   - Use Rust only where native performance or OS access justifies the boundary (PTY, file watching, search/indexing, system metrics).
   - Keep binaries thin and domain logic in library modules. No `unwrap()` / `expect()` on external input; no `unsafe` without a documented invariant.
9. **Code hygiene.**
   - Keep source files under **500 lines** (`bun run check:file-length` enforces this). Split by responsibility before a file grows past the limit.
   - Keep `*.test.ts(x)` files under each package or app's `tests/` directory, never alongside `.ts` files in `src/` (`bun run check:test-layout` enforces this).
   - Default to **no comments**. Add a short comment only to explain a non-obvious constraint, external quirk, or invariant the code cannot express.
   - Libraries over hand-rolled crypto, parsing, validation, or accessible widgets.
10. **Clean-room identity.** Scuttle takes architectural inspiration from open-source tools (such as MIT-licensed T3 Code), never their trademarks, branding, or copy-pasted boilerplate. Every module we port or rewrite must fit Scuttle's own boundaries and naming.

## Verification

Run before finishing any change:

```bash
bun run check          # fmt:check + lint + typecheck + test + rust:check + check:file-length
```

For fast iteration:

- `bun run dev` — starts `@scuttle/server` and `@scuttle/web` together (single-origin on `:5173`).
- `bun run desktop:prepare` — projects the Electrobun v2 Hutch devkit into `apps/desktop/.hutch/devkit`.
- `bun run dev:desktop` — runs `@scuttle/server` + `@scuttle/web` and launches Electrobun. Inside WSL, it automatically stages and launches the **native Windows WebView2** desktop shell (`%LOCALAPPDATA%\Scuttle\desktop-dev`) pointing at WSL's Vite dev server (`SCUTTLE_DESKTOP_FORCE_LINUX=1` forces Linux/WSLg).
- `bun run test` — runs Bun unit tests across packages and apps.
- `bun run rust:check` — runs `cargo fmt --check`, `cargo clippy -- -D warnings`, and `cargo test`.

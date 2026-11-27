<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/hero-dark.svg" />
  <img src="docs/brand/hero-light.svg" alt="Scuttle" width="640" />
</picture>

**Fast, local-first workspace for coding agents across web and desktop.**

[Quick Start](#quick-start) · [Stack](#stack) · [Checks](#checks)

<br />

<img src="docs/screenshot.png" alt="Scuttle workspace" width="100%" />

</div>

## Quick Start

Requires [Bun](https://bun.sh/) `>= 1.4` and [Rust](https://rustup.rs/) `1.94.1` (auto-selected via `rust-toolchain.toml`).

```bash
bun install
bun run desktop:prepare
bun run dev
```

Launch the native Electrobun desktop shell in live-reload dev mode.

```bash
bun run dev:desktop
```

Compile and install/update the standalone desktop app in-place (supports WSL -> native Windows WebView2 with Start Menu shortcut; re-run anytime to update):

```bash
bun run desktop:compile          # compile & install/update Scuttle Dev
bun run desktop:install          # compile, install/update, and launch
bun run desktop:compile -- --installer   # also build Windows Setup.exe
bun run desktop:uninstall        # remove installed dev app & shortcuts
```

## Stack

| Layer                            | Technologies                                                              |
| :------------------------------- | :------------------------------------------------------------------------ |
| Web (`apps/web`)                 | React 19, React Compiler, Vite, TanStack Router, Tailwind CSS v4, Base UI |
| Desktop (`apps/desktop`)         | Electrobun v2 hosting the same SPA with an in-process backend             |
| Server (`apps/server`)           | Bun, Effect 4, SQLite (WAL), WebSocket and HTTP RPC                       |
| Native (`crates/scuttle-native`) | Rust workspace for performance-critical OS and native tasks               |

## Checks

```bash
bun run check
```

# Scuttle

Local-first web and desktop workspace built with **React + Vite + TanStack Router**, **TypeScript + Effect 4 (Bun)**, **Electrobun v2**, and **Rust**.

## Prerequisites

- [Bun](https://bun.sh/) `>= 1.4`
- [Rust](https://rustup.rs/) `1.94.1` (auto-selected via `rust-toolchain.toml`)

## Quick Start

```bash
# Install JS/TS dependencies
bun install

# Prepare the Electrobun v2 Hutch devkit (needed once for desktop typecheck & dev)
bun run desktop:prepare

# Run web + Effect backend together (http://localhost:5173)
bun run dev

# Run the native Electrobun desktop app
bun run dev:desktop
```

## Checks

```bash
bun run check
```

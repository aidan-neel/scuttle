---
name: svelte-best-practices
description: Svelte 5, SvelteKit, and Tailwind best practices for runes, components, accessibility, styling, and component libraries. Use when reading or editing any .svelte file, a SvelteKit route (+page, +layout, +server), or a Svelte app's styles, or when building web UI in a Svelte project.
---

# Svelte best practices

Load the **typescript-best-practices** skill too, because Svelte files are TypeScript. The **code-best-practices** skill sets the file-length and duplication rules.

| Rule | Summary |
|------|---------|
| Runes only | `$props()`, `$state()`, `$derived()`, `$effect()`. No `export let`, `$:`, or stores for component-local state. `<script lang="ts">` everywhere. |
| Typed props | Type props and their defaults inline in the `$props()` destructure. |
| Snippets, not slots | `{@render children?.()}` and `Snippet` props. |
| `$derived` computes | `$effect` only syncs with the outside world (DOM, timers, subscriptions). |
| Adapter fits the target | The adapter for where the app deploys. `@sveltejs/adapter-node` for a container, with `/healthz` and `ORIGIN` set in production. |
| Server code stays server-side | Under `src/lib/server/`. Mutations go through form actions or `+server.ts`, with authorization in shared guards. |
| Markup used twice is a component | Shared components live in `src/lib/components/`, one per file. Extend an existing one before making a near-copy. |
| Pages compose | `+page.svelte` arranges components. Formatting, validation, and fetching live in `.ts` modules under `src/lib/`. |
| Small components | Over about 200 lines usually means two jobs. Hard limit 500. |
| Library widgets | The repository's chosen library first, then a popular Svelte 5 library, then your own built from primitives. One primary library per app. |
| Accessible every time | Real elements, labels, visible focus, a skip link, `aria-live` for status, 320px and 200% zoom, `prefers-reduced-motion`, `alt` text. |
| Tailwind only | Utilities in markup, tokens and base styles in `src/app.css` layers. No plain stylesheets or `<style>` blocks a utility can replace. |
| Tokens in one place | Colors, type, and spacing live as tokens in `src/app.css` and the library theme. Components use the tokens, never raw values. |
| Biome plus svelte-check | Svelte files turn off Biome's unused-import and unused-variable rules. `svelte-check` covers the template. |

Details: [references/guide.md](references/guide.md).

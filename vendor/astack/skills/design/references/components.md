# Component recipes

The values are the default style's, from the tokens in [style.md](style.md). In another style, keep each recipe's structure and behavior and re-skin it with the [style spec](style-spec.md)'s tokens. Snippets assume `import { motion, AnimatePresence } from "motion/react"` and a `cn()` class joiner. Translate them into the project's stack. For app shells, see [sidebar.md](sidebar.md). For focus rings and field errors, see [interaction.md](interaction.md).

## Button [seen]

Marcel Kargul's secondary button: 30px tall, 10px radius, 14px medium text, a vertical gradient `#FFFFFF → #F7F7F7`, no stroke, and two shadows: `0 1px 2px` at 8% `#282828`, plus a 0-blur 1px spread in `#ECECEC`. The recipe builds it from `--bg-raised → --bg-subtle` and `--shadow-btn`, so it follows the theme.

```tsx
export function Button({ variant = "secondary", className, ...props }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", visualDuration: 0.15, bounce: 0 }}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-medium select-none outline-none",
        "transition-[background,box-shadow,color] duration-150 ease-out",
        "focus-visible:shadow-[var(--shadow-focus),var(--shadow-btn)]",
        variant === "secondary" && "bg-gradient-to-b from-[var(--bg-raised)] to-[var(--bg-subtle)] text-[var(--fg)] shadow-[var(--shadow-btn)] hover:to-[var(--bg-muted)]",
        variant === "primary" && "bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--shadow-btn-primary)] hover:bg-[var(--accent-hover)]",
        className,
      )}
      {...props}
    />
  );
}
```

```css
.btn { height: 30px; padding: 0 12px; border: 0; border-radius: 10px; font: 500 14px/1 var(--font-sans);
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;
  transition: transform 150ms var(--ease-out), box-shadow 150ms var(--ease-out), background-color 150ms var(--ease-out); }
.btn:active { transform: scale(0.97); }
.btn:focus-visible { outline: none; box-shadow: var(--shadow-focus), var(--shadow-btn); }
.btn--secondary { background: linear-gradient(var(--bg-raised), var(--bg-subtle)); color: var(--fg); box-shadow: var(--shadow-btn); }
.btn--primary { background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow-btn-primary); }
@media (hover: hover) { .btn--primary:hover { background: var(--accent-hover); } }
```

The primary label is `--accent-fg`, never a literal white, because orange, lime, and coral need dark text ([style.md](style.md)). Loading keeps the width fixed and swaps the label for a 14px spinner (blur 2px→0, y 6→0). Disabled is 50% opacity with no hover or press.

## Input

```css
.input { height: 40px; width: 100%; border: 0; border-radius: 10px; padding: 0 12px; font-size: 14px;
  background: var(--bg); box-shadow: var(--shadow-btn); transition: box-shadow 150ms var(--ease-out); }
.input::placeholder { color: var(--fg-tertiary); }
.input:focus { outline: none; box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--ring); }
.input[aria-invalid="true"] { box-shadow: 0 0 0 1px var(--danger), 0 0 0 4px color-mix(in oklab, var(--danger), transparent 85%); }
```

This works for a bare input. Once the input sits inside a visible box (search bar, composer, input with an icon or button), the box takes the ring and the input takes none. See [interaction.md](interaction.md#focus-rings). Input text is 16px on mobile so iOS doesn't zoom.

## Segmented control and tabs

A `--bg-muted` track with 4px padding and a 10px radius. The thumb is a `--bg-raised` 8px-radius pill with `--shadow-btn`, shared by `layoutId` so it slides between options (spring `visualDuration .25, bounce .15`). Labels are 13px medium, inactive `--fg-secondary`. Without Motion, move one absolutely positioned thumb with `transform`.

## Card and KPI tile

```tsx
<div className="rounded-2xl bg-[var(--bg)] p-4 shadow-[var(--shadow-card)]">
  <p className="text-[13px] text-[var(--fg-secondary)]">Total balance</p>
  <p className="mt-2 font-mono text-[28px] font-medium tracking-[-0.02em] tabular-nums">$83,820.35</p>
  <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--success-soft)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--success-fg)]">▲ +30.5%</span>
  <span className="ml-1.5 text-[12px] text-[var(--fg-secondary)]">since Jan 1</span>
</div>
```

One container level. Whitespace and hairlines inside, never a card in a card.

## Status tag [seen]

```css
.tag { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px; font: 500 12px/1 var(--font-sans);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, currentColor, transparent 85%); }
.tag--success { color: var(--success-fg); background: var(--success-soft); }
.tag--danger  { color: var(--danger-fg);  background: var(--danger-soft); }
.tag--info    { color: var(--info-fg);    background: var(--info-soft); }
```

Never white text on a saturated tag. Pair the color with a word or icon so status doesn't rely on color alone.

## Popover, menu, command palette

```tsx
<AnimatePresence>
  {open && (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: "easeOut" } }}
      transition={{ type: "spring", visualDuration: 0.2, bounce: 0 }}
      style={{ transformOrigin: "var(--radix-popover-content-transform-origin, top)" }}
      className="rounded-xl bg-[var(--bg-raised)] p-1 shadow-[var(--shadow-pop)]"
    />
  )}
</AnimatePresence>
```

Scale from 0.95–0.97, never from 0. Origin at the trigger. Exits faster than enters. Build on a real primitive (Radix, Base UI, Bits UI, Ariakit), not hand-rolled divs. Hovered and keyboard-highlighted rows share one `bg-[var(--bg-muted)] rounded-lg` highlight.

Command palette: 24px radius, an `ESC` keycap (`h-6 px-1.5 rounded-md bg-[var(--bg-subtle)] shadow-[var(--hairline)] text-[12px]`), grouped results, a keycap legend footer. A palette opened by a keyboard shortcut gets no animation, or under 120ms of opacity only.

## Modal and sheet

- **Desktop modal.** Overlay `rgb(0 0 0 / .4)` fades in over 200ms. The panel goes from `opacity 0, scale .96, y 8` to rest on a spring (`visualDuration .3, bounce .1`), from the center. Radius 20–24px. Focus moves in and returns to the trigger on close.
- **Mobile sheet.** `y: 100% → 0` with `--ease-drawer` over 400–500ms, or spring `{ stiffness: 400, damping: 40 }`. Drag down to dismiss on distance or velocity. Top radius 24–32px with a 36×5px `--border-strong` grab handle.

## Toast [seen]

An inverted pill, dark on light UI and light on dark UI: `bg-[var(--fg)] text-[var(--fg-inverse)] rounded-[10px] h-9 px-3 text-[13px] shadow-[var(--shadow-pop)]`, with an `Undo` button on `bg-[color-mix(in_oklab,var(--fg-inverse),transparent_90%)]`. Enter from `y 16, opacity 0, scale .96` on spring `visualDuration .35, bounce .15`. Exit to `opacity 0, y 8` in 150ms. Stacked toasts scale down 0.05 per level and peek 8px [expert]. Errors and toasts with actions stay until dismissed.

## Skeleton and loading [seen: "subtle loading animation. not overdone"]

```css
.skeleton { border-radius: 8px; background: linear-gradient(90deg, var(--bg-muted) 0%, var(--bg-subtle) 50%, var(--bg-muted) 100%);
  background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
```

Skeletons copy the final layout exactly: same heights, radii, and gaps. Crossfade real content in over 200ms. Show a spinner only after about 300ms of waiting so fast loads never flash [expert].

## Mobile primary CTA

`h-[52px] w-full rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[16px] font-medium` with a faint top highlight and `active:scale-[0.98]`. Pin it to the bottom with 16px side insets, safe-area padding, and a fade-to-background gradient behind it [seen]. A hold-to-confirm action fills an overlay with `scaleX 0→1` over about 1.2s linear while held and snaps back in 200ms ease-out on release [inferred].

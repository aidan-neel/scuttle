# Motion

Motion is part of the product, not decoration. The default style's captions show it matters ("idea → design → animation", "micro-interactions throughout") but publish no curve values. Every number here is [expert]: Motion docs, Emil Kowalski, and Apple HIG, tuned to a calm, precise feel. When the [style spec](style-spec.md) sets a motion character (static, calm, snappy, or playful) or the project has its own motion language, match it except where a rule below prevents a real defect: keyboard actions, ease-in on enter, interruptibility, reduced motion, and performance hold in every style.

## Should it animate?

Answer these in order before you write any animation.

1. **How often will people see it?**

   | Frequency | Decision |
   |---|---|
   | 100+ times a day (keyboard shortcuts, palette toggle) | No animation. |
   | Tens of times a day (hover, list navigation) | Remove it, or keep it under 150ms of opacity or color. |
   | Occasional (modals, drawers, toasts) | Standard animation. |
   | Rare (onboarding, celebrations) | Room for delight. |

   Never animate keyboard-initiated actions. They repeat hundreds of times and animation makes them feel slow.

2. **What is it for?** Spatial consistency (a toast leaves the way it came), state indication, explanation, feedback (a press scales down), or preventing a jarring change. "It looks cool" on something seen often is not a purpose.

3. **Which easing?** Entering or reacting: ease-out. Moving or morphing on screen: ease-in-out. Hover and color: ease. Constant motion (progress, marquee): linear. Never ease-in on UI, because it delays the first movement, the moment the eye watches most. Built-in CSS curves are too weak. Use the tokens.

4. **How fast?** Under 300ms for UI. Exits about 60–75% of the enter.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Default for enter, hover, press, popovers |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Elements moving or morphing on screen |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets and drawers (iOS-like) |
| `ease` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Slower, elegant toasts |

| Duration | ms | Examples |
|---|---|---|
| instant | 100 | Color and background hover, checkbox tick |
| fast | 150 | Press, tooltip, focus ring, exits |
| base | 200 | Popover and dropdown enter, tab switch, toggle |
| moderate | 250–300 | Modal enter, accordion, layout shifts |
| slow | 350–500 | Sheets, page transitions, hero reveals |
| showcase | 600–1200 | Marketing choreography, illustration loops |

## Springs

Use springs for anything gesture-driven or interruptible. They carry velocity and retarget smoothly. Motion supports duration springs (`visualDuration` + `bounce`) and physics springs (`stiffness`, `damping`, `mass`, which override bounce).

```ts
export const spring = {
  snappy: { type: "spring", visualDuration: 0.2, bounce: 0 },    // press, toggles, popovers
  smooth: { type: "spring", visualDuration: 0.3, bounce: 0.1 },  // modals, layout, tabs
  gentle: { type: "spring", visualDuration: 0.45, bounce: 0.15 },// toasts, entering cards
  bouncy: { type: "spring", visualDuration: 0.4, bounce: 0.3 },  // celebrations only
  sheet:  { type: "spring", stiffness: 400, damping: 40 },       // drag-release sheets
  layout: { type: "spring", stiffness: 500, damping: 40 },       // layoutId pills and indicators
} as const;
```

Keep bounce at 0.15 or less in productivity UI. Overshoot signals playfulness, so save it for success moments. Without JS, Motion can emit a spring as a CSS `linear()` easing.

## Enter and exit

| Element | Enter | Exit |
|---|---|---|
| Page section | `opacity 0→1, y 12→0`, optional blur 4px→0, 400ms ease-out | none |
| List item | `opacity 0, y 6` → rest, smooth spring | `opacity 0, scale .98`, 150ms |
| Popover, menu | `opacity 0, scale .96, y -4` → rest, 200ms, from the trigger | `opacity 0, scale .98`, 120ms |
| Modal | overlay fade 200ms, panel `scale .96, y 8` → rest, smooth spring, from center | 150ms |
| Toast | `y 16, scale .96` → rest, gentle spring | `opacity 0, y 8`, 150ms |
| Tooltip | 400–600ms delay the first time, then instant for neighbors; `opacity, scale .97`, 120ms | 80ms |
| Sheet | `y 100%→0`, 450ms `--ease-drawer` | 300ms, same curve |

- **Never scale from 0.** Start at 0.95 or more, with opacity. Nothing real appears from nothing.
- **Origin-aware popovers.** `transform-origin` at the trigger (`var(--radix-popover-content-transform-origin)`, `var(--transform-origin)` in Base UI). Modals stay centered.
- **Exits are softer.** A small fixed `translateY` (about 8–12px), not the full height. Shorter than the enter.
- **Text swaps** (button labels, states): `AnimatePresence mode="popLayout"`, in from `opacity 0, y 6, blur 2px`, out to `y -6`, about 200ms.
- **Contextual icon swaps** (copy → check, play → pause): crossfade with opacity, scale 0.25→1, and blur 4px→0 on a 0.3s spring with no bounce. Without Motion, keep both icons in the DOM, one absolutely positioned, and crossfade with CSS transitions.
- **Skip the first-render animation** on stateful toggles with `AnimatePresence initial={false}`. Keep it on intentional page entrances.
- **Blur masks a rough crossfade.** A 2px blur during the swap blends two states into one. Keep blur small, as it costs a lot in Safari.
- **`@starting-style`** animates entry without JS where browser support allows.

## Layout animation

- Motion's `layout` on elements whose size or position changes, `layoutId` for shared elements (active pills, tab underlines, card-to-detail morphs). `layout="position"` on text to avoid squash.
- Height to auto: Motion `height: "auto"`, CSS `interpolate-size: allow-keywords`, or a grid going `grid-template-rows: 0fr → 1fr`.
- When the main thread will be busy (a route change), prefer a CSS transition. JS layout animation drops frames under load.

## Gestures

- Gate hover effects behind `@media (hover: hover) and (pointer: fine)`. Touch fires hover on tap.
- Press feedback starts on pointer-down: `scale(0.97)` for buttons (0.95–0.98, never smaller), 0.98 for large cards. Spring back.
- Drag to dismiss on distance or velocity: a quick flick (velocity above about 0.11 px/ms, or Motion `velocity.y > 500`) dismisses regardless of distance. Otherwise spring back.
- Past a boundary, add friction that grows with distance instead of a hard stop.
- Capture the pointer once a drag starts. Ignore extra touch points mid-drag.
- Asymmetric timing: slow where the person decides (hold-to-delete, 2s linear), fast where the system responds (release, 200ms ease-out).

## Interruptibility

Use CSS transitions or Motion for state changes. They retarget mid-flight. Keyframes restart from zero, so keep them for one-shot sequences (a loader, a first entrance). Rapidly toggling anything must never jump or queue.

## Stagger and scroll

- Stagger list items 40–60ms apart, or semantic chunks of a section (title, text, actions) about 80–100ms apart. Cap the total near 300ms: stagger the first eight, then show the rest together. Stagger only the first reveal, never a data refresh, and never block input while it plays.
- Reveal on scroll once (`viewport={{ once: true, amount: 0.3 }}`), for hero-level content only.
- Parallax at most ±40px, never on body text.
- A sticky header goes from transparent to `bg/80` plus `backdrop-blur(12px)` and a hairline after 8px of scroll.
- Looping illustrations (Rive, Lottie) pause offscreen and under reduced motion.

## Reduced motion

Reduced motion means fewer and gentler animations, not none. Keep opacity and color fades that aid comprehension. Remove movement, scale, parallax, and autoplay.

```tsx
<MotionConfig reducedMotion="user">{children}</MotionConfig>
```

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
  .fade-ok { transition: opacity 150ms linear !important; }
}
```

Or make movement opt-in with `@media (prefers-reduced-motion: no-preference)`. For custom logic, `useReducedMotion()` and swap `x: "-100%"` for `x: 0`. Motion is never the only signal of a state change.

## Performance

- Animate `transform` and `opacity` (plus small `filter: blur` and `clip-path`). Never width, height, top, left, margin, or box-shadow in a loop. To animate a shadow, fade a pseudo-element's opacity.
- Never `transition: all`, including Tailwind's bare `transition`. Name the properties.
- `will-change` only on transform, opacity, or filter, only when you see first-frame stutter.
- Motion's `x`, `y`, and `scale` shorthands run on the main thread. Under load, animate a full `transform` string, or use CSS or WAAPI, which stay on the compositor.
- Don't update an inherited CSS variable on a container every frame. Set `transform` on the element itself.
- `backdrop-filter` and large blurs are expensive. Keep them small and few.
- Check at 4× CPU throttle. No layout shift from animation.

## Debugging

Play animations at 10% speed or frame by frame in the browser's animations panel. Look for two states visibly overlapping in a crossfade, abrupt starts or stops, the wrong transform origin, and properties out of sync. Test gestures on a real device. Review motion again with fresh eyes before you ship.

# Sidebar and nav rail

Models get sidebars wrong more than any other component. Read this whole file before you build an app shell. The measurements and tones are the default style's. The column, alignment, behavior, and mistake rules hold in any style. In the default style, look at two or three of the [sidebar images](reference-images.md#sidebars) before you build.

## Two good shells

Pick one per product. Neither is the default.

- **Inset** [seen]. The app background is tinted (`--bg-subtle`). The sidebar has no fill of its own and shares that tint. Content sits in a separate panel on `--bg`, about 8px from the viewport top, right, and bottom, radius 12–16px, a hairline plus a soft shadow (`--shadow-card`), with its own scroll. Suits calm products where content should float: CRMs, inboxes, docs, AI chat.
- **Flush** [seen]. The sidebar is a full-height surface of its own (`--bg-subtle`), separated from the content by one `--border` hairline. Content runs edge to edge. Suits dense tools: analytics, admin, IDE-like screens.

Everything below holds for both.

## What Marcel Kargul's sidebars share [seen]

- **The sidebar is quieter than the content.** It sits on the canvas tone. The content panel floats. Kargul called a "different color sidebar than the main block" "a great design pattern."
- **Top block.** A workspace or brand switcher: a 20–28px rounded-square logo, the name at 500, sometimes a muted handle on a second line, and a small `⇅` chevron or a collapse icon at the right edge.
- **Search or primary action under it.** A search input with a `/` keycap, or a full-width secondary button ("+ New timeline").
- **Section labels** are small and muted. Sentence case ("Projects") or small uppercase with tracking ("WORKSPACE"). One style per product.
- **Items.** A 16px outline icon and a 14px grey label (`--fg-secondary`). No border, no fill at rest, monochrome icons. Color only for project swatches (small rounded squares) and pinned brand logos.
- **Active item.** A soft grey fill pill (`--bg-muted` on `--bg-subtle`) or a `--bg-raised` pill with a soft shadow, plus a darker label. High-contrast variant: a `--fg` pill with `--fg-inverse` text. **Never** a colored fill with white text, and never a left accent bar.
- **Trailing meta** is right-aligned: counts as tabular grey numbers or a small badge, a `›` on an item that opens a sub-view, `⠿` drag handles on pinned items.
- **Nesting.** Children indent so their icons line up under the parent's label. Children keep icons. No tree lines.
- **Groups** separate by whitespace or one hairline (sometimes dashed). Gaps between groups are clearly bigger than gaps between items.
- **Footer** pinned to the bottom: secondary links, or settings plus a round avatar.
- **Icon rail variant.** A narrow rail: logo tile at the top, a round "+" button, about eight icon buttons in two groups split by a short hairline, the active icon in a soft tinted square, settings and avatar at the bottom. A list column may sit beside it.
- **Dark variant.** A `--bg-muted` panel with a 16–20px radius, uppercase muted labels. A dragged item lifts as a raised card with a grip.

## Measurements

| Token | Value | Tag |
|---|---|---|
| Expanded width | 240–264px (about 16–18% of a 1440 canvas) | [inferred] ratio, [expert] px |
| Collapsed rail | 56–64px, icon centered in a 32–36px hit square | [expert], rail shape [seen] |
| Item height | 32px (28 dense, 36 roomy), 44px on mobile | [expert] |
| Item radius | 8px | [inferred] |
| Item padding | 8–10px inline, 8px icon-to-label gap | [inferred] |
| Icon | 16px, 1.5 stroke, same grey as the label | [seen] style, [expert] size |
| Gaps | 2px between items, 16–24px between groups | [inferred] |
| Section label | 11–12px, 500, muted, 4px above the first item | [inferred] |
| Sidebar padding | 12px inline, 12–16px top | [inferred] |
| Inset panel | 8px margin top, right, bottom; radius 12–16; `overflow: auto` inside | [seen] shape, [inferred] px |
| Below 768px | inset removed (margin 0, radius 0), sidebar becomes a drawer | [expert] |

## Behavior and motion [expert]

- **Rows share two columns.** Every row (switcher, items, settings, account) puts its icon, logo tile, or avatar in one icon column and its text in one text column. With 10px sidebar padding and a 60px rail, 16px icons sit 12px into the row and 24px tiles 8px in, all centered 30px from the edge, and all text starts at 48px. Measure it with `getBoundingClientRect().left` on each icon and label instead of eyeballing. Because the columns never move, collapsing is just hiding text.
- **Triggers are rows.** A workspace or account trigger is a full-width row button, the same height and inset as the rows around it, with `text-align: start`. A narrower trigger whose label sits a few px off the labels below is the most common sidebar misalignment.
- **Hover.** Background to `--bg-muted` and label to `--fg` within 120ms. No movement and no scale on nav items.
- **Active change.** One shared pill slides between items (Motion `layoutId`, spring `visualDuration .25, bounce .15`). Never fade one pill out while another fades in. Without Motion, measure the `[aria-current="page"]` item and move one absolutely positioned pill with `transform`, skipping the transition on first paint. Items need `position: relative` to paint above it.
- **Collapse.** Animate width 240→60 over 220ms with `--ease-out`. This is the one place a width animation is fine (or `grid-template-columns` in a grid). Labels fade over 120ms and never wrap while shrinking (`white-space: nowrap; overflow: hidden`). Icons never move sideways. Collapsed items show a tooltip on the right on hover, none on touch. Persist the state. The toggle sits at the right of the switcher row while expanded and at the start of the top bar while collapsed. `⌘B` / `Ctrl+B` toggles it except in rich-text fields.
- **Resize.** An 8px invisible handle on the right edge (`cursor: col-resize`) shows a 2px line after about 150ms of hover. Drag with pointer capture, clamp (for example 200–320px), snap to the rail when dragged far past the minimum, reset on double-click. Turn the width transition off while dragging. The handle is a focusable `role="separator"` with `aria-valuenow`, arrow keys to resize, and Enter to toggle.
- **Nesting.** Expanding a group animates the children's height and rotates the chevron 90° in 150ms. Children stagger by 20ms at most.
- **Workspace switcher** opens a popover from its top-left origin at 0.96 scale: workspaces with logo tiles, a check on the current one, then "Create workspace" and "Log out".
- **Keyboard.** The sidebar is a `<nav aria-label>`. Items are links with `aria-current="page"`. A group toggle is a `<button aria-expanded>`. Focus shows a 2px ring inside the pill.
- **Mobile (below 768px).** Hide the sidebar. Open it as a left drawer (85% width, max 320px) over a `rgb(0 0 0 / .3)` scrim, sliding in with `translateX` over 280ms `--ease-drawer`. Close on scrim tap, Esc, or swipe. Consumer mobile apps use a floating pill tab bar with four or five items instead [seen].

## Common mistakes

Fix every one.

1. A shell that is neither inset nor flush: an inset panel with no radius or margin, an inset sidebar that also has its own fill and border, a heavy shadow on the panel, or the whole page scrolling instead of the panel. Flush with the same white on both sides of the border and no tonal difference.
2. A colored active state (`bg-indigo-600 text-white`) or a left accent bar.
3. Mixed icon sizes or styles, emoji as icons, icons not vertically centered with their text.
4. Labels that wrap to two lines. No ellipsis truncation.
5. The same gap between every item so groups don't read as groups. Or 48px items.
6. Section labels in heavy bold, or at the same size and color as items.
7. The footer floating mid-height because the sidebar isn't `height: 100dvh; display: flex; flex-direction: column` with a `margin-top: auto` footer.
8. A collapse where labels squish or wrap, icons jump sideways, or content reflows in steps.
9. No hover, focus, or active difference. No `aria-current`.
10. Fifteen top-level items with no groups. Group into three or four sections of three to six items, and move rare links to the footer.

## Code

React, Motion, and Tailwind on the [style.md](style.md) tokens. A nav item and the inset shell:

```tsx
function NavItem({ it, active, collapsed = false, onClick, expanded }) {
  const isActive = active === it.id;
  return (
    <button onClick={onClick} aria-current={isActive ? "page" : undefined} aria-expanded={expanded}
      className="group relative flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[14px] text-[var(--fg-secondary)]
                 transition-colors duration-[120ms] hover:bg-[var(--bg-muted)] hover:text-[var(--fg)]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]">
      {isActive && <motion.span layoutId="sb-pill" className="absolute inset-0 rounded-lg bg-[var(--bg-raised)] shadow-[var(--shadow-btn)]"
        transition={{ type: "spring", visualDuration: 0.25, bounce: 0.15 }} />}
      {it.swatch ? <span className="relative size-2.5 shrink-0 rounded-[3px]" style={{ background: it.swatch }} />
                 : <it.icon className="relative size-4 shrink-0" strokeWidth={1.5} />}
      <span className={cn("relative truncate transition-opacity duration-[120ms]", collapsed && "opacity-0", isActive && "text-[var(--fg)]")}>{it.label}</span>
      {!collapsed && it.count != null && <span className="relative ml-auto text-[12px] tabular-nums text-[var(--fg-secondary)]">{it.count}</span>}
    </button>
  );
}
```

```tsx
<div className="flex h-dvh overflow-hidden bg-[var(--bg-subtle)]">{/* tinted app background, shared by the sidebar */}
  <Sidebar />{/* motion.aside animating width 248 ↔ 60, no fill of its own, flex column, footer at mt-auto */}
  <main className="my-2 mr-2 flex-1 overflow-auto rounded-[14px] bg-[var(--bg)]
                   shadow-[var(--shadow-card)] max-md:m-0 max-md:rounded-none">…</main>
</div>
```

For a flush shell, drop the margins and radius on `<main>`, and give the sidebar `bg-[var(--bg-subtle)] border-r border-[var(--border)]`. On mobile, render the same `<nav>` inside a left sheet, with a hamburger in a sticky 56px top bar.

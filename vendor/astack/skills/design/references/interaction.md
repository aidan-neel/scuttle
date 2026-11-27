# Interaction states

Every interactive element has these states, in every style. Walk them one by one. The timings and scales are the default's: a [style spec](style-spec.md) sets its own motion character, so a static spec drops press scale and slides, and a playful one may overshoot. Tags follow [style.md](style.md): [seen], [inferred], [expert], and [X] where the point recurs in public critiques of AI-built UI.

## State checklist

- [ ] **Hover** (pointer devices only): color or background shifts in 100–150ms. No layout shift. Pointer cursor on clickable non-buttons.
- [ ] **Press**: `scale(0.97)` on buttons, 0.98 on large cards and CTAs, at pointer-down, 150ms ease-out, springing back.
- [ ] **Focus-visible**: one ring per control, on the box the user sees (see [Focus rings](#focus-rings)). Never remove focus without a replacement.
- [ ] **Disabled**: 50% opacity, `cursor: not-allowed`, no hover or press.
- [ ] **Loading**: fixed width, an inline spinner or label crossfade, no double submit.
- [ ] **Success and error feedback** inline: a checkmark drawn in with `pathLength 0→1` over 300ms, or a red ring plus helper text. A toast for async results, with Undo for destructive ones [seen: "Task completed · Undo", "Couldn't save Company… Retry"].
- [ ] **Empty states**: what goes here plus the action that fills it. Test with zero items, one item, and very long names.
- [ ] **Toggles and checkboxes**: the thumb slides on a snappy spring. A check scales 0.8→1 with a fade.
- [ ] **Tabs and segmented controls**: one sliding indicator.
- [ ] **Inputs**: focus ring transition, a character counter where there's a limit ("198/200"), validation after blur. OTP boxes auto-advance and accept paste [seen].
- [ ] **Numbers**: tabular figures. Animate a count or roll on change, not on every render.
- [ ] **Tooltips and keycaps**: show shortcuts (`/` in search, `ESC`) [seen]. Every icon-only button has a tooltip. Open after about 500ms of hover. Once one is open, neighbors open instantly for about 400ms, and only the first animates (120ms fade and 2px rise). None on touch, none when focus returns to a trigger after its menu closes. They close on scroll and pointer-down [expert].
- [ ] **Every control does something.** Each button, menu item, chip, and link works or isn't there. Filters filter, search searches, "Share" copies a real link, "Export" downloads a real file. A toast claiming an action that didn't happen is a dead button [X: "looks finished, doesn't work"]. Menus, popovers, and tooltips use a real primitive (Radix, Base UI, Bits UI, Ariakit).
- [ ] **Lists**: new rows fade and slide in, removed rows collapse height and fade, reorders animate with layout.
- [ ] **Table rows**: hover tint, and row actions (`…`) fade in on hover and on focus within.
- [ ] **Copy buttons**: the icon crossfades copy → check for about 1.6s. A tooltip stays open and its text changes to "Copied". Await the clipboard write. On failure, show a cross and "Copy failed", never a false check. Announce the result in a `role="status"` region. A labelled variant reserves the width of its longest label [expert].
- [ ] **Undo over confirm.** Deletes, archives, and bulk edits apply at once and show a toast with Undo for about 5s. Confirm dialogs only for what undo can't reverse. Errors don't auto-dismiss [X].
- [ ] **Touch targets** at least 44×44 on mobile. The hit area may exceed the visual.

## Focus rings

Agents break focus two ways: they delete it (`outline: none` with nothing in its place) or draw it twice [X]. Every focusable control shows exactly one ring, tracing the shape the user sees as the control [expert].

- **A composite field gets one ring, on the outer box.** A search bar, chat composer, input with an icon, or input with a button inside is one control to the user. Ring the wrapper with `:focus-within` (or `:has(textarea:focus)` when the box also holds buttons that shouldn't light it) and give the inner field `outline: none`. The classic failure is the textarea's ring a few px inside the composer's: two concentric, misaligned rectangles.
- **Text fields are not buttons.** A global `:focus-visible` outline also hits inputs, which match `:focus-visible` on mouse click. Scope it: `:focus-visible:not(input, textarea, [contenteditable])`, and let fields style their own wrapper.
- **Match the shape.** `outline` follows `border-radius`. Use `outline-offset: 2px` on buttons and `-2px` on rows inside a scroll container, where an outer ring gets clipped.
- **Mind the cascade.** Unlayered CSS beats Tailwind's layered utilities. Scoped component CSS doesn't reach child components. Inspect the computed `outline` and `box-shadow` to confirm the ring you wrote is the one that renders, especially on third-party primitives.
- **Menus and lists use their highlight, not a ring.** Menu items, options, and command rows show focus through the hover background (`[data-highlighted]`).
- **Errors recolor the ring, not add one.** `aria-invalid` turns the same ring red.
- **Forced colors.** Use `outline` (or a transparent outline behind a box-shadow ring) so the indicator survives Windows high-contrast mode.

```css
.composer { border-radius: 16px; box-shadow: 0 0 0 1px var(--border); transition: box-shadow 150ms var(--ease-out); }
.composer:has(textarea:focus) { box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--ring); }
.composer textarea { outline: none; }
.app :focus-visible:not(input, textarea) { outline: 2px solid var(--accent); outline-offset: 2px; }
```

**Check it:** Tab through the screen and screenshot each input, button, and row. Each shows one ring, aligned to its own edge, not clipped.

## Field errors

Errors move, they don't jump [expert].

- Validate on blur or submit, never on each keystroke. Once a field is in error, clear it as they type the moment it becomes valid. Reward early, punish late.
- The message opens with a grid going `grid-template-rows: 0fr → 1fr`, opacity 0→1, and `translateY(-4px) → 0` over about 200ms. Nothing below the field jumps.
- Keep the last message rendered while it collapses, so the text doesn't vanish before the box closes.
- One short line in the danger color with a 14px alert icon, directly under the field [X: "form errors next to the field"].
- On a failed sign-in, shake the form once (translateX ±6px, about 320ms) and select the password. No shake under reduced motion, and none for ordinary validation.
- Keep submit enabled until the request starts. On submit, focus the first invalid field, set `aria-invalid`, and link the message with `aria-describedby`.

```css
.field-error { display: grid; grid-template-rows: 0fr; opacity: 0; transform: translateY(-4px);
  transition: grid-template-rows 200ms var(--ease-out), opacity 160ms var(--ease-out), transform 200ms var(--ease-out); }
.field-error[data-visible] { grid-template-rows: 1fr; opacity: 1; transform: none; }
.field-error > div { overflow: hidden; }
```

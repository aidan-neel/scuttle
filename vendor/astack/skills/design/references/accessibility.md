# Accessibility

Accessibility is the floor for interface craft, not a checkbox at the end. Most of it is free if you use the platform. Walk every flow keyboard-only first, then ask of each control: does it announce a name, a role, and its state? When unsure, prefer the platform default and remove ARIA rather than add it.

## Semantics

- **Native elements first.** `<button>` for actions, `<a href>` for navigation (it must survive Cmd-click and middle-click). Never `<div onClick>`. No ARIA beats bad ARIA.
- **Structure is navigation.** One page `<h1>`, nested headings that describe their sections, one `<main>`, and landmarks for nav and complementary regions. Pick heading levels for structure and size them in CSS. When chrome precedes the content, a "Skip to content" link comes first in tab order. Anchored headings get `scroll-margin-top`.
- **Accessible names everywhere.** Icon-only buttons get an `aria-label`. Visible label text appears in the accessible name. Decorative elements get `aria-hidden="true"`, never a focusable one.
- **Alt text by purpose.** Decorative: `alt=""`. Informative: the meaning. Functional: the action (`alt="Search"`, not "magnifying glass").
- **Disabled.** Native `disabled` when a control is truly unavailable. `aria-disabled="true"` only when it must stay focusable, and then block its pointer, keyboard, and form behavior in code.

## Keyboard and focus

- **Every pointer interaction has a keyboard path**, per the ARIA APG patterns. Esc closes overlays. Arrow keys move within composite widgets (tabs, menus, listboxes) with a roving tabindex. Tab moves between widgets. Enter and Space activate.
- **Only `tabindex="0"` and `-1`.** A positive tabindex breaks the natural order. Fix the DOM order instead.
- **Visible focus.** Style `:focus-visible`, not bare `:focus`. At least a 2px solid perimeter or equivalent area, checked against every color it crosses and in forced-colors mode. See [interaction.md](interaction.md#focus-rings).
- **Trap and restore.** A modal sets `inert` on the background, moves focus in on open, returns it to the trigger on close, and sets `overscroll-behavior: contain`.
- **Route changes** in a single-page app move focus to the new page's heading or main region and update the document title.

## Forms

- Every input has a visible `<label>`. A placeholder is never the label. A checkbox and its text share one hit target with no dead zone.
- `autocomplete` with a meaningful `name`, plus the right `type` and `inputmode`, so the right keyboard and autofill appear.
- Never block paste. People paste passwords and one-time codes.
- Errors announce: see [interaction.md](interaction.md#field-errors).

## Announcements

- Field errors through `aria-describedby`. Non-urgent updates not tied to a control (toasts, result counts) in a polite `role="status"` region rendered empty first, then updated. `role="alert"` only for urgent errors.
- Visually hidden text for context a screen reader needs and sighted users get from layout.

## Hit areas

The WCAG 2.5.8 floor is 24×24 CSS px. Aim for 44×44 on touch and 40×40 on desktop where density allows. Extend a small visual with a pseudo-element, and shrink it where it would overlap a neighbor.

```css
.icon-btn { position: relative; }
.icon-btn::after { content: ""; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; width: 44px; height: 44px; }
```

## Motion, zoom, and time

- Honor `prefers-reduced-motion`: crossfades replace slides and scales, and parallax and autoplay stop. See [motion.md](motion.md#reduced-motion).
- Autoplaying media has a visible pause control. Toasts with actions or errors stay until dismissed.
- The page works at 200% zoom and reflows at 320px wide with no horizontal scroll. `min-height`, not fixed `height`, on text containers. Never `user-scalable=no` or `maximum-scale=1`.
- Status never relies on color alone. Contrast floors are in [craft.md](craft.md#color).

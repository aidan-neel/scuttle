# Craft details

Great interfaces rarely come from one thing. They come from small details that compound. These hold in any style. Where a rule here is a taste call, such as shadows over borders, the [style spec](style-spec.md) can choose otherwise. Express every fix in the project's own styling system and tokens.

## Surfaces

- **Concentric radius.** Outer radius = inner radius + padding (a 12px inner surface in 8px of padding takes a 20px outer radius). Mismatched nested radii are the most common reason an interface feels off. Past about 24px of padding, treat the layers as separate surfaces and pick each radius on its own.
- **Optical over geometric alignment.** When centering looks wrong, align by eye. A button with a trailing icon takes about 2px less padding on the icon side. A play triangle shifts right about 2px. Fix asymmetric icons in the SVG itself when you can.
- **Shadows for elevation, borders for structure.** A border that exists only to fake depth on a button, card, or container becomes a layered transparent shadow, which adapts to any background. Keep real borders for dividers, table cells, and selected or focus states. A spec that draws depth with borders on purpose (thick outlines, hard offset shadows) keeps them, applied by the same layer logic.

  ```css
  --shadow-border: 0 0 0 1px rgb(0 0 0 / .06), 0 1px 2px -1px rgb(0 0 0 / .06), 0 2px 4px rgb(0 0 0 / .04);
  /* dark: layered depth disappears, so use one white ring */
  --shadow-border: 0 0 0 1px rgb(255 255 255 / .08);
  ```

- **Image outlines.** A 1px inset outline at low opacity gives images a consistent edge: pure black at 10% in light mode, pure white at 10% in dark. Never a tinted neutral or the accent, which reads as dirt on the edge. Use `outline` with `outline-offset: -1px` so layout doesn't change.

## Typography

- **Fewer fonts, sizes, and weights.** The spec's families, usually one plus an optional mono, rarely more than two. Pair for contrast (a serif display over a sans body), never two near-identical sans faces. Below 18px stay at weight 400 or more. Thin weights are display-only.
- **A type scale with named steps.** Pick a small set of sizes and stay on it. Heading sizes descend with level.
- **Line height by role.** Headings around 1.1, body 1.5–1.6, unitless so it scales. Any text that wraps to three or more lines needs at least 1.4.
- **Tracking by size.** Negative on large headings, positive on small uppercase labels, none on body text.
- **Cap the measure.** Long-form text at 60–75 characters per line (`max-width: 65ch` or the pixel equivalent).
- **Wrap on purpose.** `text-wrap: balance` on headings. `text-wrap: pretty` on short paragraphs and descriptions. Neither on long text. `overflow-wrap: break-word` where URLs or IDs could escape. `white-space: nowrap` on labels and badges.
- **Tabular numbers** on anything that updates or lines up in a column: counters, prices, timers, tables.
- **Truncate without losing content.** One line: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Several: `line-clamp`. Keep the full value reachable in a tooltip or expanded view.
- **Copy in natural case**, styled with `text-transform`. Smart punctuation in prose: curly quotes, an en dash for ranges (`2010–2020`), the single ellipsis character.
- **Inputs at 16px on mobile** so iOS doesn't zoom. Never block zoom with `maximum-scale=1`.
- **Font smoothing once on the root** (`-webkit-font-smoothing: antialiased`).
- **Properties over raw tags.** `font-weight: 650` over `font-variation-settings`, `font-variant-numeric: tabular-nums` over `"tnum"`. Serve `.woff2`.

## Layout

- **Group with space, not lines.** Space first, background shapes second, separator lines last. The gap between groups is at least twice the gap within one (8px inside, 16px or more between).
- **Align to shared edges.** Pick a few left edges and keep to them. Every stray edge reads as noise. Icons share one column and labels another.
- **Controls look like controls.** A background shape, a border, or a consistent placement zone. Never style a control like the static text beside it.
- **Order by importance.** The most important content near the top and the leading edge. Think leading and trailing, and use logical properties (`padding-inline-start`) where direction matters.
- **Hint at hidden content.** A scroller lets the next item peek 16–32px past the edge, or shows a disclosure control.
- **Breathing room between targets.** About 12px between adjacent filled or bordered controls. Expanded hit areas never overlap.
- **Content bleeds, controls float.** Backgrounds and media may run to the viewport edge. Text and controls stay inside the layout margins and safe areas (`env(safe-area-inset-*)`).
- **Breakpoints come from the content.** Hold the expanded layout until it stops fitting, then collapse. Prefer container queries for components. Test the smallest and largest widths first.
- **Plan for growth.** No fixed widths or heights on text containers. Let rows wrap. Translated strings can run 30–40% longer.

## Color

- **Respect the project's tokens and notation.** Reuse its semantic tokens. Don't convert hex to OKLCH for one fix.
- **New systems in OKLCH.** It is perceptually uniform, so equal lightness steps look equal and hue stays put. Keep a ramp's hue within about 10° across steps. Check gamut and add an sRGB fallback for P3 colors.
- **One color, one meaning.** If blue means "link", it isn't also decoration. A role without a token gets a new token, never a borrowed value.
- **One colored action per view.** Fill only the primary action. Secondary actions stay neutral.
- **Never color alone.** Status pairs color with an icon, a word, or a shape.
- **Contrast.** Body text at least 4.5:1 (WCAG AA) or APCA Lc 75. Large text and UI parts at least 3:1. Measure the rendered pair, in both themes, with [`scripts/contrast.py`](../scripts/contrast.py)` <text> <background>`. It reads hex, `rgb()`, `oklch()`, and `color-mix(in oklab, ...)`, so a token or a `getComputedStyle` value pastes in as is. To fix, move lightness first and keep chroma and hue.
- **Dark mode is designed, not inverted.** Start from the light palette, then retune lightness and chroma and recheck every pair.

## Icons

- **One set per surface.** Never mix libraries with different stroke conventions.
- **Stroke matches the text weight.** 1.5px beside regular text, 2px beside 500–600.
- **Size with the text**, about 1em–1.25em inline, so the pair scales together. Design at render size: detail that reads at 48px turns to mush at 16px.
- **One SVG, recolored by state.** `currentColor`, with hover, selected, and disabled driven by CSS. Strip hardcoded fills.
- **Outline at rest, fill for active**, when the set offers both.
- **Mirror directional icons in RTL** (arrows, back), not symbolic ones (a clock, a checkmark).

## Copy

- **Recon the voice first.** Read nearby copy and keep the product's terms. If it's "Archive" in the menu, it's "Archive" in the toast.
- **Plain and brief.** Delete every word that isn't needed. No idioms, no buzzwords ("Supercharge your workflow"), no exclamation marks, no "Oops".
- **Address the reader as "you".** Lead with their work ("3 deals close this week"), not a greeting.
- **Buttons start with a verb** that names the action: "Save draft", "Delete project". A confirmation repeats the consequence: "Delete project" and "Cancel", never "Yes" and "No".
- **One flow vocabulary.** Pick "Continue" or "Next" and keep it through every step.
- **Links say where they go.** "Read the billing docs", never "Click here", never several bare "Learn more" links.
- **One capitalization policy.** Sentence case by default, for every button and heading.
- **Toggles name the ON state.** "Send read receipts", not "Don't send read receipts".
- **Errors say how to fix it, next to where it broke.** "Choose a password with at least 8 characters", not "Password too short". "Couldn't save. Check your connection and try again."
- **Empty states point forward.** Say what goes here and give the one action that fills it. A filtered empty state names the query and offers "Clear filters".
- **Placeholders are examples, never labels.** `name@example.com` under a visible "Email" label.
- **Full template strings** with pluralization, never `"You have " + n + " messages"`.

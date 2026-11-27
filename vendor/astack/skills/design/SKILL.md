---
name: design
description: Use for any change to how a user interface looks or feels. Building, redesigning, polishing, or restyling a page, screen, or component (dashboard, landing page, form, app shell, sidebar, mobile UI, onboarding or auth flow), even from a short prompt like "make it look good", "polish this", or "it feels off". Also for UI review, motion and micro-interactions, typography, color, layout, icons, interface copy, and accessibility details. Works in any style: one given in the request (words, a named product, an image, a URL, a canvas file), the project's own design system, or a calm, near-monochrome default. New screens start as three variants in Paper for the user to pick. Ends with a screenshot verification round on the real UI.
---

# design

This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Turn a UI request, even a one-liner, into an interface that looks and feels premium, not generic AI output. The screenshots prove it. The code alone does not.

## Model routing (`design` size)

Before setting the style, building, or reviewing UI, read `~/.config/astack/models.md` per [the harness references](../go/references/harnesses/README.md#models) and check the `design` size:

- **If this session is not already running on the `design` size model (and you are not already a delegated `design` subagent):** do not design, style, or review UI on your own model. Spawn a general-purpose subagent (or a `go-worker` subagent when no extra MCP tools are needed) on the `design` size with the user's request, the absolute path to this `SKILL.md`, and an explicit line that it is the `design` agent (so it executes directly instead of delegating again). Let it run the full workflow, including checking Paper and telling the user if Paper isn't open. If the `design` subagent cannot reach Paper MCP tools that only your session holds, have the `design` subagent produce the style spec and variant HTML/CSS, place them onto Paper from your session, get the user's pick, and delegate steps 4 to 14 to a `design`-size subagent.
- **If you are already on the `design` size model (or you are the delegated `design` subagent):** run the workflow below directly.

The skill has two layers.

- **Style** is what the result looks like: type, color, shape, depth, motion, voice. It is written down as one [style spec](references/style-spec.md), whatever its source.
- **Method** is how any style gets built well: the brief, variants, craft, motion, interaction states, accessibility, the anti-slop rules, and the verification round. It runs on top of any spec.

## Set the style

Do this before anything else, per [style-spec.md](references/style-spec.md). The style comes from, in order: a style given in the request, the project's own design, then the default visual language in [style.md](references/style.md). Turn the source into a spec, with every value as a token, and say which you chose in one line: `style: <source>`.

The spec sets the look. The method's numbers (durations, press scale, radius tiers, weights) are the default's values, and the spec replaces them wherever it speaks. The spec never lowers contrast, focus, reduced motion, state handling, or alignment.

## References

Load each one when the step needs it, not all at once.

| File | Load it for |
|---|---|
| [style-spec.md](references/style-spec.md) | Where the style comes from, turning words, an image, a URL, or a project into a spec, chosen tells, and what a spec can't override. Always. |
| [paper-variants.md](references/paper-variants.md) | Three variants on a Paper canvas, or as code without Paper, and the user's pick. |
| [style.md](references/style.md) | The default visual language as a filled-in spec, with its tokens. Default style only. |
| [reference-images.md](references/reference-images.md) | Links to the screenshots behind the default style. Default style only. |
| [components.md](references/components.md) | Recipes for buttons, inputs, segmented controls, cards, tags, popovers, modals, sheets, toasts, skeletons, and mobile CTAs. Their values are the default's. In another style, keep their structure and behavior and re-skin them with the spec's tokens. |
| [sidebar.md](references/sidebar.md) | App shells: inset and flush sidebars, nav rails, behavior, common mistakes. Its alignment and behavior rules hold in any style. Its measurements and tones are the default's. |
| [craft.md](references/craft.md) | The details that make any interface feel right: surfaces, radius, alignment, typography, layout, color, icons, copy. |
| [motion.md](references/motion.md) | Whether to animate, easing and duration tokens, springs, enter and exit patterns, gestures, stagger, reduced motion, performance. |
| [interaction.md](references/interaction.md) | The state checklist for every control, focus rings, and field errors. |
| [accessibility.md](references/accessibility.md) | Semantics, keyboard, focus management, labels, announcements, hit areas, zoom. |
| [websites.md](references/websites.md) | Company, product, shop, venue, SaaS, and game sites: the kind of business, one section per screen, pictures, sales copy and its tells, invented facts, contacts. Any landing page or company site. |
| [anti-slop.md](references/anti-slop.md) | The tells that make UI read as AI-built, each with the fix. |
| [qa.md](references/qa.md) | The final checklist, the verification round, and the review format. |

Recipes use React, Tailwind, and Motion (`motion/react`) with plain-CSS equivalents. Translate them into the project's stack and conventions. Never add a second styling approach to apply one fix.

## Workflow

1. **Set the style** (above) and write the spec. In the default style, read [style.md](references/style.md).
2. **Classify the request:** app screen, app shell, mobile app, landing page, auth or onboarding, or a single component. For an app shell, read [sidebar.md](references/sidebar.md). For a landing page or company site, read [websites.md](references/websites.md) and name the kind of business.
3. **Make three variants** per [paper-variants.md](references/paper-variants.md) when the layout is open: a new screen, a new component, or a redesign. Check Paper first: if Paper isn't open or connected, tell the user right away and ask them to open Paper (or confirm falling back to throwaway code variants). The user picks one, and it becomes the reference. When the layout is set, write `skip: layout set by <what>` and take the layout from the existing screens or the reference you match.
4. **Settle theme, accent, and type** from the spec.
5. **Write the content first.** On a website, follow the copy rules in [websites.md](references/websites.md#copy). Otherwise use realistic, specific data: names, amounts, dates, statuses ("Sophia Williams", "$83,820.35", "Oct 10 · Overdue"). No lorem ipsum. Short labels in the spec's case. Follow the copy rules in [craft.md](references/craft.md#copy) and the spec's voice.
6. **Block out the layout** on the spec's spacing scale (a 4px grid when it has none), with tokens only and no ad-hoc values. One H1 and one primary action per view.
7. **Build the components** from the project's library first, then the chosen variant's exports, then the [components.md](references/components.md) recipes re-skinned with the spec. Apply [craft.md](references/craft.md) as you go.
8. **Remove things.** Delete any divider, icon, label, card, or color that doesn't earn its place in this style. Merge redundant actions. Check against [anti-slop.md](references/anti-slop.md), minus the spec's chosen tells.
9. **Add motion** at the spec's motion character, in this order ([motion.md](references/motion.md)): press, hover, and focus states everywhere; enter and exit for overlays; layout animation for indicators and reflow; one orchestrated first reveal (stagger total ≤ 300ms); one hero moment on a landing page. A static spec keeps only the state changes.
10. **Handle every state** with [interaction.md](references/interaction.md): loading, empty, error, success, disabled, long text, and widths from 360 up.
11. **Dark mode pass** with the spec's dark values, when it ships dark. Recheck every text and background pair.
12. **Accessibility pass** with [accessibility.md](references/accessibility.md): semantics, labels, keyboard paths, focus order, reduced motion, contrast.
13. **Polish pass** with the [qa.md](references/qa.md) checklist. Fix the last 10% by hand. This is where it becomes excellent.
14. **Verification round** ([qa.md](references/qa.md#verification-round)). Drive the real UI with the [control-ui](../control-ui/SKILL.md) skill at desktop and mobile widths, in each theme the spec ships, with keyboard focus, reduced motion when the UI animates, and real content lengths. Check, fix, re-shoot. At most 2 fix rounds. List whatever still fails in the hand-off and don't call the UI done. List each skipped check with its reason too.

## The brief

Expand a short prompt into a brief before you build. Keep it in your notes, or put it in a subagent's brief.

> Build {thing} for {domain}. Kind: {for a website, the kind of business from websites.md, and that file's path}. Style: {spec name, its source, and the path to the spec}. Theme {light, dark, or both}, accent {token}, type {families, weights, title tracking}. Layout: {pattern}. Reference: {the chosen variant's PNG and exports, an existing screen, or a described reference}. Components: {list, from the project's library where it has them}. Content: {realistic examples, including the longest real values}. Motion: {the spec's motion character, with its press, popover, indicator, and reveal values}. States: loading, empty, error, disabled. Reduced-motion safe. Verify at 1440 and 390, in each theme the spec ships.

## Reviewing without building

When asked only to review a UI, stay read-only. Follow [Model routing](#model-routing-design-size) first so the review runs on the `design` size model. Set the style first, so you judge the screen against its own spec, not the default. Inspect the rendered screen, not just the code, and report in the review format in [qa.md](references/qa.md#review-format).

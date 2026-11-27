# QA and verification

## Final checklist

**Visual**
- [ ] Matches the [style spec](style-spec.md): its tokens, components, and signature details. No ad-hoc values. In the default style, the [style checks](style.md#style-checks) pass too.
- [ ] Color follows the spec's roles. Each accent does its job, and nothing else carries color.
- [ ] Type follows the spec: its families, weights, scale, and tracking by size.
- [ ] Spacing on the scale. Radii consistent per tier and concentric when nested.
- [ ] Depth follows the spec, by layer: what floats looks raised, and what sits flat stays flat.
- [ ] Numbers tabular. Contrast passes in every theme the style ships.
- [ ] Realistic content. Long text truncates with an ellipsis and stays reachable.
- [ ] One icon set, one stroke and size, optically aligned with text.
- [ ] Light and dark both checked, when the spec ships both.

**Motion** (at the spec's motion character; the numbers are the default's)
- [ ] Every interactive element has hover, press, focus-visible, disabled, and loading states.
- [ ] UI transitions at or under 300ms. Exits faster than enters. Ease-out or springs, never ease-in on enter.
- [ ] Popovers scale from 0.95 or more at the trigger. Modals from center.
- [ ] When the brief includes motion, active indicators slide and lists animate add, remove, and reorder.
- [ ] Interruptible: rapid toggling never jumps or queues.
- [ ] No animation on frequent keyboard-triggered actions.
- [ ] Only transform and opacity animate. No `transition: all`. No layout shift.
- [ ] Reduced motion honored. Loops pause offscreen.

**UX**
- [ ] One primary action per view. The hierarchy holds in a 3-second squint.
- [ ] Keyboard: tab order, Enter and Esc, shortcuts shown as keycaps where useful.
- [ ] Focus pass: one ring per control, on the outer box of composite fields, never clipped.
- [ ] Function pass: every button, menu item, chip, link, and row action does what its label says.
- [ ] Alignment pass: icons share one column and labels another. Trigger rows match the rows below in width, height, and inset.
- [ ] Touch targets at least 44px on mobile. A sticky CTA never covers content.
- [ ] Errors say what happened and how to fix it.
- [ ] A second full pass with fresh eyes.

**Website** (a landing page or company site): the checks in [websites.md](websites.md#checks).

## Verification round

Don't hand over UI you haven't looked at. Render it, look, fix, look again. At most 2 fix rounds.

**1. Render.** Start the app from your working tree and drive the real UI with the [control-ui](../../control-ui/SKILL.md) skill. Load real or realistic data, including the longest values the product will meet. Save every shot at 2× device scale where control-ui keeps evidence (a gitignored artifacts folder the project already uses, or `~/.local/state/astack/proof/<repo>/<branch-or-slug>/`, where `<branch-or-slug>` is the branch name, or a short task slug on a detached HEAD), never only in a temp folder, so a later session and the PR can find them. When your brief names a proof folder, such as a `direction-<n>/` subfolder, save there and nowhere else. Wait for state before each shot, except `midanim.png`, whose fixed delay is the point.

| Shot | How |
|---|---|
| `desktop-light.png`, `desktop-dark.png` | 1440×900, full page, after the page settles. Switch the theme through the app's own toggle, or emulate `prefers-color-scheme`. |
| `mobile-light.png`, `mobile-dark.png` | 390×844, full page. |
| `hover.png` | Pointer over the primary button or a row, 200ms after hover. |
| `focus-<n>.png` | After each Tab press through the main controls. |
| `midanim.png` | 120ms after a reload, to catch the entrance mid-flight. |
| `reduced-motion.png` | Emulate `prefers-reduced-motion: reduce`, reload, shoot at 120ms. |
| `content-empty.png`, `content-long.png` | Zero items, then many items with very long names, amounts, and labels. Add a pass with strings about 40% longer if the product is translated. |

Take a shot only when the spec or brief calls for it. The `-dark` shots need dark values in the spec. `midanim.png` needs an entrance animation in the brief, and `reduced-motion.png` needs any motion at all. Note each shot you skip and why.

At each width, run this in the page and keep the output. It lists elements that overflow the viewport or their own box:

```js
[...document.querySelectorAll('body *')].filter((e) => {
  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  return r.width && (r.right > innerWidth + 1 || (e.scrollWidth > e.clientWidth + 1 && s.overflowX === 'visible'));
}).slice(0, 20).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`)
```

**2. Look.** Open every shot with your image tool. Compare the desktop shot side by side with the reference named in the brief: the chosen variant's PNG, an existing screen of the project, or the described reference. In the default style, also fetch one image of the same kind of screen from [reference-images.md](reference-images.md).

**3. Check.** Each item passes, fails, or is skipped because the spec or brief doesn't call for it. Write a skip with its reason (`skipped: dark mode, the spec ships light only`). A skip for any other reason is a fail.

- [ ] **Style:** the screen follows the spec, shows its signature details, and sits beside the reference without looking foreign. Nothing drifted toward the default style or toward Paper's default taste.
- [ ] **Alignment:** left edges line up on a few shared x positions. Icons center vertically with their text. Table numbers align right.
- [ ] **Spacing rhythm:** every gap is on the scale. Gaps within a group are smaller than gaps between groups. No cramped edge padding.
- [ ] **Type hierarchy:** one clear title, the spec's weights and tracking, muted color only for secondary text.
- [ ] **Contrast:** body text at least 4.5:1 in every theme the spec ships. Nothing important in a faint grey. Text on the accent (primary button label, `--accent-fg` on `--accent`) clears 4.5:1 at rest and on hover.
- [ ] **Dark mode** (when the spec ships dark): no hardcoded light colors left behind, no invisible hairlines, no white flashes, depth still reads.
- [ ] **Focus:** every `focus-<n>.png` shows exactly one visible ring on the right box, not clipped. Focus order follows reading order.
- [ ] **Reduced motion** (when the UI animates): `reduced-motion.png` shows content at rest or fading only, with no slide or scale in flight.
- [ ] **Content lengths:** the overflow list is empty at both widths. No wrapped buttons or labels. Long text truncates with an ellipsis. Empty states point forward.
- [ ] **Mobile:** nothing scrolls sideways at 390px, targets are at least 44px, the primary CTA is reachable, nothing hides under sticky bars.
- [ ] **Motion present:** `hover.png` differs from rest. When the brief includes an entrance, `midanim.png` shows elements partly in. When it includes motion, the code has press feedback, sliding indicators, and a reduced-motion branch.
- [ ] **Function:** every control you clicked did what its label says. No console errors or failed requests along the way.
- [ ] **Slop:** none of the [anti-slop.md](anti-slop.md) tells except the spec's chosen tells. Squint for a purple gradient, emoji, three centered cards, glow, or fake testimonials.
- [ ] **Sidebar** (if any): passes the common mistakes in [sidebar.md](sidebar.md#common-mistakes), and is cleanly inset or cleanly flush.

**4. Fix and re-shoot.** Fix every failed item, take the shots again, check again. Stop after 2 fix rounds. If anything still fails, list it in the hand-off and don't call the UI done. List every skipped check there too, with its reason.

**No vision? Use the DOM.** The overflow list must be empty. Dump `getBoundingClientRect()` for headings, buttons, and nav items and check that `left` values cluster, nav item heights match, gaps sit on the scale, and button heights match per row. Read `getComputedStyle` for font family, the count of distinct weights, `letter-spacing` on the title, `transition` on interactive elements, the focus ring's `outline` or `box-shadow`, and text and background colors, then check each pair with [`scripts/contrast.py`](../scripts/contrast.py). Compare the hover and rest screenshot bytes to prove a hover state exists.

## Review format

When asked to review a UI without changing it, inspect the rendered screen and the code, then report findings in one table, most severe first. One row per root cause, listing every location it hits.

| Severity | Location | Before | After | Why |
|---|---|---|---|---|
| High | `src/Dialog.tsx:42` | `<button><XIcon /></button>` | `aria-label="Close"` and the icon `aria-hidden` | The icon-only control has no accessible name |
| Low | `src/Card.tsx:28` | `rounded-xl` on the card and on its inner button in `p-2` | `rounded-2xl` outer, `rounded-lg` inner | Nested radii should be concentric |

- **High:** blocks a task, misleads, hides content or a control, or repeats across the product.
- **Medium:** hurts comprehension, efficiency, adaptability, or consistency.
- **Low:** isolated polish.

A shared token or component fix outranks the same symptom in one leaf. After the table, list what you checked and how, and what you could not verify. End with one verdict: `Block` while any High remains, `Needs changes` while only Medium or Low remain, `Approve` when nothing actionable remains.

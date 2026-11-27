# Anti-slop rules

These are the tells that make UI read as AI-built. Each is a hard don't with the do instead. Tags: **[X]** means the tell recurs in public critiques of AI-built UI on X (October and November 2026, sources below). **[seen]** and **[expert]** are as in [style.md](style.md). The most cited combination was a purple gradient, untuned default type, and three centered cards.

A tell is a default nobody chose. When the [style spec](style-spec.md#chosen-tells) lists one under `Chosen tells`, it is a choice for this build, not slop. Say so in the hand-off. Only the visual tells can be chosen: 1, 2, 4, 5, 8, 9, 10, 11, 12, 13, 15, 17, and 18. The rest are about content, copy, layout discipline, and function, and apply in every style. A `Do` that names a value gives the default's; take the spec's where it has one.

1. **No default purple, indigo, or violet gradients** on heroes, buttons, text, or backgrounds [X]. *Do:* a neutral UI plus one flat accent with a job. A flat, intentional violet accent is fine [seen].
2. **No gradient text and no single colored word in a headline** [X]. *Do:* solid primary text, with emphasis from size, weight, or tracking.
3. **No untuned type:** default tracking at every size, random weights, a flat hierarchy [X]. *Do:* tune the family to the spec's tracking and weights (the default: −2% to −4% on display sizes, at most two weights on screen), with a clear step between title, body, and meta.
4. **No emoji as icons and no emoji status pills ("🟢 LIVE")** [X]. *Do:* the project's icon set, or one stroke set at 16 or 20px. Without one, don't reach for Lucide by reflex. Phosphor, Iconoir, or a custom set reads less default [X].
5. **No untouched library look** (stock zinc greys, stock radius, unthemed components) in a product with no design of its own [X]. *Do:* theme the library from the style's tokens, with your own radius tiers.
6. **No "centered hero → three icon cards → testimonials → CTA" template** [X]. *Do:* an asymmetric layout with a real product screen as the hero visual, and sections specific to the content.
7. **No fake social proof or lorem ipsum** ("Sarah K., Founder", invented logos, "Trusted by 10,000+ teams") [X]. *Do:* realistic, domain-specific data, labeled as sample when it is.
8. **No glow orbs, gradient blobs, dot grids, neon, or glow cards** [X]. *Do:* a quiet canvas. Grain or texture only when it carries the brand and is art-directed [seen].
9. **No drop shadow on everything and no border on every box** [X][seen]. *Do:* soft layered shadows on elevated layers only, and tonal separation instead of borders.
10. **No card in a card in a card** [X]. *Do:* one container level, with whitespace and hairlines inside.
11. **No eyebrow above every heading and no spaced-out uppercase everywhere** [X]. *Do:* one eyebrow per page at most. In the default style, small uppercase belongs on sidebar section labels only.
12. **No hover-scale on everything and no fade-up on every scroll section** [X]. *Do:* purposeful motion: press scale, sliding indicators, origin-aware popovers. Reveal on scroll once, for hero-level content.
13. **No rainbow or neon palettes and no competing accents** [X][seen]. *Do:* the spec's accents, each with one job (the default has one), and semantic green and red only for status and deltas.
14. **No eyeballed spacing** [X]. *Do:* the spacing scale (a strict 4px grid by default), with bigger gaps between groups than within them.
15. **No generic beige "AI warm" background, and no flat pure white by default** [X]. *Do:* the style's canvas, or a cool neutral canvas with white panels.
16. **No buzzword copy** ("Build faster with AI", "Supercharge your workflow") and no dash-heavy marketing voice [X]. *Do:* concrete, plain, product-specific copy. On a website, check the copy tells in [websites.md](websites.md#copy-tells) too.
17. **No bento grid unless the content is truly mixed** [X]. *Do:* let the content pick the layout.
18. **No glassmorphism by default** [expert]. *Do:* solid surfaces. Blur only for overlays over imagery.
19. **No twin CTAs and no filler cards** ("Get started" beside "Learn more", a fourth stat card to fill the row, an icon tile on every card) [X]. *Do:* one primary action per view, and as many cards as there are real numbers.
20. **No "Welcome back, Alex! 👋" and no exclamation marks** [X]. *Do:* lead with the user's work ("3 deals close this week").
21. **No "No data" empty states** [X]. *Do:* say what will appear and give the action that makes it appear.
22. **No dead UI** [X]. *Do:* click every control before you hand it over. See "Every control does something" in [interaction.md](interaction.md#state-checklist).
23. **No removed or doubled focus rings** [X]. *Do:* one ring per control on the box the user sees ([interaction.md](interaction.md#focus-rings)).
24. **Older tells still count:** white text on saturated pills, 600ms+ UI transitions, scale-from-0 popovers, bouncy springs everywhere, and a 1px mid-grey border on every box.

## Sources

Critiques on X, October and November 2026:

- https://x.com/shipper_now/status/2110637576935891122 (no emoji, no "🟢 LIVE" badges, no blue or purple gradients)
- https://x.com/tomilola_ng/status/2114078495487729986 (default Lucide icons and default shadcn colors)
- https://x.com/denizdoingstuff/status/2114407641963237633 (Lucide everywhere, shadcn greys, one size and tracking everywhere, the same gradient hero)
- https://x.com/tanujbuilds/status/2115834588551594431 (emoji-icon feature cards, the "Sarah K., Founder" testimonial)
- https://x.com/AnylancerInc/status/2114401436071043088 (eyebrow above every heading, spaced caps, one colored word, card in a card)
- https://x.com/erramix01/status/2113937292863602955 (radial orbs, dot grids, bento, neon, shadows on everything)
- https://x.com/lokidotdev/status/2117188486034063507 (everything hover-scales, six font weights)
- https://x.com/_def/status/2115188253863071921 (untuned type, emoji status pills)
- https://x.com/Zephyr_hg/status/2117371426600784071 (a checkable banned list beats "make it clean"; twin CTAs, fake "10K+" proof)
- https://x.com/preetsuthar17/status/2117540786791493802 (twin CTAs, "no data" empty states)
- https://x.com/sinanyorulmazz/status/2116531845839851723 (a removed focus ring as an error, "Welcome back 👋" copy)
- https://x.com/equalworld_ai/status/2117349679700623510 (a stray `outline: none` as a common quiet regression)
- https://x.com/Mr_Buzzoni/status/2106320604634702070 (dead buttons, errors next to the field, a keyboard-only pass, real loading, empty, and error screens)
- https://x.com/keviduk/status/2109645687176495258 (errors must not collapse into a toast stack)

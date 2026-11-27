# Style spec

Every build runs against one written style spec. The spec is the look: type, color, shape, depth, motion, voice. The method in the other references (craft, motion, interaction, accessibility, anti-slop, QA) runs on top of any spec. The default visual language in [style.md](style.md) is one filled-in spec, used only when nothing else sets the style.

## Where the style comes from

Settle it once, before anything else, in this order.

1. **A style given in the request.** Words ("brutalist", "playful and loud", "Swiss editorial"), a named product or designer ("like Linear", "like a Teenage Engineering manual"), an image or screenshot, a URL, a Paper or Figma file, or a brand guide. It wins over everything below, for what it speaks to.
2. **The project's own design.** A tokens file, CSS custom properties in a global stylesheet, a Tailwind theme (`@theme`, or `theme.extend` in `tailwind.config.*`), a themed component library (shadcn, Radix, Base UI, Bits UI, MUI), a design doc or a style named in `AGENTS.md`, or existing screens that share a look.
3. **The default visual language** in [style.md](style.md).

When a given style meets a project with its own design, the request decides the reach. "Restyle the app as X" replaces the project's tokens with the new spec, through the project's own token files and components, never as a second styling layer beside them. "Make this page feel more X" keeps the project's tokens and components and moves only what the request names (the accent, the type, the density). When the reach is unclear and the change touches shared tokens, ask the user. Say which you chose in one line: `style: <source>`, with the reach when a given style met a project system.

## Turn the source into a spec

- **Words or a named product.** Write what the style is known for, from what you know of it. Mark each claim you're unsure of as a guess, and ask the user for a screenshot when the style depends on details you can't recall. A named product is a direction, never a copy: take its principles (density, type treatment, depth, motion feel), never its logo, name, illustrations, or exact layouts.
- **An image or screenshot.** Look at it with your image tool. Sample colors from it, estimate the type (family class, weights, size steps, tracking, case), radii, border weight, shadow shape, spacing rhythm, and density. Values read off a screenshot with no known scale are ratios, not pixels.
- **A URL.** Open it with the **control-ui** skill or a fetch. Read `getComputedStyle` for fonts, colors, radii, and shadows on the headings, body, buttons, inputs, and cards. That gives exact values, not estimates.
- **A Paper or Figma file.** Read its design tokens and computed styles through the canvas MCP. Never guess values a tool can read.
- **The project.** Read the tokens and two or three existing screens. The spec mostly points at the token names.

When the source fixes only part of the look, fill the rest from the method's defaults and name each gap you filled in the spec.

## The spec

Write it into the brief, or into `style-spec.md` in the proof folder when subagents or a later session need it. Keep it to about one screen.

```markdown
## Style spec: <name>
Source: <what set it, and the reach>
Character: <three to five words>, not <what it must never become>
Type: <families and roles>; weights <list>; scale <sizes>; tracking <rule by size>; case <rule>
Color: ground <value>; surfaces <values>; text <primary, secondary, muted>; accent <value and its job>;
  extra accents <values and jobs, or none>; semantic <success, warning, danger, info>; dark mode <yes, with values, or no>
Shape: radius <control, card, overlay>; borders <weight and color, or none>
Depth: <flat, hairlines, soft layered shadows, hard offset shadows, glass>
Density: grid <base unit>; row height <value>; spacing <tight, airy>
Texture and imagery: <grain, patterns, photography, illustration, or none>
Icons: <set, stroke, size, filled or outline>
Motion: <static, calm, snappy, or playful>; durations <range>; easing <curves>; springs <bounce>; press <scale or none>
Voice: <how the copy sounds>
Signature: <two to four details that make it recognizably this style>
Chosen tells: <anything anti-slop.md lists that this style deliberately uses, or none>
Tokens: <path to the token file, or the CSS custom properties to add>
```

Every value becomes a token before any screen uses it. Name tokens by role (`--accent`, `--surface-raised`), never by color (`--purple-500`).

## Chosen tells

A tell in [anti-slop.md](anti-slop.md) is a default nobody chose. When the style deliberately uses one (a brand gradient, glass panels, a beige ground, several accents, heavy uppercase, thick borders on every box), list it under `Chosen tells` and it stops being slop for this build. Only the visual tells can be chosen. The tells about content, copy, and function (fake proof, lorem ipsum, dead controls, buzzword copy, removed focus rings, "No data" empty states) apply in every style.

## What a spec can't override

A spec sets the look. It never lowers these, in any style:

- Contrast floors: 4.5:1 for body text, 3:1 for large text and UI parts ([craft.md](craft.md#color)).
- One visible focus ring per control ([interaction.md](interaction.md#focus-rings)), and every other rule in [accessibility.md](accessibility.md).
- Reduced motion honored, no animation on frequent keyboard actions, and interruptible state changes ([motion.md](motion.md)).
- Every state handled, every control working, realistic content ([interaction.md](interaction.md)).
- Alignment to shared edges and a consistent spacing scale ([craft.md](craft.md#layout)).

When the style's look and one of these collide (a pale-grey-on-white aesthetic, a no-focus-ring minimalism), keep the floor and get as close to the look as the floor allows. Name the compromise in the hand-off.

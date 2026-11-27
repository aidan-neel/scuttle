# Default visual language

Use this only when no style is given in the request and the project has no design of its own ([style-spec.md](style-spec.md)). Calm, precise, alive: quiet near-monochrome product UI, careful typography, soft layered shadows instead of heavy borders, one confident accent, and motion that is fast, physical, and never decorative for its own sake.

The language is inspired by the public work of product designer Marcel Kargul (Kargul Studio). It is not affiliated with him. Each claim carries its provenance:

- **[seen]** observed directly in his published designs or stated in his captions.
- **[inferred]** a reasonable extrapolation, often measured from screenshots with no known pixel scale. Treat it as a ratio, not an exact value.
- **[expert]** general product-design or motion practice (Motion docs, Emil Kowalski, Apple HIG), not from his work.

## As a spec

```markdown
## Style spec: default
Source: astack's default visual language (this file)
Character: calm, precise, alive; not decorative, not loud
Type: Inter (Geist alternative), optional mono for numbers and code; weights 400, 500, 600 for headings;
  scale 12, 13, 14, 16, 18, 24, 32, 48, 64, 96; tracking 0 at 16px, −3% near 36px, −5.5% at 100px; sentence case
Color: ground white; surfaces #F7F7F7 and white panels; text #171717, #737373, #A3A3A3 (placeholders only);
  accent one per product, from the list under Color; extra accents none; semantic dark text on soft tints; dark mode yes
Shape: radius 8–10 controls, 12–16 cards, 20–24 overlays; borders hairlines, often as 1px spread shadows
Depth: soft layered shadows on raised layers, hairlines elsewhere
Density: grid 4px; row height 32–40; spacing airy, groups farther apart than items
Texture and imagery: none in product UI; art-directed grain or isometric line art on marketing heroes
Icons: one outline set, 1.5px stroke, 16–18px, grey at rest
Motion: calm and snappy; 150–300ms; ease-out cubic-bezier(0.23, 1, 0.32, 1); springs bounce ≤ 0.15; press 0.97
Voice: plain, specific, the user's work first
Signature: the two-shadow secondary button, a quiet active pill, tabular numbers, tinted tags with dark text
Chosen tells: none
Tokens: the block under Tokens below
```

Images of the work behind it are listed in [reference-images.md](reference-images.md).

## Philosophy

1. **If it can be removed, remove it.** [seen: "if it doesn't need to be there, it shouldn't be. simple is always hard, but simple always wins."]
2. **Typography does the heavy lifting.** [seen: "just master typography and you can make anything look good."] One family, at most two weights [seen].
3. **White, black, and shadows.** [seen: "Just FFFFFF, 000000, and some shadows."] Most of the palette is neutral grey. Color carries meaning: state, category, or the one primary action.
4. **Depth comes from soft layered shadows and hairlines, not thick borders.** [seen: "this button only requires 3 shadows!"]
5. **Motion is part of the product.** [seen: "micro-interactions throughout", "subtle loading animation. not overdone"] Animate only to explain a change, confirm an action, or guide attention [expert].
6. **Craft the last 10% by hand.** [seen: his process ends with "spend hours fixing small details manually"]. The QA checklist is that last 10%.
7. **Calm beats clever.** [seen: "clean", "calm", and "simple" recur in his captions] Even a data-heavy screen should feel calm.

## Typography

- **Family.** Inter on the web by default, Geist as the alternative [seen: "nothing beats Inter and Geist"]. SF Pro Rounded for iOS-flavored mobile, Google Sans Rounded as its cross-platform stand-in [seen]. A mono (Geist Mono-like) for big numbers, tickers, and code [seen]. A light transitional serif only for editorial or marketing display [seen].
- **Tracking** [seen, his numbers]: 16px at 0, 36px at −3%, 100px and up at −5% to −6%. "The never-go-negative rule is for body text." SF Pro Rounded takes +1%.
- **Weights.** 400 and 500 carry nearly all product UI. 600 for headings and numbers. Bold and black only on large display headlines [inferred].
- **Sizes in product UI** [inferred]: body and table 13–14px, meta 12–13px, section labels 11–12px, page titles 18–24px at 500, KPI numbers 24–32px, hero headlines 48–72px with negative tracking. Buttons are 14px at 500 [seen].
- **Text color.** Primary near-black (`#171717`), secondary mid-grey (`#737373`), tertiary and placeholder (`#A3A3A3`). Tags use dark tinted text on a light tint, never white on a saturated fill [seen: "Dark text improves overall readability greatly."].
- **Line height** [expert]: body 1.5, UI labels 1.3, headings 1.1, display 1.0–1.05.

## Color

Approximate values sampled from his screenshots [seen/inferred]:

| Role | Light | Dark |
|---|---|---|
| Canvas | `#FFFFFF` | `#0D0D0D`–`#121212` |
| Subtle surface (sidebar, panel, mobile background) | `#F7F7F7`, `#FAFAFA` | `#1A1A1A`–`#1E1E1E` |
| Backdrop behind mockups | `#E5E5E5`–`#EDEDED` | `#1F1F1F`–`#262626` |
| Hairline | `#ECECEC` | `rgba(255,255,255,0.08)` |
| Primary text | `#171717` | `#FAFAFA` |
| Secondary text | `#737373` | `#A1A1A1` |

**One accent per product, never several** [seen]. Pick by domain: violet `#7B3AEC` (creative, onboarding), blue `#255CD1` (finance, calendars, analytics), orange `#FF5A1F` (energetic tools), teal `#0F766E` (data and ops), lime `#B4F05A` on near-black (dev tools), coral `#F2435A` (consumer wellness), or pure black `#0A0A0A` as the primary button in a neutral app. Text on the accent takes `--accent-fg`, chosen with the accent: white on violet, blue, teal, and black, and `#0A0A0A` on orange, lime, and coral, which fail with white.

**Semantic tints** [seen]: green `#16A34A` on `#ECFDF3`, red `#DC2626` on `#FEF2F2`, amber on `#FFF4E5`, blue on `#EEF4FF`. Avatar initials sit on pastel circles with darker same-hue text.

**Gradients** are rare and deliberate [seen]. Buttons get a faint vertical gradient (`#FFFFFF → #F7F7F7` for secondary). Hero art may use blurred multi-color forms with a grain overlay, art-directed, never a default purple wash.

## Shape, spacing, depth

- **Radii** [seen/inferred]: controls 8–10px (his button is 30px tall, 10px radius [seen]), inputs 10–12px, cards 12–16px, modals and command palettes 20–24px, mobile sheets 24–32px, chips and mobile CTAs fully round.
- **Spacing** [inferred]: a 4px grid. Common gaps 4, 8, 12, 16, 24, 32, 48. Lots of air. Dense tables still get 40–48px rows.
- **Control heights** [seen/inferred]: compact desktop 30–32px, standard 36–40px, mobile primary CTA 48–56px.
- **Borders** are 1px hairlines in very light grey, often drawn as a 0-blur 1px spread shadow instead of `border` [seen].
- **Shadows** [seen]: the secondary button is `0 1px 2px rgba(40,40,40,.08), 0 0 0 1px #ECECEC`. Floating surfaces use a large, very soft ambient shadow plus a hairline. Dark tooltips and toasts sit over light UI.
- **Mobile** [seen]: 430×932 artboards, round 40–44px icon buttons in the top bar, grouped inset list cards on a grey canvas, floating pill tab bars.

## Layout patterns [seen]

- **SaaS app shell.** Sidebar on a subtle grey, grouped nav with small muted labels, a quiet active pill, content on white with a thin top bar (breadcrumb, search with a `/` keycap, icon buttons). See [sidebar.md](sidebar.md).
- **Filter-chip row** above tables: `Range  Last 30 days ▾`, grey label, dark value.
- **Tables.** No zebra stripes, hairline row dividers, small grey header text, tinted status pills, avatar plus name plus email stacks, right-aligned tabular numbers.
- **KPI cards.** Label, big number (often mono), a delta pill (`▲ +14.7% vs last year`). Only as many cards as there are real numbers.
- **Auth and onboarding.** A split card: form on the left (logo in a soft circle, title, subtitle, Google button, "or" divider, input, primary), a product preview on the right in a grey panel with carousel dots.
- **Command palette.** 24px radius, search row with an `ESC` keycap, filter pills, grouped results, a keyboard legend footer.
- **Mobile onboarding.** Segmented progress bar plus "1/5", a centered question, selectable rows with circle checks, a sticky pill CTA.
- **Landing hero.** Floating pill navbar, a small badge, a short punchy headline, one dark primary and one quiet secondary button, a real product visual underneath.

## Icons and illustration [seen]

- Thin outline icons (about 1.5px stroke, 16–18px in UI), grey at rest, darker when active. One set per product.
- Small colored app-icon tiles (rounded squares with a glyph) for feature cards and categories, used sparingly.
- Illustration, when a product earns it: monochrome isometric line art on a dashed grid, art-directed gradient ribbons on a grainy background, or friendly flat spot illustrations for consumer apps. Animated heroes go through Rive or Lottie and pause offscreen.

## Dark and light [seen]

Ship both as matching token sets. Light is the default for productivity tools. Dark suits trading, code editors, media, and marketing banners. Dark surfaces step up in small lightness increments (`#0D0D0D → #121212 → #1A1A1A → #222`), never pure black everywhere. Shadows mostly vanish in dark mode, so depth comes from a lighter surface plus a white hairline.

## Tokens

Paste into the global stylesheet. Map them into Tailwind's `@theme` (v4) or `theme.extend` (v3) when the project uses Tailwind.

```css
:root {
  --font-sans: "Inter", "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "Geist Mono", "SF Mono", Menlo, monospace;
  --font-rounded: "SF Pro Rounded", ui-rounded, "Google Sans Rounded", var(--font-sans);

  --text-xs: 12px; --text-sm: 13px; --text-base: 14px; --text-md: 16px;
  --text-lg: 18px; --text-xl: 24px; --text-2xl: 32px; --text-3xl: 48px;
  --text-4xl: 64px; --text-5xl: 96px;
  --tracking-body: 0; --tracking-tight: -0.01em; --tracking-title: -0.03em; --tracking-display: -0.055em;

  --bg: #ffffff; --bg-subtle: #f7f7f7; --bg-muted: #f0f0f0; --bg-backdrop: #e8e8e8; --bg-raised: #ffffff;
  --border: #ececec; --border-strong: #e0e0e0;
  --fg: #171717; --fg-secondary: #737373; --fg-tertiary: #a3a3a3; --fg-inverse: #ffffff;

  --accent: #7b3aec; /* pick ONE per product */
  --accent-hover: color-mix(in oklab, var(--accent), black 8%); /* white 8% for orange, lime, coral */
  --accent-soft: color-mix(in oklab, var(--accent), white 90%);
  --accent-soft-fg: color-mix(in oklab, var(--accent), black 40%);
  --accent-fg: #ffffff; /* #0a0a0a for orange, lime, coral */
  --ring: color-mix(in oklab, var(--accent), transparent 65%);

  --success: #16a34a; --success-soft: #ecfdf3; --success-fg: #15803d;
  --danger: #dc2626;  --danger-soft: #fef2f2;  --danger-fg: #b91c1c;
  --warning: #d97706; --warning-soft: #fff7e6; --warning-fg: #b45309;
  --info: #2563eb;    --info-soft: #eef4ff;    --info-fg: #1d4ed8;

  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px;

  --radius-sm: 8px; --radius-md: 10px; --radius-lg: 12px; --radius-xl: 16px;
  --radius-2xl: 20px; --radius-3xl: 24px; --radius-full: 9999px;

  --h-control-sm: 30px; --h-control: 36px; --h-control-lg: 44px; --h-cta-mobile: 52px;

  --hairline: 0 0 0 1px var(--border);
  --shadow-btn: 0 1px 2px rgb(40 40 40 / 0.08), 0 0 0 1px #ececec;
  --shadow-btn-primary: inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(0 0 0 / 0.16),
    0 0 0 1px color-mix(in oklab, var(--accent), black 12%);
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 1px var(--border);
  --shadow-pop: 0 0 0 1px rgb(0 0 0 / 0.06), 0 8px 24px -4px rgb(0 0 0 / 0.10), 0 2px 6px rgb(0 0 0 / 0.04);
  --shadow-modal: 0 0 0 1px rgb(0 0 0 / 0.06), 0 24px 64px -12px rgb(0 0 0 / 0.18);
  --shadow-focus: 0 0 0 3px var(--ring);

  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-instant: 100ms; --dur-fast: 150ms; --dur-base: 200ms; --dur-moderate: 250ms; --dur-slow: 350ms;
}

[data-theme="dark"], .dark {
  --bg: #0d0d0d; --bg-subtle: #141414; --bg-muted: #1c1c1c; --bg-backdrop: #0a0a0a; --bg-raised: #222222;
  --border: rgb(255 255 255 / 0.08); --border-strong: rgb(255 255 255 / 0.14);
  --fg: #fafafa; --fg-secondary: #a1a1a1; --fg-tertiary: #6b6b6b; --fg-inverse: #0d0d0d;
  --accent-soft: color-mix(in oklab, var(--accent), var(--bg) 80%);
  --accent-soft-fg: color-mix(in oklab, var(--accent), white 55%);
  --success-soft: #0f2a1a; --success-fg: #4ade80;
  --danger-soft: #2d1416;  --danger-fg: #f87171;
  --warning-soft: #2b1f0a; --warning-fg: #fbbf24;
  --info-soft: #111f3a;    --info-fg: #60a5fa;
  --shadow-btn: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 0 1px rgb(255 255 255 / 0.08);
  --shadow-card: 0 0 0 1px rgb(255 255 255 / 0.07);
  --shadow-pop: 0 0 0 1px rgb(255 255 255 / 0.08), 0 16px 40px -8px rgb(0 0 0 / 0.6);
}

html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
body { font-family: var(--font-sans); font-size: var(--text-base); color: var(--fg); background: var(--bg); }
.tabular { font-variant-numeric: tabular-nums; }
```

`--fg-tertiary` fails 4.5:1 on white. Keep it for placeholders and decorative meta, never for text a user must read.

Text on a `-soft` background takes the matching `-fg` token, never the base color: `--success` and `--warning` fall near 3:1 on their own tints. Each `-fg` pair clears 4.5:1 in both themes (light 4.7–6.1, dark 6.2–9.7). `--accent-soft-fg` on `--accent-soft` clears 4.9 for every accent above. Set `--accent-fg` and `--accent-hover` as a pair, since a darker hover lowers dark text's contrast. With white text and a hover 8% toward black, violet reads 5.74 at rest and 6.85 on hover, blue 5.95 and 7.03, teal 5.47 and 6.54, and black 19.8 and 20.0. With `#0A0A0A` text and a hover 8% toward white, orange reads 6.35 and 6.99, lime 14.7 and 15.1, and coral 5.40 and 6.11. White text would fail on lime (1.35), orange (3.12), and coral (3.67), and coral's darkening hover would drop dark text to 4.42. A black accent's dark tint (`#0c0c0c`) vanishes against `--bg`, so give it a light accent in dark, with `--accent-fg` and `--accent-hover` flipped to match. `--bg-raised` is the surface for anything that floats or sits on a tinted track (popovers, thumbs, active pills), so it steps lighter in dark instead of darker.

## Style checks

Run these in the verification round when the default style applies.

- [ ] One accent. Everything else neutral or semantic.
- [ ] Inter (or Geist) plus an optional mono. At most two weights in body UI. Display sizes carry negative tracking.
- [ ] Radii follow the tiers: controls 8–10, cards 12–16, overlays 20–24.
- [ ] Depth from hairline spread shadows and soft layered shadows, not mid-grey borders.
- [ ] Tags are dark text on a light tint.
- [ ] Light and dark both ship, and dark steps up in small lightness increments.

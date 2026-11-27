# Three variants in Paper

Before you build a new screen, a new component, or a redesign, make three variants on a Paper canvas and let the user pick one. Skip it when the layout is already fixed: matching a mockup or a named reference, polishing or fixing an existing screen, or extending a screen whose siblings set the layout. Then write `skip: layout set by <what>`.

Paper is an MCP server. Its tools carry a server prefix that varies by harness, so this file names them bare: `get_guide`, `list_resources`, `get_basic_info`, `create_file`, `open_file`, `create_page`, `create_tokens`, `get_font_family_info`, `create_artboard`, `write_html`, `get_screenshot`, `export`, `get_jsx`, `get_computed_styles`, `finish_working_on_nodes`.

Before starting work, check whether Paper is open and reachable:
- If the session lists Paper tools, probe with `get_basic_info` or `list_resources`. When the call fails because Paper Desktop is closed or unreachable, **tell the user Paper is not open** and ask them to open Paper Desktop (or confirm switching to throwaway code variants). Do not silently skip Paper in an interactive session.
- If the session lists no Paper tools at all, **tell the user Paper is not connected/open** and ask whether they want to open and connect Paper first or proceed with [Without Paper](#without-paper).
- Only in autonomous runs (where nobody is there to answer: **full-send**, **full-stop**, Autopilot, or scheduled tasks) may you skip waiting, note that Paper was unavailable, and move directly to [Without Paper](#without-paper).

## 1. Read Paper's guide

Call `get_guide` with topic `paper-mcp-instructions` once per session and follow its mechanics: write one visual group per call, review with `get_screenshot` after each section, check fonts with `get_font_family_info` before the first text, switch a clipped artboard to `height: fit-content`, never show node IDs to the user, and finish with `finish_working_on_nodes`.

Its styling advice (mood words, palette pairings, Swiss editorial type, light mode first) is Paper's default taste, not the style. The [style spec](style-spec.md) wins every conflict. Use Paper's advice only for what nothing else settles: the two open directions when no style is set.

## 2. Plan the three

What the variants explore depends on what is already set.

- **The style is set** (given in the request, or the project's own): all three follow the one spec. They differ in composition: layout, hierarchy, density, what leads (the data, the main action, the content), and the navigation pattern.
- **Nothing sets the style:** variant A uses the default visual language in [style.md](style.md). B and C each get a short spec of their own (character, type, color, depth, motion) with a clearly different point of view, not a recolor of A.

Give each variant a one-line thesis that names its bet ("A: the table leads, filters live in a rail"). Use the same realistic content in all three, with the longest real values, so the comparison is about design, not data.

## 3. Post the plan first

Before any canvas change, post the target Paper file (step 4), the style spec (or the three specs), each thesis, and the shared content to the user, per Paper's guide. This is a heads-up, not a question. Keep going while they read.

## 4. Set up the canvas

- Pick the target file. Use the file the user named, or the file they're viewing when it is clearly about this work. Otherwise make a new one with `create_file`, named for the task, in the folder that holds the project's other Paper files (from `list_resources`), then `open_file`. Never write into a file about other work, even when it is the one open. When `create_file` fails, ask the user which file to use.
- Read its pages, tokens, and fonts with `get_basic_info`. Never draw on existing artboards. `create_page` named `<task> variants`, and pass its `pageId` to every `create_artboard`.
- Tokens: when the style is the project's and the file already has its tokens, use them. When the three share one spec, add its tokens once with `create_tokens`. When they each have their own spec, prefix each one's tokens (`--a-accent`, `--b-accent`, `--c-accent`).

## 5. Build each variant

Run this on the `design` size model (per `SKILL.md` model routing). If Paper is connected to the `design` subagent, it builds all three artboards one after another. If Paper is connected only to the parent session, have a `design`-size subagent write the style spec and the HTML/CSS for each variant, then write those onto Paper from the parent session so the `design` model still owns the visual craft.

- One artboard per variant, named `A · <thesis>`, `B · …`, `C · …`, at the target size: 1440×900 for desktop, 390×844 for a mobile-first product (use Paper's `mobile-status-bar` guide for the status bar).
- Build it a section at a time with `write_html`. After each section, review the screenshot against Paper's checkpoints and the spec, and fix it before the next.
- A variant is a comp of the main populated state. Hover, empty, and error states come in the code build.
- End each artboard at `height: fit-content` when the content runs past it.

## 6. Compare

Take `get_screenshot` of each finished artboard and compare them side by side against the spec, the [craft](craft.md) rules, and the [anti-slop](anti-slop.md) tells the spec didn't choose. Pick the one you'd build. Say why in two sentences, and name anything worth borrowing from the others.

Export all three with `export` as PNG at 2x. It returns file paths, or download links on Paper's remote server. Copy or download them into the proof folder as `variants/a.png`, `variants/b.png`, and `variants/c.png`. The proof folder is `~/.local/state/astack/proof/<repo>/<branch-or-slug>/`, unless your brief names another one.

## 7. The user picks

Ask the user to pick. The question has to stand alone: name the Paper file and page, give each artboard's name and thesis, give the PNG paths, and say which one you recommend and why. Offer A, B, and C. The user can also describe a mix ("A's layout with C's header"). Wait for the answer.

In an autonomous run, nobody is there to answer. That covers the **full-send** and **full-stop** skills, the Autopilot playbooks, a scheduled task, and any request that says not to wait. Take your own pick, keep going, and put the comparison and your pick in the reply.

## 8. Hand the pick to the build

- Call `get_jsx` on the chosen artboard with `includeNodeIds: false`, in `tailwind` format when the project uses Tailwind. Save it as `variants/chosen.jsx`. Call `get_computed_styles` on the nodes whose exact values matter, such as type, colors, radii, and shadows, and save the result as `variants/chosen-styles.json`.
- Code takes its values from those exports, translated into the project's components and tokens. Never read a value off a screenshot.
- The chosen PNG is the reference the build's verification round compares against.
- Call `finish_working_on_nodes` with the three artboard IDs.

## Without Paper

Never enter this path silently during an interactive session: tell the user Paper isn't open or connected first and get their go-ahead to build code variants instead (autonomous runs note it once and continue). Then make the same three variants as throwaway code. Plan, post, compare, and let the user pick exactly as above.

- Commit what the variants need. Spawn one `go-worker` subagent per variant on the `design` size, each in its own worktree and in the background. Give every one the same brief with its own thesis, plus these rules: the layout is set by its thesis, so it skips the design skill's variant step; throwaway speed over polish; its spec only; and desktop and mobile screenshots saved to its own proof folder, `.../variants/<a|b|c>/`.
- Where you can't run subagents in parallel, build the three yourself behind one switcher per the **Prototype** playbook.
- The chosen variant's code and shots carry into the build the same way the Paper exports do.

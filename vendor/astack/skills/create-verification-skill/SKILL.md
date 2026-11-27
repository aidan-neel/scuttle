---
name: create-verification-skill
description: "Generate a project-local verification skill that drives your app the way a user does, in any language, framework, or platform. Use when the user says \"make a verification skill for this repo\" or \"make a control skill\", or when a project has no scripted way to prove UI, CLI, or service behavior."
disable-model-invocation: true
---

# Create a verification skill

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

Every serious project needs a scripted way to drive the real app and prove behavior. Launch it, exercise a feature the way a user would, and capture evidence. This skill generates that as a project-local skill, `verify-<app>`, tailored to the repo. Write it for the next agent, not for a human. That agent reads it cold, mid-task, and has never seen the app.

## Where the skill goes

Put it in the project's own skills folder. Use the one the project already has:

- `.agents/skills/verify-<app>/`, which Codex, OpenCode, Devin, Copilot, and most other agents read.
- `.claude/skills/verify-<app>/`, which Claude Code reads.

If the project has neither, use `.agents/skills/`. When the team also uses Claude Code, link `.claude/skills/verify-<app>` to it. Below, `<skill>` means the folder you chose.

## 1. Interview the repo, not the user

Answer these from the codebase. Ask the user only what you cannot observe.

- **Surface.** What does a user touch? A web UI, a CLI or TUI, a desktop app, an API, a mobile app, a library? A repo can have several. Pick the primary one and note the rest.
- **Run.** How does the app start locally? Prefer the repo's own documented dev command, from package scripts, a Makefile, or the README quickstart. Note ports, env vars, seed data, and auth.
- **Drive.** How can an agent interact with it from code? Use existing harnesses first: Playwright or Cypress specs, expect scripts, PTY helpers, endpoints you can `curl`, a debug port. Only then pick a generic recipe: the **control-ui** skill for web and Electron, the **control-cli** skill for a CLI or TUI, plain HTTP for services.
- **Observe.** What evidence can you capture? Screenshots, terminal transcripts, response bodies, logs, exit codes, database state.
- **Isolate.** Can two instances run side by side, with separate ports, data dirs, and profiles? If not, say so in the generated skill. Refusing to drive a shared instance twice beats corrupting the user's session.

If the checkout doesn't build or start as it is, fix that first or report it precisely before you generate. A skill written against a broken base teaches wrong steps. When an irrelevant missing asset blocks startup, such as a static dir the API never serves or a sample config, the generated skill may create it. Mark it as verification scaffolding, and remove it in cleanup.

## 2. Generate the skill

Write `<skill>/SKILL.md` with frontmatter. Give it `name: verify-<app>` and a `description` that names the app, the surface, and when to reach for it. Without frontmatter the skill never registers. Ground each section below in what the interview found, and leave no placeholders.

- **Launch.** The exact command that starts the app for verification, how to tell it is ready, and the teardown. Launch must reach a usable state from an empty data dir, migrations and seed data included. Ready means usable, not just that a process answers. A database health check can pass while its init scripts still run. A short-lived CLI or TUI has no server to keep alive. There, launch means build the binary or install deps once, then start each drive in its own isolated PTY or tmux session.
- **Doctor.** One read-only check that answers "is this instance worth driving?" The process is up, the version or build is right, the port belongs to this run, and auth is valid. An agent runs it first whenever anything looks off.
- **Drive.** The recipe, with real selectors and commands from this repo, not examples. Prefer stable handles such as ARIA labels, data attributes, prompt strings, and route paths over coordinates and tab order.
- **Evidence.** What to capture for a proof, and where it goes. Name a location a later session can read, such as a gitignored artifacts folder, never a temp dir that cleanup or a reboot clears. State the proof standards. Exercise the real user path, not internal setters or test-only endpoints. Capture the action and the resulting state, not just the final screen. Verify side effects, such as files written, rows inserted, or messages sent, next to what is visible. Mock only where a production boundary already isolates the external system. When the safe path is a dry run or test mode, observe what it skips (files, network, git refs) instead of trusting its name. Some dry runs still touch the network or open a browser.
- **Cleanup.** How to tear down the instances the run created. Kill what you started, never by process name. Cleanup removes instances and scratch state, never the evidence. Proof survives teardown at the location the skill names.
- **Helpers.** Every script the skill ships is executable, and the skill body shows how to call it. A helper the reader has to reverse-engineer is not a helper.

## 3. Seed the feature map

Create `<skill>/features/README.md` plus one file per user-facing feature you can find. Start with the top 3 to 5, taken from routes, commands, menus, or docs. Follow the shape in [`references/feature-map-example/`](references/feature-map-example/), with a README index and one file per feature.

Each file answers, from the user's point of view, what the feature is, how to reach it, how to drive it, and what end state proves it works. Its four H2 sections are `Sub-features`, `How to get to it (user POV)`, `Driving it with <tool>`, and `Gotchas`.

If the seed data lacks a precondition that a journey needs, the journey reports a failure, and the reason goes in that feature's `Gotchas`. Never weaken the journey to make it pass. The map is the repo's maintained verification source. A proof that drives one convenient entry point is incomplete when the map lists others.

## 4. Prove the generated skill before you hand it over

Follow its own instructions once, end to end. Launch, doctor, drive one mapped feature, capture evidence, and clean up. One feature is enough, because the map exists so later runs can cover the rest. After cleanup, confirm the evidence still exists at the named location. A cleanup that eats the proof fails this step.

Fix what fails. Run the generated cleanup after every failed attempt too, so broken attempts don't strand processes and ports. A generated skill that never ran is a draft, not a deliverable.

If you proved it in a stand-in for the real target, such as a container for a fresh VM or a local stack for a remote one, list every setup step the stand-in did that the target will not. Those steps stay unverified until a run on the real target covers them.

## 5. Offer the maintenance loop

Point the user at the **maintain-verification-skill** skill for keeping the map honest as the app changes. Suggest a cadence only if they ask.

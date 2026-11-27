---
name: control-ui
description: Drive a web, Electron, or desktop UI the way a user does and keep proof that it works. Starts the app from the working tree, clicks and types through the real flow, and saves screenshots, console errors, and failed requests. Use when shipping or fixing UI, to reproduce a UI bug, or when the user says "check it in the browser", "drive the UI", or "show it working".
---

# Control UI

Prove a UI change by using it the way a user would, in the real app, and keep what you saw. A passing component test is not this proof.

## Pick the driver

Take the first one that fits.

1. **The project's own verification skill.** If the repository has a `verify-<app>` skill or an app harness, follow it, and use this skill only for what it doesn't cover. The **create-verification-skill** skill makes one.
2. **The host's preview tools, only when the user asked for browser work.** T3 Code has a built-in browser preview. Use it when the current request asks you to drive or show a page. Don't use it unasked to check your own edit.
3. **A browser automation tool the session has.** A Playwright MCP server suits a few steps. Use a Playwright script for anything you will repeat, a flow longer than a few steps, or a check you want to keep. Use the project's Playwright version when it has one, and keep throwaway scripts outside the repository.
4. **Electron apps.** Playwright's `_electron.launch()` drives the real window. Point it at the app built from your working tree.
5. **Native desktop apps.** Use a desktop-control tool if the session has one. Without one, say the flow is undriven and why.

## Before you start

- **Run the app from your working tree** with the project's dev command. Read the port it printed, because many servers move to the next free one.
- **Isolate state.** Use a fresh browser context or profile and the project's seed or test data. Never sign in with the user's real accounts or touch real customer data.
- **Avoid real cost and side effects.** Use the project's mock or sandbox mode for payments, email, and paid APIs. Stop before anything that reaches a shared or production system, and say what you would need.

## Drive the flow

1. **Do what a user does.** Navigate, click, type, and submit through the visible UI. Find elements by role and accessible name, such as `getByRole('button', { name: 'Save' })`, not by CSS class. A control you can't reach by role is an accessibility bug. Report it.
2. **Wait for state, not time.** Wait for the text, element, or response that marks the step done. Never use a fixed sleep.
3. **Check the result where it lives.** After a save, reload and confirm the data persisted. After a delete, confirm it is gone from the list and from the API.
4. **Watch the console and the network.** Record console errors and failed or 4xx and 5xx requests during the flow. A clean screenshot with a console error is not a pass.
5. **Cover the edges the change touches.** The empty state, the error state, a slow or failed request, a narrow viewport, and keyboard-only use when the change is interactive.
6. **Check light and dark** when the change touches color or theming.

## Evidence

Save a screenshot at each meaningful step, before and after for a bug fix. Use a device scale factor of 2 for screenshots a person will look at. Record a video or trace only when the flow is long or the bug depends on timing.

Write evidence where a later session can still read it: a gitignored folder the project already uses for artifacts, or `~/.local/state/astack/proof/<repo>/<branch-or-slug>/`, or the folder your brief names when parallel workers share a branch. Never commit it, and never leave the only copy in a temporary directory.

## Report

List the steps you drove, link the screenshots, and quote each console error and failed request. Show before and after for a bug fix. Name what you didn't cover, such as a browser, a viewport, a real service, or a signed-in role, and why.

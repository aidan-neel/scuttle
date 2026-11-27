---
name: maintain-verification-skill
description: "Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session that drives every feature, and at most one PR of proven corrections. Use when the user says \"audit the verify skill\" or \"maintain the verification skill\"."
disable-model-invocation: true
---

# Maintain a verification skill

> This skill names tools generically. Map them with [the harness references](../go/references/harnesses/README.md).

A feature map rots the moment the app changes. This skill is the upkeep loop for a skill that the **create-verification-skill** skill generated, or any project-local verification skill with a feature map. The unit of rigor is the feature, not every sentence. Cover every feature file from source and exercise every feature live, without running every bullet in a terminal.

## Outcomes

Pick one, and say which.

- **clean.** Every feature got source and live coverage, and nothing is worth shipping. No branch, no PR.
- **changed.** One PR ships proven doc, harness, or map corrections.
- **blocked.** Coverage could not finish, or a proven fix could not ship safely. Say exactly what blocked it.

## Edit scope

Edit only the verification skill's own folder: its `SKILL.md`, `features/`, and any scripts it owns. Never edit product code during a run. When the map describes behavior the app no longer has, that is either doc drift, so fix the map, or a product regression, so report it and don't paper over it in docs.

## Pass

0. **Locate the target.** Find the project-local skill whose body has launch and drive sections and a feature map, usually `.agents/skills/verify-*/` or `.claude/skills/verify-*/`. With several candidates, ask the user which one. With none, stop and point at the **create-verification-skill** skill instead of inventing a target.

1. **Index hygiene.** Read the feature map README and list its sibling files. Fix missing, extra, duplicate, or dead entries. Keep this light, with no generated inventory.

2. **Source wave.** Spawn one read-only subagent per feature file, all at once, in the background, on the `nano` size. Each one explains from source how its user-facing feature works, flags likely doc drift with citations, and returns one concise live-verification recipe. Children never drive the app and never edit files. Each returns four parts: a feature summary, the source entry points, likely drift or none, and one recipe.

3. **Reconcile.** Confirm every feature file has a returned summary. Merge overlapping recipes into as few app states as practical. Spot-check cited drift, and don't re-prove clean claims. Sweep recent churn for user-facing features missing from the map. Call one missing only with a concrete source path.

4. **Live pass.** Run it even when source looks clean. You own all driving. Follow the verification skill's own launch model. Drive one long-lived instance serially for servers and UIs, or start a fresh isolated session per drive for short-lived CLIs. The skill's Launch section decides, not this one. Exercise every feature at least once.

   Hold three invariants the whole pass, whatever fails.

   1. Never drive an instance you haven't health-checked since it last did something surprising. Run doctor before the first drive, on each fresh session where sessions are the unit, and again after any failed drive. Where doctor can't see the failure, such as a wedged UI on a healthy process, reset to a known state or relaunch instead of hoping.
   2. Evidence captured so far survives every cleanup. Check it at its named location. Don't assume it.
   3. Nothing a drive started outlives its use. Clean failed-attempt residue whether the session is stuck, exited, or shared. For a shared instance, clean the residue, not the instance.

   A doctor failure caused by skill drift is drift. Fix it within edit scope and retry once, restarting only what the fix invalidated, before you call the pass `blocked`. A feature you can't reach is `verified-unreachable` only with the concrete prerequisite (auth, entitlement, OS, external state) and the route you tried. If the map omits that prerequisite, that is drift. Re-drive every harness fix from triage live before it ships. Tear down after the last drive of the run, re-proofs included, so nothing outlives the run. Evidence stays, per the skill.

5. **Triage.**
   - A wrong or missing user-facing description is doc drift. Fix it.
   - Working behavior the harness can't drive is a harness gap. Fix it. A harness fix follows the same helpers rule as generation: scripts are executable, and the skill body shows how to call them.
   - App behavior that is broken is a product gap. Record it for the user, and keep it out of this PR.

6. **Ship or stop.** For **changed**, open one PR of proven corrections, and re-read every changed file first. For **clean** or **blocked**, open no PR. Report the outcome and the coverage honestly.

Keep short run notes: features covered, unreachable prerequisites, confirmed drift, and the outcome. Write them to `~/.local/state/astack/<repo>/maintain-verification.md` so a later session can pick the pass up. Don't commit them.

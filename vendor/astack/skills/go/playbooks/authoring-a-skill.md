### Authoring a skill

**You own the skill's voice.** This covers a new skill and a change to an existing one.

1. Write or edit `SKILL.md` with `name` and `description` frontmatter. The `name` matches the folder. The `description` says what the skill does and when it applies, in the words a user would say, because harnesses pick skills by that text alone.
2. When the skill lives in astack, follow the repository's `AUTHORING.md`. It asks for generic tool actions instead of harness tool names, sizes instead of models, relative links that stay inside `skills/`, and durable paths outside `/tmp`. Run `scripts/check` from the repository root and fix every problem it reports in your files.
3. Validate the rest by hand: referenced files exist, cross-skill links resolve, and every skill or principle you name exists.
4. Add test cases if the skill is structural. Skip them if it is subjective.
5. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **principle-encode-lessons-in-structure** skill. Delegate to other skills by name. Don't restate them. A workflow you keep hitting that no skill captures → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes and the `scripts/check` result.

---
name: principle-exhaust-the-design-space
description: "Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing."
disable-model-invocation: true
---

# Exhaust the Design Space

When a decision has no precedent in the codebase, the first design that works is a sample of one. Build two or three that differ in kind, put them side by side, and choose with evidence.

It also applies to product design decisions where user experience depends on feel, not logic.

- **Vary the idea, not the details.** Each candidate takes a different stance, such as inline editing against a modal against a command palette, push against pull, or one table against an event log. Three shades of one approach explore nothing.
- **Make them cheap and comparable.** Throwaway code in a scratch folder, behind one switcher or one harness that runs every candidate on the same input. The Prototype playbook of the **go** skill has the steps.
- **Judge on the real surface.** Use each one. Click through it, run it on real data, time it. Write down what each did better and worse before you pick.
- **Commit, then delete.** Pick one, record why the others lost, and delete them. The real build follows the normal path.

Skip it when the codebase already has a pattern for the problem, or when the decision is cheap to reverse later. Follow the precedent, or pick and move on.

The sign you skipped this: the first design you built is the one you shipped, and a reviewer asks "did you consider X?" and gets no answer.

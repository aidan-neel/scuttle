---
name: principle-encode-lessons-in-structure
description: "Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text."
disable-model-invocation: true
---

# Encode Lessons in Structure

When you write the same instruction a second time, or make the same correction again, move the rule into something that enforces it, such as a lint rule, a type, a metadata flag, a runtime check, a test, or a script that fails the build. Text asks the next agent to remember. Structure makes forgetting fail loudly.

If the lesson needs judgment and cannot be encoded, make the instruction more prominent and add an example of the failure mode.

**Corollary:** If the fix is structural, only use the structural fix. The instruction is the symptom.

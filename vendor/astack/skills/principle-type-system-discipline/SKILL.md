---
name: principle-type-system-discipline
description: "Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, exhaust variants, derive from authoritative schemas."
disable-model-invocation: true
---

# Type System Discipline

Make the compiler reject impossible states, mismatched primitives, and unhandled variants.

- **Make illegal states unrepresentable.** Model alternatives as a tagged union or enum, not a bag of optional fields or parallel booleans. If two fields must agree, make them one value.
- **Exhaust variants.** Match every case of a union or enum with no catch-all default, so adding a variant fails to compile everywhere it needs handling.
- **Brand semantic primitives.** If two arguments share a primitive type but mean different things, give each its own type. Validate once at creation.
- **External data is untyped until parsed.** JSON, RPC payloads, CLI args, config, environment variables, and database rows go through a parse function at the boundary that returns the typed model.
- **Derive types from authoritative schemas.** When a schema file owns a shape, derive the type from it instead of hand-rolling a parallel one.

For syntax, see the **typescript-best-practices**, **python-best-practices**, **rust-best-practices**, and **golang-best-practices** skills.

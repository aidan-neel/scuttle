# Rust

Applies to Rust workspaces and applications. The repository's `AGENTS.md` owns project-specific architecture, commands, and invariants. This guide covers practices shared across Rust repositories.

## Toolchain

- Pin the toolchain in `rust-toolchain.toml`, including `rustfmt` and `clippy`. Set `rust-version` in the workspace manifest to the minimum supported compiler. Keep CI on the pinned toolchain.
- Use Cargo for builds, tests, formatting, linting, and dependency management. Commit `Cargo.lock` for applications and workspace products, and never edit it by hand.
- The check command runs `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, and `cargo test --workspace --locked`. Add project-specific checks to that command and to CI.
- Put shared package metadata, dependency versions, and lints in `[workspace.*]` and inherit them in member crates. Keep crate dependencies explicit and one-way, with no cycles.
- Prefer stable Rust. Use nightly features only when the repository records the reason and pins the required toolchain.

## Structure and ownership

- Split crates by responsibility and dependency boundary, not by type. Keep domain rules in libraries. Binaries parse inputs, assemble dependencies, and report results.
- Keep files under the 500-line limit in the **code-best-practices** skill. Split large modules by responsibility, and don't fragment a cohesive module only to cut its line count.
- Give each rule one implementation. Before adding a helper or another validation path, search for the existing owner. When a second caller needs the same behavior, move it to a shared module and have both callers use it. Similar-looking code is not duplication when it represents different rules.
- Keep decision logic in small functions over typed inputs and return values. Put filesystem, network, process, clock, and environment access at clear boundaries, so core behavior can be tested without those effects.
- Follow Rust module conventions and keep visibility narrow: private by default, `pub(crate)` within a crate, and public APIs only where another crate or downstream user needs them. Avoid prelude modules that hide where an API comes from.

## Types, ownership, and errors

- Model valid states with types. Enums for closed sets of alternatives, newtypes for identifiers or values with distinct rules, and `Option` and `Result` for absence and failure. Avoid parallel booleans and stringly typed state when a type can make invalid combinations unrepresentable.
- Borrow by default when the caller keeps ownership. Take ownership when the function stores or transforms the value. Use `&mut` only when mutation is part of the contract. Don't clone to silence the borrow checker before you understand the ownership requirements.
- Prefer iterators and standard collection methods for straightforward transformations. Use explicit loops when they make control flow or error handling clearer. Choose ordered collections when iteration order affects output, persistence, diagnostics, or behavior.
- Return `Result` for expected failures, with specific error types and actionable context. Add context at boundaries where it helps the caller find or fix the problem, and preserve causes when wrapping errors.
- Reserve `panic!`, `expect`, and `unwrap` for tests, impossible states backed by a documented invariant, or startup failures that can't be recovered from. Never use them to handle input or I/O errors.
- Propagate errors with `?`. Don't discard errors or flatten them to strings when callers need to tell conditions apart.
- Avoid `unsafe`. When the repository records a decision permitting a specific use (an ADR or its `AGENTS.md`), keep the unsafe block minimal, document its safety invariants, and test the safe interface around it.

## Traits, generics, and dependencies

- Use a trait when it expresses a real shared capability, gives a useful test seam, or defines a public extension point. Don't introduce a trait for a single implementation to make code look abstract.
- Prefer static dispatch and concrete types inside a crate. Use `dyn Trait` at boundaries that benefit from runtime substitution. Keep generic bounds narrow.
- Use standard library types first. Before adding a dependency, look for an existing workspace dependency, then choose as the **code-best-practices** skill describes: maintenance, license, transitive cost, and whether it is needed at runtime.
- Use established crates for parsing, serialization, CLI arguments, and other edge-case-heavy work. Don't write a custom parser or protocol implementation without a recorded reason.

## Async and I/O

- Add async only when the application has concurrent I/O to do. Keep synchronous domain logic synchronous, and don't make every function async by default.
- Use the runtime the repository already chose. Don't mix runtimes, or add a runtime to a library crate without a concrete need.
- Bound external work with timeouts, size limits, and cancellation where supported. Pass clients and other I/O dependencies into the code that uses them instead of building hidden globals.
- Read and validate environment configuration once at startup, then pass typed configuration inward. Don't read environment variables throughout the application.

## Serialization and determinism

- Treat persisted structs and enums as external formats. Validate at deserialization boundaries, reject unknown or invalid data when the format calls for strictness, and provide explicit versioning and migrations for incompatible changes.
- Don't let derived serialization become an accidental public contract. Pin field names, enum representations, defaults, and compatibility behavior on purpose.
- Don't let `HashMap` or `HashSet` iteration decide user-visible output, diagnostics, saved bytes, or simulation results. Sort keys or use ordered collections where order is observable.
- Keep runtime-only and presentation-only fields out of persisted models unless the format includes them on purpose.

## Tests and checks

- Put unit tests beside the code in `#[cfg(test)]` modules, and integration tests under `tests/` for public crate behavior and cross-crate flows. Follow the repository's layout.
- Test observable behavior and error cases, not private call counts. Name tests for the behavior they protect. See the **testing-best-practices** skill.
- Keep unit tests hermetic. Inject clocks, filesystems, clients, and randomness. Ordinary tests don't call the network or read developer data.
- For deterministic code, test stable ordering and repeatability. For serialization, test round trips, and compatibility with representative older files where versioning applies.
- Run the full check command before reporting completion. Don't claim formatting, lint, or tests passed unless they ran.

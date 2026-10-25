---
description: Load before writing, running, or judging a test. How to find the repo's test conventions, what makes a test worth keeping, and the run-fix loop.
---

# Testing

Adapted from Kru's `kru-testing` skill.

Your judgment about **what makes a good test** is portable. Your judgment about **how this repo tests** is not: you learn that from the repo, every time. Never impose a framework, harness, or style from memory.

## Discover the local conventions (before writing a line)

In priority order:

1. **A project testing doc**: `AGENTS.md`, `TESTING.md`, `CONTRIBUTING.md`, `docs/testing*`. If one exists it is **authoritative**: read it fully and follow it. It outranks your defaults and your memory.
2. **Config and setup**: the runner and its config, setup files, and the `package.json` scripts. This is where you learn the real harness: simulated DOM or real browser, request mocking, fixtures, database test utilities.
3. **Existing tests**: read several nearby test files. Match their query style, mocking, structure, and naming. **The closest existing test to what you're writing is your template.**

Done when you can state in one line what harness and conventions you found. A new test should be indistinguishable from the repo's existing ones.

For runner and library specifics (matchers, render and query APIs, mocking, fixtures), check the official docs for the version the repo pins. The usual mistake is reaching for a different runner's API out of habit.

## Principles

- **Test behavior through the public interface.** Mock only at system boundaries (network, clock, third-party services), never the code under test.
- **A test edited in the same diff as the value it checks is a change-detector.** Feed literal inputs chosen to separate the subject's cases, and leave a plain constant untested.
- **The source ships one shape, and the test adapts to it.** A source file that can tell it's under test (`NODE_ENV`, an `isTest` flag), or an export only a test calls, ships a path no test runs.
- **Assert something that can fail.** Would the test still pass if every function it imports returned `undefined`? Then it observes nothing. `toBeDefined()`, a bare `not.toThrow()`, an unread snapshot, or a bare `toHaveBeenCalled` don't count. Call the subject with one concrete input and assert the literal value or effect the caller depends on; for a mock, the payload it received.
- **A test that something does not happen ships beside one proving the same read is live.**
- **Scope the assertion to the block under test, then mutation-check it.** Break the line it covers and confirm the test goes red. Watch for substring matchers: `toHaveTextContent('touched')` passes on "untouched".
- **Trace who can produce the input before testing a guard.** If only our own code feeds it from a closed set, the branch is unreachable: keep the guard, drop its test.
- **User flows over isolated renders.** One flow covering render, interaction, and result beats many "renders X" tests.
- **Cover the space**: validation failures, empty and boundary inputs, error and permission paths.
- **One reason to fail per test**, arrange-act-assert, and a name that states the behavior: `formats USD prices`.
- **Deterministic.** Control time, randomness, and network. Reset mocks between tests. No sleeps; wait on conditions. A flaky test is a failing test.
- **Right level.** Integration for confidence, unit for logic-dense pieces.

## The run-fix loop

- Run the repo's own test command, scoped to what you touched; fail fast where the runner supports it.
- **One-shot, never watch.** If the `test` script runs in watch mode, use the CI script or the runner's non-watch flag.
- On failure, read the error and either fix the test or report a real product bug. Say which. Don't loosen an assertion to hide a defect.
- Cap at about 3 fix attempts on the same failure. Still red? Stop, send it back to the builder with the error, or report what's blocking with the error.

Done when the scoped suite is green, or you've named what's blocking and why.

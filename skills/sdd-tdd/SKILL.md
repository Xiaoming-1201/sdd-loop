---
name: sdd-tdd
description: Test-driven development — the red → green loop with tests worth keeping. Use for ticket implementation in scenarios 1 and 2.
---

# sdd-tdd

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle — consult them before and during the loop, not after.

> Based on the tdd skill by Matt Pocock
> (https://github.com/mattpocock/skills), MIT License, Copyright (c) 2026 Matt Pocock.

When working, read `.workflow/context.md` so test names and interface vocabulary match the project's domain language, and respect ADRs in the area.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists — and survives refactors because it doesn't care about internal structure.

**Test user-observable behavior, not internal functions.** For UI code, the test should assert the observable result of a user action (e.g. "clicking add makes the new item appear in the list") rather than just calling the internal handler function (`addTodo()`). A test that only calls the internal function can be fully green while the real user interaction is broken (button not wired, form submitting the page, DOM not re-rendered). Write the test along the user's action path — render → input → click → assert DOM/UI state — even if the environment is simple (e.g. a plain DOM test in the project's existing test runner). If the environment cannot exercise the UI layer, state explicitly that the test covers only the logic layer and flag the UI path for manual acceptance.

## Seams — where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user (the spec's 测试决策 section records them). No test is written at an unconfirmed seam. You can't test everything — agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

## Anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel. The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological** — the assertion recomputes the expected value the way the code does, so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior. Work in **vertical slices** instead — one test → one implementation → repeat, each test a tracer bullet that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage, not the red → green implementation cycle.

## Loop discipline

For each cycle:

1. Write the failing test.
2. Run it to confirm it fails for the right reason.
3. Implement the minimal code to pass.
4. Run the test to confirm it passes.
5. Move to the next slice.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

## Output

- Incremental green tests + minimal implementations
- A final full-suite pass

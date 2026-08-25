---
name: sdd-diagnose
description: Systematized diagnosis loop for bugs and performance regressions — feedback loop first, then reproduce, hypothesize, fix with a regression test. Use in scenario 4.
---

# sdd-diagnose

A discipline for hard bugs. Skip phases only when explicitly justified.

> Based on the diagnosing-bugs skill by Matt Pocock
> (https://github.com/mattpocock/skills), MIT License, Copyright (c) 2026 Matt Pocock.

When exploring the codebase, read `.workflow/context.md` to get a clear mental model of the relevant modules, and check ADRs in the area.

## Redact

Show commands, outputs and captured artifacts — but **redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug — one that goes red on _this_ bug — you will find the cause. If you don't have one, no amount of staring at code will save you. Spend disproportionate effort here.

### Ways to construct one — in roughly this order

1. **Failing test** at whatever seam reaches the bug.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) — drives the UI, asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system that exercises the bug path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run many random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states, automate "boot at state X, check, repeat" so you can bisect it.
9. **Differential loop.** Run the same input through old-version vs new-version and diff outputs.

### Tighten the loop

Once you have a loop, tighten it: faster, sharper signal, more deterministic.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for access, a redacted captured artifact, or permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

### Completion criterion

Phase 1 is done when the loop is **tight** and **red-capable**: you can name one command you have already run at least once, that drives the actual bug code path and asserts the user's exact symptom, is deterministic, fast, and agent-runnable.

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red. Confirm the loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Then shrink the repro to the **smallest scenario that still goes red** — cut inputs, callers, config, data, and steps one at a time, re-running the loop after each cut. Done when every remaining element is load-bearing.

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Each must be **falsifiable**: state the prediction it makes ("If X is the cause, then changing Y will make the bug disappear"). Show the ranked list to the user before testing — they often have domain knowledge that re-ranks instantly.

## Phase 4 — Instrument

Each probe must map to a specific prediction from Phase 3. Change one variable at a time. Prefer a debugger/REPL inspection; fall back to targeted logs at the boundaries that distinguish hypotheses. Tag every debug log with a unique prefix (e.g. `[DEBUG-a4f2]`) so cleanup is a single grep. For performance regressions: establish a baseline measurement first, then bisect.

## Phase 5 — Fix + regression test

Write the regression test **before the fix** — but only if there is a **correct seam** for it (one where the test exercises the real bug pattern as it occurs at the call site). If no correct seam exists, that itself is the finding — note it. If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

## Phase 6 — Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All debug instrumentation removed
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the change record — so the next debugger learns

Then ask: what would have prevented this bug? If the answer involves architectural change, flag it for the orchestrator (Scenario 4 architecture check path).

## Output

- Root cause statement + the regression test that locks it down
- A `.workflow/changes/` record (via the orchestrator's change-recording step)

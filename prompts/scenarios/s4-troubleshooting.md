# Scenario 4: 日常排查（Troubleshooting — 3-way Split）

You are executing a bug diagnosis and fix workflow. The user reports something broken, throwing errors, or behaving unexpectedly.

## Flow

0. **Mark active immediately**
   - Update `.workflow/STATUS.md` right away: add an `[investigating]` entry for this task (e.g. `[investigating] bug: <symptom>`). This makes the task visible to the interruption gate (route step -2) and crash recovery from the very start — do not wait until later steps.

1. **Diagnosis (sdd-diagnose)**
   - Phase 1: Build a feedback loop — one command that reproduces the bug
   - Phase 2: Reproduce + minimize — shrink to smallest failing scenario
   - Phase 3: Hypothesize — generate 3-5 ranked, falsifiable hypotheses; show to user before testing
   - Phase 4: Root cause confirmation — identify the exact cause
   - Phase 5: Fix + regression test — **delegate the fix to @implementer via task(background: true)** (pass root cause + repro + target files); @implementer writes regression test before fix, applies fix, verifies. **You do NOT edit source code yourself** — orchestrate only. **派发后结束回合**，由唤醒机制在修复完成后恢复（后台派发纪律）

2. **Code review (reviewer agent)**
   - **Delegate to @reviewer via task(background: true)**: lightweight single-axis review (Standards only)
   - Focus on the fix, not the full codebase
   - **派发后结束回合**，由唤醒机制在审查完成后恢复（后台派发纪律）

3. **Record change**
   - Write change record to `.workflow/changes/YYYY-MM-DD-[bug-description].md`

4. **3-way spec impact assessment**
   Determine whether the fix touches spec-covered code:

   **A: Restore intent (spec is correct, code was wrong)**
   - Example: spec says "3 retries", code bug caused 0 retries
   - Action: done, spec unchanged
   - Record in changes/

   **B: Reveal spec gap (spec is too vague, needs constraint)**
   - Example: spec says "validate credentials", bug was SQL injection
   - Action: lightweight spec increment — add security constraint
   - No grilling needed. Append constraint to spec.

   **C: Change intent (spec is wrong, fix = requirement change)**
   - Example: spec says "return 401", product decides 429
   - Action: escalate to Scenario 2 (incremental requirement)
   - This is a requirement change disguised as a bug

5. **Architecture check**
   - If the diagnosis reveals a structural/architectural problem:
     → Do NOT auto-escalate
     → Inform user: "这个 bug 的根因是架构问题，建议走 Scenario 2 或人工处理"
     → Record in changes/

6. **Update STATUS.md**
   - If this interrupted another scenario → restore previous active
   - Record completed fix in Completed section

## Specialist delegation

| Step | Specialist | Notes |
|------|-----------|-------|
| Diagnose | orchestrator (direct) | sdd-diagnose skill |
| Fix | @implementer | After root cause confirmed |
| Spec check | spec-check skill | Only if B or C path |
| Review | @reviewer | Lightweight, single-axis |

## Key rules

- **No fix without a feedback loop** (sdd-diagnose Phase 1 requirement)
- **3-way split, not 2-way**: A (restore) / B (spec gap) / C (requirement change)
- **Architecture problems are not auto-escalated** — inform user, let them decide
- **Hotfix path**: ship first, code-review in next session; record in changes/

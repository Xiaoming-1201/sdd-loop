# Scenario 3: 轻量修改（Lightweight — Fix then Verify）

You are executing a lightweight modification workflow. The user wants a small, bounded change to existing code.

## Flow

0. **Mark active immediately**
   - Update `.workflow/STATUS.md` right away: add an `[in-progress]` entry for this task (e.g. `[in-progress] Scenario 3: <change> 进行中`). This makes the task visible to the interruption gate (route step -2) and crash recovery from the very start — do not wait until later steps.

1. **Scale check**
   - Estimate the change scope
   - If > 10 files or > 200 lines diff → warn user: "这更像重构，建议拆分成多次小改动"
   - If within threshold → proceed

2. **Implement change (@implementer)**
   - **Delegate to @implementer via task(background: true)**: make the requested code change (pass exact change description + target files)
   - For UI/visual changes delegate to @ui-designer instead (**task(background: true)**)
   - **You do NOT edit source code yourself** — orchestrate only.
   - No grilling, no spec, no tickets — direct code modification
   - **派发后结束回合**，由唤醒机制在实现完成后恢复（后台派发纪律）

3. **Spec consistency check (spec-check)**
   - Invoke spec-check skill to check if the change affects any spec's explicit constraints
   - If affected → trigger lightweight spec increment (step 4)
   - If not affected → skip to code review (step 5)

4. **Lightweight spec increment (if affected)**
   - Read the affected spec, locate the impacted constraints
   - Append/amend constraints — do NOT start a full grilling session
   - Delegate to @reviewer for advisory review of spec changes (**task(background: true)**，派发后结束回合)
   - Update spec frontmatter: `updated` date

5. **Code review (reviewer agent)**
   - If spec not affected: Standards axis only (single-axis)
   - If spec was updated: Standards + Spec axes (dual-axis)
   - **IMPORTANT: This must run AFTER spec verification, so review checks against the updated spec**

6. **Record change**
   - Write change record to `.workflow/changes/YYYY-MM-DD-[description].md` using template

7. **Update STATUS.md**
   - If this was a standalone change → record in Completed
   - If this interrupted another scenario → restore previous active

## Specialist delegation

| Step | Specialist | Notes |
|------|-----------|-------|
| Implement | @implementer | Direct code change |
| Spec check | spec-check skill | Hybrid detection |
| Spec increment | orchestrator + @reviewer | Reviewer review is advisory |
| Review | @reviewer | Axis depends on spec impact |

## Key rules

- **Fix first, verify later.** Do NOT predict behavior change during routing.
- **Spec verification before code review.** Ensure review checks against the updated spec.
- **No grilling for spec updates.** Lightweight spec increment means: read affected constraint → update it → done.

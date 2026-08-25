---
name: sdd-tickets
description: Break a spec into a set of tracer-bullet tickets, each declaring its blocking edges, saved to .workflow/tickets/. Use after sdd-spec in scenarios 1 and 2.
---

# sdd-tickets

Break a spec into a set of **tickets** — tracer-bullet vertical slices, each declaring the tickets that **block** it.

> Based on the to-tickets skill by Matt Pocock
> (https://github.com/mattpocock/skills), MIT License, Copyright (c) 2026 Matt Pocock.

## Process

### 1. Gather context

Work from the spec in the conversation context. If the user passes a reference (a spec path, an issue number or URL), fetch it and read its full body.

### 2. Explore the codebase (optional)

If not already explored, do so to understand the current state of the code. Ticket titles and descriptions should use the domain glossary vocabulary from `.workflow/context.md`, and respect ADRs in the area.

Look for opportunities to prefactor the code to make implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets:

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

Give each ticket its **blocking edges** — the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A wide refactor is one mechanical change whose blast radius fans across the whole codebase. Sequence it as **expand–contract**: expand (add the new form beside the old), migrate call sites in batches sized by blast radius (each batch its own ticket blocked by the expand), then contract (delete the old form once no caller remains, blocked by every migrate batch).

**Skeleton-first rule (shared integration files).** Before finalizing tickets, check whether multiple slices will touch a shared integration file/module (e.g. a root component like `App.tsx`, a shared router, a common config). From the design's §8 集成点 and §1 模块设计, identify modules that multiple tickets would all modify. If so:

- Create a **skeleton / integration-point ticket first** (serial): it establishes the shared file's section slots / routing / placeholders that the section tickets will fill.
- Make it a **blocker** of every section ticket that fills a slot in it.
- Each section ticket then writes its **own isolated file** (e.g. Hero.tsx / Footer.tsx) and only wires into the skeleton's declared slot — so they can run in parallel without file conflicts.

This converts the structural collision of vertical slicing (all slices cross the integration layer) into the existing `Blocked by` dependency edge — no new mechanism needed. Do NOT list file paths inside ticket bodies (they go stale); identify shared files during breakdown, encode them as dependency edges, not as ticket content.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct — does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Publish the tickets

Write one file per ticket under `.workflow/tickets/<NNN>-<中文能力域名>/<NN>-<中文ticket名>.md`（目录名与 spec 同名，文件编号 NN 两位补零、依赖顺序在前，如 `tickets/001-用户登录/01-接口设计.md`），numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket template below — one ticket per file, never a single combined file.

If an external tracker is configured (see the spec frontmatter `tracker` field), publish there instead and keep `.workflow/tickets/` empty.

```markdown
# <NN> — <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective — not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None — can start immediately".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2
```

Avoid specific file paths or code snippets in ticket bodies — they go stale fast.

## Output

- Ticket files saved to `.workflow/tickets/<spec>/`
- Update `.workflow/STATUS.md` with the ticket frontier (next actionable ticket)

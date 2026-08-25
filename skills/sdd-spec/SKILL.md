---
name: sdd-spec
description: Turn clarified requirements into a spec document saved to .workflow/specs/. No interview — just synthesis of what the grilling already established. Use in scenarios 1 and 2 after sdd-grilling.
---

# sdd-spec

Take the clarified requirements and codebase understanding and produce a spec. Do NOT interview the user — synthesis only. The clarification pass (`sdd-grilling`) already happened.

> Based on the to-spec skill by Matt Pocock
> (https://github.com/mattpocock/skills), MIT License, Copyright (c) 2026 Matt Pocock.

## Spec boundary — new spec vs merge into existing

Before writing a spec, determine whether the requirement is a **new spec** or an **increment to an existing spec**. A spec is a user-perceivable capability domain with its own user-story set and acceptance criteria.

**New spec** (any of these holds):

| 条件 | 含义 | 例子 |
|------|------|------|
| 不同能力域 | user-story set does not overlap existing specs | 待办事项 vs 用户登录 |
| 独立交付 | can be implemented, accepted, and released independently | 单独发布的功能模块 |
| 低耦合 | little shared code/data with existing specs; clean change boundary | 独立的新模块 |
| 规模失配 | large enough that merging would bloat the existing spec | 新需求本身是个大功能 |

**Merge into existing spec (increment)** (all of these hold):

| 条件 | 含义 | 例子 |
|------|------|------|
| 同能力域扩展 | stories append naturally to the same set | 待办加优先级、加截止日期 |
| 共享验收边界 | same feature area, same acceptance framework | 同一模块的新能力 |
| 改动落在已描述模块 | reuses existing module boundaries, no new domain | 现有模块扩展 |

When uncertain, present the user the two options with your recommendation and let them decide. Do not silently choose.

## Process

1. Explore the repo to understand the current state of the codebase, if not already done. Use the domain glossary vocabulary from `.workflow/context.md` throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which the feature will be tested. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better — the ideal number is one.

   Check with the user that these seams match their expectations.

3. Write the spec following the template below, then save it to `.workflow/specs/<NNN>-<中文名>.md` (NNN 三位补零递增，中文名用 `-` 连接，如 `001-用户登录.md`；design 必须与此同名，靠 designs/ 目录区分)。Update `.workflow/STATUS.md` active entry.

## Spec template

```markdown
---
id: <NNN>
title: <功能名称>
status: draft
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
tracker: { type: none }
---

## 问题陈述

The problem the user is facing, from the user's perspective.

## 解决方案

The solution, from the user's perspective.

## 用户故事

A LONG, numbered list of user stories:

1. 作为 <actor>，我想要 <feature>，以便 <benefit>

This list should be extremely extensive and cover all aspects of the feature.

## 实现决策

A list of implementation decisions:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets — they go stale fast.

## 测试决策

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (similar tests in the codebase)

## 不在范围内

Things explicitly out of scope for this spec.

## 附加说明

Any further notes.
```

## Output

- The spec file saved to `.workflow/specs/`
- Update `.workflow/STATUS.md` with the new active spec

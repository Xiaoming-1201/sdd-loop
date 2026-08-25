# Scenario 2: 增量需求（Incremental）

You are executing an incremental requirement workflow. The user wants to add functionality to an existing feature.

## Flow

0. **Mark active immediately**
   - Update `.workflow/STATUS.md` right away: add an `[in-progress]` entry for this task (e.g. `[in-progress] Scenario 2: <feature> 增量 进行中`). This makes the task visible to the interruption gate (route step -2) and crash recovery from the very start — do not wait until later steps.
   - 路由写 active 后：调用 `sdd-workflow-check`（不传 expectedFocus）校验状态写入

1. **Explore existing context**
   - **Delegate to @scout via task(background: true)**: explore the codebase for relevant code
   - Read `.workflow/STATUS.md` for active work
   - Read `.workflow/specs/` for existing specs
   - **Context-skip rule**: if the current session already holds full context of the relevant code and specs (e.g. the 0-1 flow for this feature just completed in this session), you MAY skip @scout. You MUST then explicitly state the skip: "检测到本会话已有相关代码/spec 上下文，跳过 @scout 侦察。" If there is any chance the code changed externally, do NOT skip — scout anyway.
   - **@scout 派发后结束回合，由唤醒机制恢复**（后台派发纪律）；其余上下文读取无需等待可立即完成

2. **Detect associated spec**
   - Scan spec frontmatter and content for relevance to the user's request
   - **This is a predictive judgment. Reliability ceiling: ~80%.**
   - **You MUST explicitly present the association**: name the spec (e.g. "关联到 spec:001-待办事项"), state the evidence (what in the request maps to what in the spec), then let the user confirm before proceeding to grilling.
   - **Then judge: increment vs new capability domain** (per sdd-spec boundary rules):
     - **Same capability domain** (stories append to the same set, change lands in described modules) → proceed as Scenario 2 increment, then classify the change type (below)
     - **Different capability domain** (new story set, independent delivery, low coupling, or scale mismatch) → this is NOT an increment — **route to Scenario 1** and create a new spec, even though a related spec exists. State the judgment: "这属于新能力域而非增量，将新建 spec"
   - **Classify the spec change type** (for increments only) and state it:
     - **追加** (additive): new capability, existing spec content untouched
     - **范围变更** (scope change): something previously in "不在范围内" is now in scope → must also update the spec's 不在范围内 section, not just append
     - **约束变更** (constraint change): an existing stated behavior/constraint changes → must amend the affected constraint
   - If uncertain, list the options and ask the user to confirm
   - If no associated spec found → route to Scenario 1 (this is a new 0-1 requirement)

3. **Grilling (sdd-grilling)**
   - Use the existing spec + codebase context as input
   - Clarify new requirements, assess impact on existing constraints
   - Output: incremental requirements that integrate with the existing spec

4. **Incremental spec update (sdd-spec)**
   - Apply the change type classified in step 2:
     - **追加**: append new user stories; existing content untouched
     - **范围变更**: append new user stories AND remove the item from the 不在范围内 section
     - **约束变更**: amend the affected constraint in place (mark what changed and why)
   - Update implementation decisions if affected
   - Update spec frontmatter: `updated` date
   - 若委托 @spec-writer → `task(background: true)` 派发后结束回合（后台派发纪律）

5. **Spec confirmation gate（spec 确认门禁）**
   - Present the user a concise spec summary — updated user stories + key decisions (from 实现决策)
   - Use the **question tool** to ask the user to confirm or request changes (no plain-text option lists)
   - Only after confirmation proceed to design; if the user requests changes, amend the spec and re-present
   - 强制调用点：确认前调用 `sdd-workflow-check`（**此时尚无 current focus，不传 expectedFocus**）校验 STATUS.md

6. **Incremental design (sdd-design)**
   - **Delegate to @design-writer via task(background: true)**: produce/amend the technical design for the change → `.workflow/designs/<spec-id>-<slug>.md`
   - Use `templates/design.md` (10 章完整模板), §1 must contain a renderable Mermaid architecture diagram
   - For 追加 with no architectural impact, a minimal design note suffices; for 范围变更/约束变更 affecting structure or interfaces, a full design pass is required
   - Cover what the change touches: interfaces, data model, key flows, integration points
   - **派发后结束回合**，由唤醒机制在设计完成后恢复（后台派发纪律）

7. **Design review (sdd-design-review)**
   - **Delegate to @reviewer via task(background: true)**: review the (amended) design against the spec (coverage, architecture soundness, risks, over-engineering)
   - **派发后结束回合**，由唤醒机制在评审完成后恢复（后台派发纪律）
   - **⚠️ 设计评审确认门禁（强制，评审返回后必须先做）**：
     - 评审返回后，**必须将设计评审结果呈现给用户确认**（question 工具：Approved→确认进入拆票 / Needs amendment→修改设计后重审）
     - **评审返回 Approved 不等于可以跳过用户确认**——确认门禁是独立步骤，先确认，再拆 tickets
     - 在用户确认之前，**不得**开始 ticket 拆分

8. **Incremental ticket breakdown (sdd-tickets)**
   - Add new tickets to `.workflow/tickets/001-[feature-name]/`
   - Number sequential from existing tickets
   - Declare blocking edges (may depend on existing tickets)

9. **Update STATUS.md**
   - Set active: `[in-progress] spec:001 / ticket:04-new-name (Scenario 2, current focus)`

10. **Implement tickets (implement + tdd)**
    - For each new ticket, in dependency order, **delegate implementation to @implementer via task(background: true)** (pass ticket content + spec requirements + design + target files).
    - @implementer follows sdd-tdd: failing test → minimal implementation → verify.
    - **You do NOT edit source code yourself** — orchestrate only.
    - **并行派发前检查共享集成文件（骨架先行）**：并行派发多个 ticket 前，检查它们是否都会修改同一共享集成文件/模块（从 design §8 集成点判断）。若多个 ticket 共指一个集成文件 → 应已有"骨架 ticket"（sdd-tickets 骨架先行规则产出）作为 blocker；若没有 → 先派骨架 ticket（串行）作 blocker，再并行派发独立文件 ticket。
    - **多个独立 ticket 可在同一条消息内并行派发（均 background: true）；派发后结束回合**，由唤醒机制恢复（后台派发纪律）

10b. **Integration check（并行完成后）**
    - 并行 ticket 全部返回后，读取各 @implementer 的**实际改动摘要**（含"改了哪些文件"），基于实际文件做重叠检测
    - 若多个 ticket 实际修改了同一文件（冲突）→ **追加一个"集成 ticket"**：委托 @implementer 跑 build/test、解 merge 冲突、验证整合后整体行为
    - 集成结果通过后再进入代码审查；**你不得自己整合冲突**（不违反"禁自改源码"硬约束）

11. **Code review (sdd-review)**
    - **Delegate to @reviewer via task(background: true)**: dual-axis review (Standards + Spec)
    - Spec axis validates both old and new spec constraints
    - **派发后结束回合**，由唤醒机制在审查完成后恢复（后台派发纪律）
    - **Design-drift check**: if the implementation deviated from the amended design (interface/architecture/data decisions changed), update the design document (affected sections + 变更记录 row, trigger "实现偏差"); if the deviation changed reviewed decisions → re-review the changed design (@reviewer); state the deviation to the user

12. **Update STATUS.md + capability-map**
    - Move completed tickets to Completed section
    - Update spec frontmatter
    - **Update `.workflow/capability-map.md`**: refresh the affected domain's row — code-area references (if the increment touched new modules), spec/design links, status. This keeps the map the durable routing asset.
    - 任务收尾前：调用 `sdd-workflow-check` 校验状态一致性
    - **User acceptance gate**: before marking the change complete, present the user a short acceptance checklist for the new behavior (e.g. "请验证：优先级选择、保存、列表显示是否正常？"). Ask the user to confirm the new flows work.
      - **用户确认** → 标记完成
      - **用户报告问题** → 保持 in-progress，路由到 Scenario 4 (troubleshooting)
      - **用户跳过验收**（"跳过验收"、"不用验了"、"直接完成"）→ 标记完成，但在 spec frontmatter 注明 `accepted: false`（跳过），changes 记录标注"用户跳过验收"——让后续会话知道该增量未经人工确认

## Specialist delegation

Same as Scenario 1, with additional @scout in step 1.

## Key rule

**Never skip spec generation.** If no associated spec exists, route to Scenario 1. "一定有 spec 才能有 ticket."

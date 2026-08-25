# Scenario 1: 0-1 需求（Greenfield）

You are executing a 0-1 requirement workflow. The user wants to build a new feature from scratch.

## Flow

0. **Mark active immediately**
   - Update `.workflow/STATUS.md` right away: add an `[in-progress]` entry for this task (e.g. `[in-progress] Scenario 1: <feature> 进行中`). This makes the task visible to the interruption gate (route step -2) and crash recovery from the very start — do not wait until later steps.
   - 路由写 active 后：调用 `sdd-workflow-check`（不传 expectedFocus）校验状态写入

1. **Detect document availability**
   - If the user provided a requirements document → read it, then proceed to grilling
   - If no document → proceed directly to grilling

2. **Grilling (sdd-grilling)**
   - With document: evaluate the document for ambiguities, missing edge cases, unstated assumptions
   - Without document: build domain model from scratch, clarify requirements round by round
   - Output: a sharp, validated set of requirements and domain vocabulary

3. **Spec drafting (sdd-spec)**
   - **Delegate to @spec-writer via task(background: true)** with the clarified requirements
   - Or write the spec directly using the sdd-grilling output
   - Save to `.workflow/specs/001-[feature-name].md` using `templates/spec.md` format
   - **派发后结束回合**，由唤醒机制在 spec 完成后恢复（后台派发纪律）

4. **Spec confirmation gate（spec 确认门禁）**
   - Present the user a concise spec summary — user stories + key decisions (from 实现决策)
   - Use the **question tool** to ask the user to confirm or request changes (no plain-text option lists)
   - Only after confirmation proceed to design; if the user requests changes, amend the spec and re-present
   - 强制调用点：确认前调用 `sdd-workflow-check`（**此时尚无 current focus，不传 expectedFocus**）校验 STATUS.md

5. **Design document (sdd-design)**
   - **Delegate to @design-writer via task(background: true)**: produce a technical design from the confirmed spec → `.workflow/designs/<spec-id>-<slug>.md`
   - Use `templates/design.md` (10 章完整模板), §1 must contain a renderable Mermaid architecture diagram
   - Cover: architecture, interfaces, data model, tech choices + reasons, key flows, risks, integration points
   - **派发后结束回合**，由唤醒机制在设计完成后恢复（后台派发纪律）

6. **Design review (sdd-design-review)**
   - **Delegate to @reviewer via task(background: true)**: review the design against the spec (coverage, architecture soundness, risks, over-engineering)
   - **派发后结束回合**，由唤醒机制在评审完成后恢复（后台派发纪律）
   - **⚠️ 设计评审确认门禁（强制，评审返回后必须先做）**：
     - 评审返回后，**必须将设计评审结果呈现给用户确认**（question 工具：Approved→确认进入拆票 / Needs amendment→修改设计后重审）
     - **评审返回 Approved 不等于可以跳过用户确认**——确认门禁是独立步骤，先确认，再拆 tickets
     - 在用户确认之前，**不得**开始 ticket 拆分

7. **Ticket breakdown (sdd-tickets)**
   - Break the spec into tracer-bullet tickets
   - Save to `.workflow/tickets/001-[feature-name]/` using `templates/ticket.md` format
   - Each ticket: vertical slice, independently verifiable, with blocking edges declared

8. **Update STATUS.md**
   - Set active: `[in-progress] spec:001 / ticket:01-name (Scenario 1, current focus)`

9. **Implement tickets (implement + tdd)**
   - For each ticket, in dependency order, **delegate implementation to @implementer via task(background: true)**:
     a. Pass the ticket content + spec requirements + design + interface contracts + target files
     b. @implementer writes failing test (sdd-tdd), implements minimal code, verifies
     c. Commit with Conventional Commits message **（环境适配：仅当 `env.json.vcs.type == "git"` 时提交；无 git 环境跳过提交步骤，提示用户手动备份/提交）**
   - Mark ticket as [x] in ticket file
   - **You do NOT edit source code yourself** — orchestrate only.
   - **并行派发前检查共享集成文件（骨架先行）**：并行派发多个 ticket 前，检查它们是否都会修改同一共享集成文件/模块（如根组件 App.tsx、共享路由、公共配置——从 design §8 集成点判断）。若多个 ticket 共指一个集成文件：
     - 应已有"骨架 ticket"（sdd-tickets 骨架先行规则产出）作为它们的 blocker
     - 若没有骨架 ticket → 先派一个骨架/集成点 ticket（串行）作为所有相关 ticket 的 blocker，再并行派发独立文件 ticket
     - 各 ticket 写自己的独立文件，只接入骨架声明的 slot
   - **多个独立 ticket 可在同一条消息内并行派发（均 background: true）；派发后结束回合**，由唤醒机制在实现完成后恢复（后台派发纪律）

9b. **Integration check（并行完成后）**
   - 并行 ticket 全部返回后，读取各 @implementer 的**实际改动摘要**（implementer 输出含"改了哪些文件"），基于实际文件而非预测文件做重叠检测
   - 若发现多个 ticket 实际修改了同一文件（冲突）→ **追加一个"集成 ticket"**：委托 @implementer 跑 build/test、解 merge 冲突、验证整合后的整体行为
   - 集成结果通过后再进入代码审查
   - **你不得自己整合冲突**（不违反"禁自改源码"硬约束）——整合交给 @implementer

10. **Code review (sdd-review)**
   - **Delegate to @reviewer via task(background: true)**: dual-axis review (Standards + Spec)
   - Review the full diff against the spec + design
   - **派发后结束回合**，由唤醒机制在审查完成后恢复（后台派发纪律）
   - **Design-drift check**: if review finds the implementation deviated from the approved design (interface/architecture/data decisions changed), do NOT silently accept it:
     - Update the design document (affected sections + 变更记录 row with trigger "实现偏差")
     - If the deviation changed reviewed interface/architecture/data decisions → **re-review the changed design** (@reviewer)
     - State the deviation to the user

11. **Update STATUS.md + capability-map**
    - Move from Active to Completed
    - Update spec frontmatter: `status: completed`
    - **Add the new capability domain to `.workflow/capability-map.md`** (if not already listed by sdd-onboard): code areas, spec/design links, status. The map is the durable routing asset for future increments.
    - 任务收尾前：调用 `sdd-workflow-check` 校验状态一致性
    - **User acceptance gate**: before marking the spec `completed`, present the user a short acceptance checklist — the core user flows to try (e.g. "请验证：新增/编辑/删除/刷新是否正常？"). Ask the user to confirm the core flows work, or report any issue.
      - **用户确认** → 标记 `completed`
      - **用户报告问题** → 保持 `in-progress`，路由到 Scenario 4 (troubleshooting)
      - **用户跳过验收**（"跳过验收"、"不用验了"、"直接完成"）→ 标记 `completed`，但在 spec frontmatter 注明 `accepted: false`（跳过），changes 记录标注"用户跳过验收"——让后续会话知道该功能未经人工确认

## Specialist delegation

| Step | Specialist | Notes |
|------|-----------|-------|
| Grilling | orchestrator (direct) | sdd-grilling skill |
| Spec | @spec-writer | Or orchestrator direct if simple |
| Design | @design-writer | Per confirmed spec, 8-chapter template |
| Tickets | orchestrator (direct) | sdd-tickets skill |
| Implement | @implementer | Per ticket, TDD driven |
| Review | @reviewer | Dual-axis review, per agent |

## Error handling

- If grilling reveals the feature is out of scope → update STATUS.md, inform user
- If ticket implementation fails → mark ticket as blocked in STATUS.md, inform user
- If the review finds critical issues → fix before marking completed

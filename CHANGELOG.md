# Changelog

All notable changes to the **sdd-loop** OpenCode plugin.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.10] - 2026-09-01

### Added
- `CHANGELOG.md`（本文件，随包发布，记录每个版本的改动）
- README 新增「版本历史」小节，指向本 CHANGELOG

### Changed
- README（中/英）同步版本历史入口

## [1.1.9] - 2026-09-01

### Fixed
- Archify 路径表述：明确 `archify/` 位于**插件目录**下（非项目根），子 agent 需用可解析路径调用 `archify/bin/archify.mjs`
- 回归检查确认 `archify/scripts/` 是运行时依赖（render 校验），完整保留

## [1.1.8] - 2026-09-01

### Changed
- README（中/英）同步 Archify 两轨制出图（架构树 + 核心特性 + 依赖与许可）
- `templates/preferences.md` 图规范偏好更新为两轨制

## [1.1.7] - 2026-09-01

### Added
- **内置 Archify**（`archify/`，复杂架构图渲染，验证门保证可读性，MIT）——解决 Mermaid dagre 自动布局导致的线条交错/重叠问题
- 图规范两轨制：复杂架构图用 Archify（JSON IR → validate 验证门 → render 出 SVG/HTML），简单图/时序/ER/状态图用 Mermaid

### Changed
- `templates/design.md`、`skills/sdd-design/SKILL.md`、`agents/design-writer.md` 图生成规范更新

## [1.1.6] - 2026-08-27

### Added
- **跨会话长期 agent 记忆**：`.workflow/preferences.md` 工程偏好/惯例沉淀（图规范/命名/技术栈/代码风格/验收标准）
- `templates/preferences.md` 模板
- reviewer 审查时识别可沉淀偏好；4 个子 agent（spec-writer/design-writer/implementer/ui-designer）开工前读取偏好

## [1.1.5] - 2026-08-27

### Added
- **index.js 纯函数单元测试**：导出 12 个纯函数（`deepMerge`/`loadConfig`/`buildFallbackChains`/`parseModelRef`/`isFallbackError`/`resolvePreset`/`getAgentModel`/`getAgentVariant`/`getAgentDisplayName`/`parseStatusFile`/`validateStatusFile`/`configCandidates`），37 个测试全通过（node:test，零依赖）
- `npm test` 脚本

## [1.1.4] - 2026-08-25

### Fixed
- **初始化目录 bug**：新空项目初始化时不再在项目根目录错误创建 `specs/`/`designs/`/`changes/`——`.workflow/` 初始化段落显式写死标准目录结构 + 硬约束；全库清理会误导建目录的裸相对路径

### Changed
- **Mermaid 图生成规范**：方向单一、subgraph 分组、节点 ≤ 20/边 ≤ 30 超限拆图、统一 `%%{init}` 配置、反模式规避、禁用 ELK（OpenCode 预览不支持）

## [1.1.3] - 2026-08-23

### Added
- README（中/英）新增「配置覆盖机制」：4 级优先级（`$OPENCODE_CONFIG_DIR` > `~/.config/opencode` > `<项目>/.opencode` > 插件默认），无需修改 node_modules

## [1.1.2] - 2026-08-23

### Added
- `README.en.md` 英文版（中英互跳）

### Fixed
- README 与插件功能一致性（7 agents / 10 skills / 12 路由 / 7 项 SDD 产物）

## [1.1.1] - 2026-08-23

### Changed
- npm 发布元数据同步（repository/homepage/README in files）

## [1.1.0] - 2026-08-20

### Added
- **首个发布**：闭环 SDD（Spec-Driven Development）交付工作流插件
- 12 类路由目标（4 大场景 + 5 条路径 + 3 前置检查）
- 7 个幕后 sub-agent（spec-writer/design-writer/researcher/scout/implementer/reviewer/ui-designer）
- 10 个内置流程技能（sdd-onboard/grilling/spec/design/design-review/tickets/tdd/review/diagnose/spec-check）
- `.workflow/` SDD 产物持久化（STATUS/specs/designs/tickets/changes/context/capability-map/env.json）
- 跨会话恢复、多 provider 模型预设、打包分发脚本
- 零外部依赖（仅 @opencode-ai/plugin），完全自包含

---

**格式说明**：`[Unreleased]` / `[x.y.z]` 链接可在 GitHub releases 中补充；本文件随 npm 包发布。

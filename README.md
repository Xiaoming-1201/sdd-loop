# sdd-loop

**闭环 SDD（Spec-Driven Development）交付工作流插件** —— 一个完全自包含的 OpenCode 插件，让 AI 从需求到交付的整个研发过程可编排、可追踪、可恢复。

## 它解决什么问题

日常研发中，AI 编码助手最大的痛点是**没有流程**：你说一句"做个登录功能"，它直接开写，没有需求澄清、没有规格文档、没有任务拆分、没有代码审查，写出来对不对全凭运气；换一个会话，上下文全丢，一切重来。

sdd-loop 把这件事做成了一条**可编排的闭环流水线**：

```
用户一句话
   ↓ 场景自动识别
需求澄清 → 规格文档 → 任务拆分 → TDD 实现 → 双轴审查 → 产物落盘
   ↓                              ↑
   └────── 跨会话恢复（下次接着干）┘
```

## 核心特性

- **单一入口**：用户只跟一个 sdd-loop agent 对话，子 agent 全部幕后执行
- **场景自适应**：自动识别 4 种研发场景，无需记住任何命令
- **规格驱动**：每个功能都有 spec 文档和 ticket 拆解，先设计后编码
- **跨会话恢复**：`.workflow/` 产物持久化，新会话自动从断点继续
- **零外部依赖**：agents + skills 全部内置，安装即用
- **可分发**：一条命令打包成 zip，接收方解压配置即可用

## 四大场景

| 场景 | 触发示例 | 流程 |
|------|---------|------|
| 0-1 需求 | "帮我做一个用户登录功能" | 澄清 → spec → tickets → 实现 → 审查 |
| 增量需求 | "在登录页加个短信验证码" | 关联已有 spec → 澄清 → 增量 spec/tickets → 实现 → 审查 |
| 轻量修改 | "把按钮颜色改成蓝色" | 直接改 → spec 一致性检查 → 轻量审查 → 变更记录 |
| 日常排查 | "登录接口报 500 了" | 反馈循环 → 复现 → 定位 → 修复 + 回归测试 → 三分法收尾 |

## 架构

```
sdd-loop（自包含插件）
├── agent/
│   └── sdd-loop.md              ← 编排器（primary，用户唯一可见）
├── agents/                      ← 6 个幕后 subagent
│   ├── spec-writer.md           ← spec 起草
│   ├── researcher.md            ← 外部文档/库研究
│   ├── scout.md                 ← 代码库侦察
│   ├── implementer.md           ← 代码实现（TDD）
│   ├── reviewer.md              ← 双轴代码审查
│   └── ui-designer.md           ← UI/UX 设计实现
├── skills/                      ← 6 个内置流程技能
│   ├── sdd-grilling/            ← 需求澄清 + 领域建模
│   ├── sdd-spec/                ← 规格文档生成
│   ├── sdd-tickets/             ← 任务拆分
│   ├── sdd-tdd/                 ← 测试驱动开发
│   ├── sdd-diagnose/            ← 系统化 bug 诊断
│   └── spec-check/              ← spec 一致性检查
├── prompts/scenarios/           ← 4 个场景的流程定义
├── templates/                   ← STATUS/spec/ticket/changes 模板
├── examples/                    ← 回归基线样本
├── sdd-loop.json                ← 多 provider 模型预设配置
└── pack.ps1                     ← 打包分发脚本
```

子 agent 只由 sdd-loop 通过任务机制调用，**不会出现在 agent 切换列表**。用户始终只面对一个入口。

## 安装

### 前置依赖

无。agents、skills、流程全部内置。

### 安装步骤

**方式 1：npm 安装（推荐，已发布到 npm）**

```powershell
npm install sdd-loop
```

然后在 `opencode.json` 的 `plugin` 数组添加包名：

```jsonc
{
  "plugin": [
    // 已有的插件保留...
    "sdd-loop"
  ]
}
```

**方式 2：本地目录**

1. 把 `sdd-loop/` 目录放到任意位置（或解压分发包）
2. 在 OpenCode 配置目录的 `opencode.json` 的 `plugin` 数组添加该目录路径：

```jsonc
{
  "plugin": [
    // 已有的插件保留...
    "D:\\Tools\\sdd-loop"
  ]
}
```

3. 检查插件目录下的 `sdd-loop.json`：确认顶层 `preset` 指向你的 provider，各 agent 的 `model` 匹配你已配置的模型（见下文）
4. 重启 OpenCode

> 插件启动时通过 config 钩子自动注册 7 个 agent 并应用 `sdd-loop.json` 的模型配置，无需手写 agent 段。

### 模型配置（sdd-loop.json）

`sdd-loop.json` 内置两套 preset，按 provider 映射各 agent 的模型：

```jsonc
{
  "preset": "volcengine",        // 顶层字段选择激活的 preset
  "presets": {
    "deepseek": { /* deepseek-official 模型 */ },
    "volcengine": { /* volcengine-plan 模型 */ }
  }
}
```

切换模型只需改顶层 `preset` 字段，或直接修改对应 agent 的 `model` 值为你已配置的 provider 模型。

## 使用

切换到 sdd-loop agent 后直接对话，无需特殊命令：

- "帮我做一个用户登录功能" → 自动走 0-1 需求流程
- "在登录页加个短信验证码" → 自动走增量需求流程
- "把按钮颜色改成蓝色" → 自动走轻量修改流程
- "登录接口报 500 了" → 自动走日常排查流程
- 闲聊/提问 → 直接回答，不触发工作流

## SDD 产物

在项目根目录的 `.workflow/` 下持久化：

```
.workflow/
├── STATUS.md       # 恢复索引（个人，gitignored）
├── context.md      # 领域词汇表（团队共享，committed）
├── specs/          # Spec 文档（团队共享，committed）
├── tickets/        # 任务拆分（个人，gitignored）
└── changes/        # 变更记录（个人，gitignored）
```

新会话启动时，sdd-loop 读 `STATUS.md` 自动恢复上次进度。

## 打包分发

在插件目录下运行（或使用完整路径，任意目录均可）：

```powershell
# 方式 1：已进入插件目录
powershell -ExecutionPolicy Bypass -File pack.ps1

# 方式 2：任意目录，用完整路径
powershell -ExecutionPolicy Bypass -File "D:\path\to\sdd-loop\pack.ps1"
```

生成 `dist/sdd-loop-<version>-<stamp>.zip`（含 node_modules 和 INSTALL.md）。接收方解压后按 zip 内 INSTALL.md 配置即可。

## 依赖与许可

- 运行时依赖仅 **@opencode-ai/plugin**（OpenCode 官方插件 SDK）
- 不依赖 oh-my-opencode-slim，可选共存、互不干扰
- 内置 skills 部分流程改编自 [Matt Pocock skills](https://github.com/mattpocock/skills)（MIT License, Copyright (c) 2026 Matt Pocock），已在各 SKILL.md 头部注明
- 本插件：MIT License

## 升级

- 内置 skills 随插件版本更新，无外部依赖漂移问题
- 场景流程定义在 `prompts/scenarios/` 下，可按需定制
- 大改动后跑 `examples/` 回归基线验证

---
id: <NNN>                  # 三位数字补零，如 001；全局唯一，递增
title: [功能名称]           # 中文功能名
status: draft              # draft | in-progress | completed | abandoned | blocked
created: [YYYY-MM-DD]
updated: [YYYY-MM-DD]
tracker: { type: none }    # 或 { type: "github", issue: "https://..." }
---

> **文件名规范**：`.workflow/specs/<NNN>-<中文名>.md`
> - 编号 `<NNN>` 三位补零（001, 002, ...），全局递增唯一
> - `<中文名>` 用 spec 的能力域名，中文 + `-` 连接，不用空格/下划线/英文缩写
> - 例：`001-用户登录.md`、`002-待办事项.md`
> - **design 文件必须与此 spec 同名**（同 `NNN` + 同中文名，靠 `designs/` 目录区分）——保证 1:1 关联

## 问题陈述

[用户面临的问题，从用户视角描述]

## 解决方案

[解决方案概述，从用户视角描述]

## 用户故事

1. 作为 [角色]，我想要 [功能]，以便 [收益]
2. ...

## 实现决策

- [决策 1]
- [决策 2]

## 测试决策

- 测试范围：[描述]
- 测试接口：[描述]

## 不在范围内

- [明确排除的内容]

## 附加说明

[其他需要说明的内容]

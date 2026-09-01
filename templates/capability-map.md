---
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# Capability Map

项目的能力域清单 —— 存量项目接入（sdd-onboard）时建立，增量维护。每个能力域对应一个 spec（1:1），后续需求通过查此表定位，不重复侦察。

| 能力域 | 核心代码区域 | 关联 spec | 关联 design | 状态 |
|--------|-------------|-----------|-------------|------|
| 待办事项 | src/todos/ | .workflow/specs/001-待办事项.md | .workflow/designs/001.md | completed |
| 用户登录 | src/auth/ | .workflow/specs/002-用户登录.md | .workflow/designs/002.md | in-progress |

## 维护规则

- **新增**：识别到地图外的新能力域（新需求命中但不在表中）→ 补一行 + 建新 spec
- **更新**：能力域的代码区域或 spec 边界变化 → 更新对应行
- **删除**：能力域废弃（spec superseded 且无后继）→ 删除行并注明
- 新需求路由：命中地图 → 增量（s2）；未命中 → 新能力域 → s1 建新 spec + 补地图

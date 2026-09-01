---
spec: <NNN>      # 必填，追溯需求源头（与 spec 文件的 id 一致，三位补零）
---

> **文件名规范**：`.workflow/tickets/<NNN>-<中文能力域名>/<NN>-<中文ticket名>.md`
> - 目录名 `<NNN>-<中文能力域名>` 与对应 spec 同名（同 `NNN` + 同中文名）
> - 文件编号 `<NN>` 两位数字（01, 02, ...），按依赖顺序编号（blocker 在前）
> - 例：`.workflow/tickets/001-用户登录/01-接口设计.md`
> - 中文名 + `-` 连接，不用空格/下划线/英文缩写

# [NN] — [Ticket title]

**What to build:** [End-to-end behavior this ticket delivers, from user perspective]

**Blocked by:** [Blocking ticket numbers/titles, or "None — can start immediately"]

**Status:** ready-for-agent

- [ ] [Acceptance criterion 1]
- [ ] [Acceptance criterion 2]

<!-- 实现依据：spec 见 .workflow/specs/<NNN>-*.md；design 章节由编排器派发时指定，不固化在此 -->

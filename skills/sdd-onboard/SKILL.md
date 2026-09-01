---
name: sdd-onboard
description: First-time onboarding into an existing (legacy) project with no .workflow/ docs — scout the architecture, build the capability map, seed the glossary, and route the current request. Run once when the project has no .workflow/ or an empty `.workflow/specs/`.
---

# sdd-onboard

存量项目接入 —— 对**没有 sdd-loop 文档**的既有代码库做一次性接入，建立后续迭代的上下文基础。只在项目无 `.workflow/` 或 `.workflow/specs/` 为空时运行；接入后后续需求直接查 capability-map，不再重复接入。

## When to run

The orchestrator routes here when: project has no `.workflow/` directory, OR `.workflow/specs/` is empty. Runs **once** per project; afterwards `.workflow/capability-map.md` exists and normal routing (s1/s2) takes over.

## 0. 环境探测（先于 Mode 1/Mode 2 执行）

无论首次接入（Mode 1）还是 re-sync（Mode 2），都先探测项目运行环境并缓存，供后续会话/技能读取。结果写入 `.workflow/env.json`（应加入 `.gitignore`，与 STATUS.md 同级处理——它是环境相关缓存，非团队共享事实）：

```json
{
  "vcs": { "type": "git" | "none", "repoRoot": "..." },
  "test": { "runner": "...", "command": "..." },
  "build": { "command": "..." }
}
```

探测方式：

- **vcs**：执行 `git rev-parse --is-inside-work-tree`，成功且返回 true → `type: "git"`，`repoRoot` 取 `git rev-parse --show-toplevel` 输出；失败/不在仓库 → `type: "none"`，`repoRoot` 省略或填项目根目录（语义：该字段仅 git 时有效）。
- **test**：探测测试框架与命令——检查 `package.json` 的 `scripts.test`、`pom.xml` 的 surefire/failsafe、`pyproject.toml` 的 pytest 等；探测不到则 `runner: "none"`, `command: ""`。
- **build**：类似探测构建命令（`npm run build` / `mvn package` 等）；探测不到则 `command: ""`。

探测结果若与已有 env.json 一致则跳过写入；不一致（环境变化）则刷新。会话启动时编排器读取本文件决定依赖 git 能力的降级路径。

## Two modes

### Mode 1: First-time onboarding (full)

Use when the project has **no `.workflow/` at all**. Full process below: scout architecture, build capability map, seed glossary.

### Mode 2: Re-sync (drift recovery)

Use when `.workflow/` exists but **code has drifted from the docs** (e.g. another agent/tool modified code without updating `.workflow/` — detected by the orchestrator's session-start drift check, or by a user request that hits an unknown capability domain).

Re-sync is **incremental, not full re-onboarding**:

0. **Re-run the environment probe**（步骤 0）：环境可能变化（如用户新 `git init`、更换测试框架）——重新探测并刷新 `.workflow/env.json`，再继续。
1. **Locate the drift**: if `env.json.vcs.type == "git"` → compare `git log` (code commits since the docs' last update) with the affected capability domains in `capability-map.md`. If **no git** → fall back to **file mtime comparison** (compare `.workflow/` doc mtimes vs code file mtimes in the affected domains) or **manual confirmation** with the user. Identify which domains/specs/designs are stale.
2. **Scout the changed area** (@scout): what actually changed in the code for the affected domains.
3. **Update the capability map**: add newly-appeared domains, update code-area references, mark stale entries.
4. **Update affected specs/designs** (only the ones touched by the drift): use `spec-check` to see which spec constraints are affected; amend specs/designs + 变更记录 rows. If a spec is materially wrong, reverse-update it from the code.
5. **Do NOT touch domains unaffected by the drift.** Re-sync is surgical — only what drifted.
6. Route the current request as usual (map now reflects reality).

Rules:
- Re-sync never rebuilds the whole map — it heals only the drifted parts.
- When the drift is large or the code contradicts the docs structurally, tell the orchestrator to ask the user whether a full re-onboard is warranted.

## Process

### 1. Architecture scouting (@scout)

Delegate to @scout to map the existing codebase:

- Entry points and overall module breakdown
- Data flow: how data enters, is stored, and is rendered
- Framework/stack + key conventions (naming, patterns, structure)
- Test setup (framework, where tests live)

### 2. Build the capability map

Identify the project's **capability domains** — user-perceivable functional areas (each will map 1:1 to a spec). Write `.workflow/capability-map.md` following `templates/capability-map.md`:

| 能力域 | 核心代码区域 | 关联 spec | 关联 design | 状态 |

- Capability domains come from the code, not from the current request — capture the whole project's surface, not just what the user asked about now.
- **This is a predictive judgment**: cross-check each candidate domain against the code (does a real module boundary back it? does it have a distinct user-facing behavior?). When uncertain about a boundary, ask the user — do not silently split or merge.
- Keep the map coarse: 3-10 domains for a typical project. Do not over-decompose.

### 3. Seed the glossary

Seed `.workflow/context.md` with the project's existing domain terms found during scouting. Keep it a glossary only — no implementation details.

### 4. Route the current request

- **Request hits an identified capability domain** → mark that domain's status in the map, then run Scenario 2 (incremental). If no spec exists for that domain yet, first reverse-build a spec for it (from the code, using `sdd-spec` with the code as the "what"), then proceed incrementally.
- **Request is a new capability domain** → add it to the map, then run Scenario 1 (new spec).

### 5. Optional: full reverse-documentation

If the user asks to document the whole project ("先梳理整个项目"), reverse-build specs+designs for the identified capability domains. Otherwise only document what the current request needs — the map is the durable artifact, specs come on demand.

## Rules

- **The map is the durable asset** — specs/designs come on demand, the capability map persists.
- **Map is incremental**: later requests that hit an unlisted domain add a row, never re-run full onboarding.
- **Honest boundaries**: when capability boundaries are ambiguous, ask the user instead of guessing.
- **Never silently diverge**: if scouting reveals the code contradicts a claimed convention, record the actual behavior.
- Write outputs in Chinese; keep the map under ~20 lines unless the project genuinely has more domains.

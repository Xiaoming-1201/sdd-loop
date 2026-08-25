---
name: spec-check
description: Lightweight spec constraint consistency check — determines whether a code change affects explicitly stated spec constraints. Uses hybrid strategy: text anchor matching + LLM semantic judgment + code-review Spec axis as fallback.
---

# spec-check

Check whether a code change affects explicitly stated constraints in existing spec documents.

## When to use

Invoked by the orchestrator after a lightweight code modification (Scenario 3) or bug fix (Scenario 4-B). Do NOT invoke during the routing phase — this is a post-change verification, not a pre-change prediction.

## Detection Strategy

### Phase 1: Text anchor matching (fast, ~60% recall)

**环境适配（无 git 降级）**：本阶段读取 `git diff` 提取标识符。若项目无 git 环境（`.workflow/env.json` 的 `vcs.type == "none"`），**跳过本阶段**，直接进入 Phase 2（由编排器提供改动文件清单 + 改动说明作为输入）。

有 git 时按原流程：

1. Read the git diff of the change.
2. Extract all function names, type names, interface names, and module names from the diff.
3. For each in-progress spec in `.workflow/specs/`, grep for these identifiers.
4. If any identifier appears in a spec, mark that spec as "potentially affected".

### Phase 2: LLM semantic judgment (precise, on candidates)

For each spec marked "potentially affected" in Phase 1（无 git 环境下：编排器提供的改动文件清单中的文件所触及的 spec）:

1. Read the spec's constraints section.
2. Read the diff. **（无 git 环境：读取编排器提供的改动说明——改动文件清单 + 改动意图，替代 diff 做语义判断）**
3. Judge: "Does this code change affect any constraint explicitly stated in the spec?"
4. Return: `{ affected: true/false, constraints: ["constraint 1", ...], recommendation: "..." }`

### Phase 3: Fallback

The code-review Spec axis always runs after code changes. If spec-check produces a false negative (missed a constraint), the Spec axis review catches it.

## Expected recall

80%+ (60% text anchor + 20%+ LLM semantic). False negatives are caught by code-review Spec axis.

## Output format

Return a structured result:

```json
{
  "specsScanned": ["specs/001-用户登录.md"],
  "affectedSpecs": [
    {
      "spec": "specs/001-用户登录.md",
      "affectedConstraints": ["登录验证3次重试限制"],
      "recommendation": "轻量 spec 增量：补充安全性约束"
    }
  ],
  "unaffectedSpecs": ["specs/002-权限管理.md"],
  "summary": "改动触及 1 个 spec 的显式约束，建议轻量 spec 增量"
}
```

If no specs are affected, return `affectedSpecs: []`.

---
name: sdd-design-review
description: Review a technical design document against its spec before implementation — architecture soundness, spec coverage, risks, omissions, over-engineering. Use after sdd-design, before sdd-tickets.
---

# sdd-design-review

Review a technical design document before tickets are split or implementation starts. A wrong architecture must fail here — the cost of fixing it after implementation is an order of magnitude higher.

## When to use

Invoked by the orchestrator after `sdd-design` produces a design document, in scenarios 1 and 2. The design is reviewed once, amended if needed, and re-reviewed only if the amendment changes the reviewed decisions.

## Review dimensions

### 1. Spec coverage
Does the design cover **every** requirement the spec states? Cross-check:
- Every user story has a corresponding design element
- Every constraint in 实现决策 is addressed
- Every seam named in 测试决策 is reachable from the design
- Missing → Critical (spec requirement with no design support)

### 2. Architecture soundness
- Are the module boundaries right? (deep modules, single responsibility)
- Is the dependency direction clean? (no cycles, no leaky abstractions)
- Is anything over-decomposed (too many shallow modules) or under-decomposed (one god module)?
- Is the design consistent with existing codebase conventions?

### 3. Architecture diagram requirement（架构图必填）

- 设计文档 §1 必须含 Mermaid 架构图且可渲染（节点、关系、闭合代码块）。
- 缺失或语法错误 → **Needs amendment**。

### 4. Risk and omissions
- Edge cases the design misses (empty states, error paths, failure modes)
- Performance hazards called out or silently ignored
- Security implications unaddressed
- Integration points with existing code — are behavior changes to existing features identified?
- A design with no risks section is suspect — flag it.

### 5. Over-engineering (YAGNI)
- Abstractions, parameters, or modules the spec doesn't require
- Tech choices with no real justification ("forced by stack" is the only acceptable non-justification)
- Speculative generality — design for needs the spec doesn't have

### 6. Spec-compliance of the design itself
- Does the design contradict the spec's stated decisions?
- Does it introduce behavior the spec explicitly excluded (不在范围内)?

## Output format

```markdown
## 结论

Approved / Needs amendment

## 发现（按严重度）

### Critical
- ...

### Important
- ...

### Minor
- ...
```

Each finding: what's wrong + where (section of the design) + what a fix looks like. Quote the design line and the spec line it violates/omits.

**Approved** → orchestrator proceeds to sdd-tickets.
**Needs amendment** → orchestrator sends the findings back, the design is amended, and only re-review if the amendment changes reviewed decisions (otherwise the amendment is accepted with the Minor findings noted).

## Constraints

- Read-only. Never edit the design document.
- Only review the design in scope — not the whole codebase.
- Severity: Critical / Important / Minor.

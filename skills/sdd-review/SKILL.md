---
name: sdd-review
description: Two-axis code review (Standards + Spec) of the diff since a fixed point — Standards (does the code follow documented standards and avoid Fowler code smells?) and Spec (does it faithfully implement the originating spec?). Use for code review in all scenarios.
---

# sdd-review

Two-axis review of the diff between a fixed point and HEAD:

- **Standards** — does the code conform to this repo's documented coding standards and avoid Fowler code smells?
- **Spec** — does the code faithfully implement the originating spec?

Both axes are reported **separately** — never merged or re-ranked.

> Based on the code-review skill by Matt Pocock
> (https://github.com/mattpocock/skills), MIT License, Copyright (c) 2026 Matt Pocock.

## Process

### 1. Pin the fixed point

Whatever the caller (orchestrator) says is the fixed point — a commit SHA, branch, tag, `main`, `HEAD~N`, or "review the current uncommitted changes". If unspecified, use the current uncommitted diff (`git diff HEAD`). Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot). Also note commits via `git log <fixed-point>..HEAD --oneline`. Confirm the fixed point resolves and the diff is non-empty before reviewing.

**环境适配（无 git 降级）**：若项目无 git 环境（`.workflow/env.json` 的 `vcs.type == "none"`，或 git 命令失败），无法用 `git diff` 定位改动。降级为**当前文件状态审查**：

- 编排器应提供**改动说明**（改动文件清单 + 每文件改动意图）
- reviewer 读取这些文件的当前状态 + 相关 spec（Spec 轴照常）
- Standards 轴照常（看代码本身是否违规/坏味道）
- 报告开头标注：**"⚠️ 无 git 环境，审查基于当前文件状态 + 编排器提供的改动说明，无法对比改动前后"**
- 若编排器未提供改动说明，先向编排器索取，不猜测改动范围

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in commit messages (`#123`, `Closes #45`, etc.)
2. A path the orchestrator passed as an argument
3. A spec file under `.workflow/specs/` matching the branch name or feature (check frontmatter `status` — prefer `in-progress`/`completed` specs)
4. If nothing found, ask the orchestrator where the spec is. If there is none, the **Spec** axis skips and reports "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written: `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `AGENTS.md`, etc.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Report per axis

**Standards report** — per file/hunk where relevant: (a) every place the diff violates a documented standard: cite the standard (file + the rule); (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces.

**Spec report** — (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding.

If the spec is missing, skip the Spec axis and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or re-rank findings — the two axes are deliberately separate.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.

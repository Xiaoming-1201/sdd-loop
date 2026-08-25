---
name: sdd-grilling
description: Relentless requirements interview to sharpen a plan, requirement, or design before spec drafting. Builds the domain glossary in .workflow/context.md as decisions land. Use for requirements clarification in scenarios 1 and 2.
---

# sdd-grilling

Interview the user relentlessly until you reach a shared understanding of the requirements. This is the clarification pass that runs before spec drafting — its output feeds `sdd-spec`.

> Based on the grilling and domain-modeling skills by Matt Pocock
> (https://github.com/mattpocock/skills), MIT License, Copyright (c) 2026 Matt Pocock.

## The interview

Map the requirements as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not write the spec until the user confirms you have reached a shared understanding.

## Domain glossary (during the interview)

Maintain the domain vocabulary in `.workflow/context.md` as terms crystallise:

- **Challenge against the glossary** — when the user uses a term that conflicts with existing entries, call it out: "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"
- **Sharpen fuzzy language** — when the user uses vague or overloaded terms, propose a precise canonical term: "You're saying 'account' — do you mean the Customer or the User? Those are different things."
- **Discuss concrete scenarios** — stress-test domain relationships with specific edge-case scenarios that force precision about concept boundaries.
- **Cross-reference with code** — when the user states how something works, check whether the code agrees and surface contradictions.
- **Update `.workflow/context.md` inline** — capture resolved terms as they happen, not batched. `context.md` is a glossary and nothing else — no specs, no implementation details.

Only offer an ADR when all three are true: hard to reverse, surprising without context, and the result of a real trade-off. Otherwise skip it.

## Input

- The user's raw request (from the orchestrator)
- For incremental requirements (Scenario 2): the existing spec + codebase context to grill against

## Output

- A validated, sharpened set of requirements
- An updated `.workflow/context.md` glossary (if terms changed)
- Confirmation from the user that the requirements are understood

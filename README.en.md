# sdd-loop

> English | **[中文](README.md)**

**Closed-loop SDD (Spec-Driven Development) delivery workflow plugin** — a fully self-contained OpenCode plugin that makes the entire AI development process orchestratable, traceable, reviewable, and resumable.

## What problem it solves

The biggest pain point of AI coding assistants is the **lack of process**: you say "build a login feature", it writes code directly — no requirements clarification, no spec document, no task breakdown, no code review. Whether the output is correct is left to chance; switch sessions and all context is lost, starting over from scratch.

sdd-loop turns this into an **orchestratable closed loop**:

```
User's one sentence
   ↓ scene auto-detection
Clarify → Spec → Design → Review → Tickets → TDD Implement → Dual-axis Review → Artifacts
   ↓                                             ↑
   └────────── cross-session resume ──────────────┘
```

## Core features

- **Single entry**: user only talks to the sdd-loop agent; all sub-agents work behind the scenes
- **Scene-adaptive**: auto-detects **12 routing targets** (4 main scenarios + 5 paths + 3 pre-checks), no commands to remember
- **Spec-driven**: every feature has a spec and ticket breakdown — design before coding
- **Cross-session resume**: `.workflow/` artifacts persist; new sessions resume from the checkpoint automatically
- **Zero external dependencies**: agents + skills all built-in, install and use
- **Distributable**: one command to package a zip; receiver extracts and configures

## 12 routing targets

**4 main scenarios**:

| Scenario | Trigger example | Flow |
|----------|----------------|------|
| Greenfield (0-1) | "Build a login feature" | Clarify → spec → design → review → tickets → implement → review → acceptance |
| Incremental | "Add SMS code to login page" | Associate existing spec → clarify → incremental spec/design/tickets → implement → review |
| Lightweight change | "Change button color to blue" | Direct change → spec consistency check → lightweight review → change record |
| Troubleshooting | "Login API returns 500" | Feedback loop → reproduce → locate → fix + regression test → 3-way split |

**5 paths** (special types):

| Path | Trigger example | Description |
|------|----------------|-------------|
| Maintenance | "Upgrade dependency / optimize performance / security hardening" | Dependency upgrade / performance / security / tech debt, with dedicated process |
| Refactor | "Extract store into a module" | Structural change without behavior change, behavior baseline locks behavior |
| Research | "Evaluate A vs B" | Exploration / selection, no code produced, findings persisted |
| Abandon / Rollback | "Drop feature 001 / revert yesterday's change" | Terminate requirement (abandon) / rollback change (rollback) |
| Bypass (fast path) | "Just change it directly, skip the process" | Skips document flow but keeps delegation, writes change record |

**3 pre-checks** (cross-cutting, run first): interruption detection (pause current task) / legacy project onboarding (sdd-onboard) / non-coding detection (answer directly)

## Architecture

```
sdd-loop (self-contained plugin)
├── agent/
│   └── sdd-loop.md              ← orchestrator (primary, user-facing)
├── agents/                      ← 7 sub-agents
│   ├── spec-writer.md           ← spec drafting
│   ├── design-writer.md         ← technical design (10-chapter)
│   ├── researcher.md            ← external docs/library research
│   ├── scout.md                 ← codebase reconnaissance
│   ├── implementer.md           ← code implementation (TDD, reads spec/design first)
│   ├── reviewer.md              ← design review + dual-axis code review
│   └── ui-designer.md           ← UI/UX design & implementation
├── skills/                      ← 10 built-in skills
│   ├── sdd-onboard/             ← legacy project onboarding + re-sync
│   ├── sdd-grilling/            ← requirements clarification + domain modeling
│   ├── sdd-spec/                ← spec generation
│   ├── sdd-design/              ← technical design (10-chapter)
│   ├── sdd-design-review/       ← design review gate
│   ├── sdd-tickets/             ← ticket breakdown (skeleton-first)
│   ├── sdd-tdd/                 ← test-driven development
│   ├── sdd-review/              ← dual-axis code review (Fowler smells)
│   ├── sdd-diagnose/            ← systematic bug diagnosis
│   └── spec-check/              ← spec consistency check
├── prompts/scenarios/           ← 4 scenario flow definitions
├── templates/                   ← spec/design/ticket/changes/capability-map/STATUS templates
├── examples/                    ← regression baseline samples
├── sdd-loop.json                ← multi-provider model preset config
└── pack.ps1                     ← packaging script
```

Sub-agents are only invoked by sdd-loop via the task mechanism and **never appear in the agent switcher**. The user always faces a single entry point.

## Installation

### Prerequisites

None. Agents, skills, and flows are all built-in.

### Install

**Option 1: npm (recommended, published)**

```bash
npm install sdd-loop
```

Then add the package name to the `plugin` array in `opencode.json`:

```jsonc
{
  "plugin": [
    // keep existing plugins...
    "sdd-loop"
  ]
}
```

**Option 2: local directory**

1. Put the `sdd-loop/` directory anywhere (or extract the distribution zip)
2. Add the directory path to the `plugin` array in `opencode.json`:

```jsonc
{
  "plugin": [
    // keep existing plugins...
    "D:\\Tools\\sdd-loop"
  ]
}
```

3. Check `sdd-loop.json` in the plugin directory: confirm the top-level `preset` points to your provider, and each agent's `model` matches models you have configured (see below)
4. Restart OpenCode

> The plugin auto-registers 7 agents via the config hook and applies `sdd-loop.json` model config — no manual agent section needed.

### Model config (sdd-loop.json)

`sdd-loop.json` ships two presets, mapping each agent's model by provider:

```jsonc
{
  "preset": "volcengine",        // top-level field selects the active preset
  "presets": {
    "deepseek": { /* deepseek-official models */ },
    "volcengine": { /* volcengine-plan models */ }
  }
}
```

Switch models by changing the top-level `preset` field, or directly editing an agent's `model` value to a provider model you have configured.

## Usage

Switch to the sdd-loop agent and just talk, no special commands:

- "Build a login feature" → auto Greenfield flow
- "Add SMS code to login" → auto Incremental flow
- "Change button color to blue" → auto Lightweight flow
- "Login API returns 500" → auto Troubleshooting flow
- Small talk / questions → answers directly, no workflow triggered

## SDD artifacts

Persisted under `.workflow/` in the project root:

```
.workflow/
├── STATUS.md          # recovery index (personal, gitignored)
├── context.md         # domain glossary (team-shared, committed)
├── capability-map.md  # capability domain map (team-shared, committed)
├── env.json           # environment probe cache (gitignored)
├── specs/             # Spec documents (team-shared, committed)
├── designs/           # Technical design documents (team-shared, committed)
├── tickets/           # Task breakdown (personal, gitignored)
└── changes/           # Change records (personal, gitignored)
```

On new session startup, sdd-loop reads `STATUS.md` to automatically resume the last progress.

## Packaging

Run in the plugin directory (or with a full path from anywhere):

```powershell
powershell -ExecutionPolicy Bypass -File pack.ps1
```

Generates `dist/sdd-loop-<version>-<stamp>.zip` (includes node_modules and INSTALL.md). Receiver extracts and follows INSTALL.md.

## Dependencies & license

- Runtime dependency: only **@opencode-ai/plugin** (official OpenCode plugin SDK)
- No dependency on oh-my-opencode-slim; optional coexistence, no interference
- Built-in skills partially adapted from [Matt Pocock skills](https://github.com/mattpocock/skills) (MIT License, Copyright (c) 2026 Matt Pocock), noted in each SKILL.md header
- This plugin: MIT License

## Upgrades

- Built-in skills ship with the plugin version — no external dependency drift
- Scenario flow definitions live under `prompts/scenarios/` and are customizable
- After major changes, run the `examples/` regression baseline to verify

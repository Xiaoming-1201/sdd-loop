// sdd-loop OpenCode plugin
// Self-contained SDD workflow plugin: registers its own agents and applies
// model presets from sdd-loop.json via the config hook.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLUGIN_NAME = "sdd-loop";

// ---------------------------------------------------------------------------
// Agent definitions (prompt files live in ./agent and ./agents)
// ---------------------------------------------------------------------------

const AGENT_DEFS = [
  {
    name: "sdd-loop",
    role: "primary",
    description:
      "SDD workflow orchestrator — scene-aware routing, delegation, and spec-driven development persistence.",
    promptFile: "agent/sdd-loop.md",
    // orchestrator may load every sdd-loop skill
    skills: ["*"],
  },
  {
    name: "spec-writer",
    role: "subagent",
    description: "Drafts spec documents from clarified requirements.",
    promptFile: "agents/spec-writer.md",
    skills: ["sdd-spec"],
  },
  {
    name: "design-writer",
    role: "subagent",
    description: "Technical design document generation from approved specs.",
    promptFile: "agents/design-writer.md",
    skills: ["sdd-design"],
  },
  {
    name: "researcher",
    role: "subagent",
    description: "External documentation and library research with citations.",
    promptFile: "agents/researcher.md",
    skills: [],
  },
  {
    name: "scout",
    role: "subagent",
    description: "Codebase reconnaissance — locate files, symbols, patterns.",
    promptFile: "agents/scout.md",
    skills: [],
  },
  {
    name: "implementer",
    role: "subagent",
    description: "Bounded code implementation under explicit specs.",
    promptFile: "agents/implementer.md",
    skills: ["sdd-tdd"],
  },
  {
    name: "reviewer",
    role: "subagent",
    description: "Dual-axis code review (Standards + Spec) and design review.",
    promptFile: "agents/reviewer.md",
    skills: ["sdd-review", "sdd-design-review", "spec-check"],
  },
  {
    name: "ui-designer",
    role: "subagent",
    description: "UI/UX design and implementation.",
    promptFile: "agents/ui-designer.md",
    skills: [],
  },
];

function loadPrompt(promptFile) {
  const path = join(__dirname, promptFile);
  if (!existsSync(path)) {
    console.error(`[${PLUGIN_NAME}] missing prompt file: ${promptFile}`);
    return `You are the ${promptFile} agent.`;
  }
  return readFileSync(path, "utf8");
}

// Load all scenario definitions and append them to the orchestrator prompt.
// This makes the scenarios available at runtime WITHOUT depending on relative
// file paths that would resolve against the user's working directory.
function loadScenarioDefinitions() {
  const scenariosDir = join(__dirname, "prompts", "scenarios");
  if (!existsSync(scenariosDir)) return "";
  const files = ["s1-greenfield.md", "s2-incremental.md", "s3-lightweight.md", "s4-troubleshooting.md"];
  const parts = [];
  for (const f of files) {
    const p = join(scenariosDir, f);
    try {
      if (existsSync(p)) {
        parts.push(readFileSync(p, "utf8"));
      }
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] failed to load scenario ${f}: ${err.message}`);
    }
  }
  if (parts.length === 0) return "";
  return "\n\n==================== SCENARIO DEFINITIONS (authoritative, loaded at plugin init) ====================\n\n" + parts.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Config loading: sdd-loop.json (plugin dir default + user config override)
// ---------------------------------------------------------------------------

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override ?? base;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) &&
      base?.[key] && typeof base[key] === "object" && !Array.isArray(base[key])
        ? deepMerge(base[key], value)
        : value;
  }
  return out;
}

function configCandidates() {
  const home = homedir();
  const list = [];
  if (process.env.OPENCODE_CONFIG_DIR) {
    list.push(join(process.env.OPENCODE_CONFIG_DIR, "sdd-loop.json"));
  }
  list.push(join(home, ".config", "opencode", "sdd-loop.json"));
  // Project-scoped override (checked before the plugin default, after user config).
  list.push(join(process.cwd(), ".opencode", "sdd-loop.json"));
  // Plugin dir ships a default config; lowest priority.
  list.push(join(__dirname, "sdd-loop.json"));
  return list;
}

function loadConfig() {
  // Priority (highest first): OPENCODE_CONFIG_DIR > ~/.config/opencode >
  // <project>/.opencode > plugin dir (default).
  // Plugin default is the base; each higher-priority file deep-merges over it.
  let merged = {};

  const basePath = join(__dirname, "sdd-loop.json");
  try {
    if (existsSync(basePath)) {
      merged = JSON.parse(readFileSync(basePath, "utf8"));
    }
  } catch (err) {
    console.error(`[${PLUGIN_NAME}] failed to parse ${basePath}: ${err.message}`);
  }

  const overlays = configCandidates().filter((p) => p !== basePath);
  let appliedPath = null;
  for (const path of overlays) {
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        merged = deepMerge(merged, parsed);
        appliedPath = path;
      }
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] failed to parse ${path}: ${err.message}`);
    }
  }
  return { configPath: appliedPath, config: merged };
}

function resolvePreset(config) {
  const active = config.preset;
  if (!active || !config.presets?.[active]) {
    return { active, preset: {} };
  }
  return { active, preset: config.presets[active] };
}

function getAgentModel(agentName, preset) {
  const override = preset[agentName];
  if (!override) return undefined;
  if (typeof override.model === "string") return override.model;
  if (Array.isArray(override.model) && override.model.length > 0) {
    const first = override.model[0];
    return typeof first === "string" ? first : first?.id;
  }
  return undefined;
}

function getAgentVariant(agentName, preset) {
  const override = preset[agentName];
  return typeof override?.variant === "string" ? override.variant : undefined;
}

function getAgentDisplayName(agentName, preset) {
  const override = preset[agentName];
  return typeof override?.displayName === "string"
    ? override.displayName
    : undefined;
}

// ---------------------------------------------------------------------------
// sdd-workflow-check tool: programmatic STATUS.md structure validation
// ---------------------------------------------------------------------------

const VALID_STATUS_VALUES = ["in-progress", "investigating", "blocked", "paused"];

function parseStatusFile(statusPath) {
  const content = readFileSync(statusPath, "utf8");
  const lines = content.split(/\r?\n/);
  let section = null;
  let inComment = false;
  let foundActive = false;
  let foundCompleted = false;
  const entries = { active: [], completed: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,3}\s+Active/.test(line)) {
      section = "active";
      foundActive = true;
      continue;
    }
    if (/^#{1,3}\s+Completed/.test(line)) {
      section = "completed";
      foundCompleted = true;
      continue;
    }
    if (/^#{1,3}/.test(line)) continue;
    if (line.startsWith("<!--")) {
      inComment = !line.includes("-->");
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (section === "active" && line.startsWith("- ")) entries.active.push(line);
    if (section === "completed" && line.startsWith("- ")) entries.completed.push(line);
  }
  return { foundActive, foundCompleted, entries };
}

function validateStatusFile(statusPath, expectedFocus) {
  if (!existsSync(statusPath)) {
    return { valid: false, issues: ["STATUS.md 缺失"], activeTasks: [], completedTasks: [] };
  }
  const issues = [];
  const { foundActive, foundCompleted, entries } = parseStatusFile(statusPath);
  const activeTasks = entries.active.map((l) => l.replace(/^-\s*/, ""));
  const completedTasks = entries.completed.map((l) => l.replace(/^-\s*/, ""));

  if (!foundActive) issues.push("缺少 Active 分区");
  if (!foundCompleted) issues.push("缺少 Completed 分区");

  const focusEntries = [];
  for (const entry of entries.active) {
    const m = /^-\s*\[([^\]]+)\]\s*(.+)$/.exec(entry);
    if (m) {
      const status = m[1].trim();
      if (!VALID_STATUS_VALUES.includes(status)) {
        issues.push(`非法状态值: [${status}]（${m[2].slice(0, 60)}）`);
      }
      if (/current focus/.test(entry)) focusEntries.push(entry);
    } else {
      issues.push(`Active 条目缺少状态标记: ${entry.slice(0, 80)}`);
    }
  }

  if (focusEntries.length > 1) {
    issues.push(`存在 ${focusEntries.length} 个 current focus 条目（应唯一）`);
  }

  if (expectedFocus !== undefined && expectedFocus !== "") {
    if (focusEntries.length === 0) {
      issues.push(`expectedFocus="${expectedFocus}" 但无 current focus 条目`);
    } else if (!focusEntries[0].includes(expectedFocus)) {
      issues.push(
        `current focus 与 expectedFocus 不匹配: 期望 "${expectedFocus}"，实际 "${focusEntries[0].replace(/^-\s*/, "").slice(0, 80)}"`
      );
    }
  }

  return { valid: issues.length === 0, issues, activeTasks, completedTasks };
}

function registerWorkflowCheckTool() {
  try {
    return {
      "sdd-workflow-check": tool({
        description:
          "校验 .workflow/STATUS.md 结构一致性（Active/Completed 分区、状态值合法、无重复 current focus）。编排器在关键节点调用。",
        args: {
          expectedFocus: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const statusPath = join(context.directory, ".workflow", "STATUS.md");
          return JSON.stringify(validateStatusFile(statusPath, args.expectedFocus));
        },
      }),
    };
  } catch (err) {
    console.error(`[${PLUGIN_NAME}] failed to register sdd-workflow-check tool: ${err.message}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// P0: Post-file-tool-nudge — 主 agent 读取/编辑文件后注入"是否该委托"提醒
// 迁移自 oh-my-opencode-slim（行为级纠正，防"读代码后自己实现"反模式）
// ---------------------------------------------------------------------------

const NUDGE_METADATA_KEY = "sdd-loop.postFileNudge";
const NUDGE_REMINDER_TEXT = `<system-reminder>
你刚读取或编辑了项目文件。检查这是否属于"读代码后自己实现"反模式：
- 若涉及源代码修改 → 必须委托 @implementer / @ui-designer（task background: true）
- 若涉及 spec/design 文档生成 → 必须委托 @spec-writer / @design-writer
- 仅 .workflow/ 下 SDD 文档（STATUS/tickets/changes/capability-map）由你直接维护
绝不自己直接编辑代码/产物文件。按后台派发纪律派发后结束回合。
</system-reminder>`;

// 文件类工具：读取/编辑后需要提醒（read 也要——"读代码后自己实现"反模式）
const FILE_TOOLS = new Set(["read", "edit", "write", "glob", "grep"]);

function createPostFileNudgeHook() {
  // sessionID -> 待注入提醒标记（一次性消费）
  const pendingNudges = new Map();
  return {
    "tool.execute.after": async (input) => {
      if (!FILE_TOOLS.has(input.tool) || !input.sessionID) return;
      // 白名单正向判定：只对 sdd-loop 会话提醒（orchestrator 是独立会话，不注入）
      // 注意：若宿主把 sdd-loop 注册为 orchestrator 别名，需在此加回判断；默认只服务 sdd-loop
      if (input.agent !== "sdd-loop") return;
      pendingNudges.set(input.sessionID, true);
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const messages = Array.isArray(output.messages) ? output.messages : [];
      const latest = [...messages].reverse().find((m) => m?.info?.role === "user" || m?.role === "user");
      if (!latest) return;
      const sessionID = latest.info?.sessionID || latest.sessionID;
      if (!sessionID || !pendingNudges.get(sessionID)) return;
      // 注入前先检查该消息是否已有提醒（幂等）
      const parts = latest.parts ?? [];
      if (parts.some((p) => p?.metadata?.[NUDGE_METADATA_KEY])) return;
      pendingNudges.delete(sessionID);
      latest.parts = [
        ...parts,
        { type: "text", synthetic: true, text: NUDGE_REMINDER_TEXT, metadata: { [NUDGE_METADATA_KEY]: true } },
      ];
    },
  };
}

// ---------------------------------------------------------------------------
// P3: JSON 错误恢复 — 子 agent 返回非法 JSON 时注入修复提醒
// 迁移自 oh-my-opencode-slim（json-error-recovery）
// ---------------------------------------------------------------------------

const JSON_ERROR_EXCLUDED_TOOLS = new Set(["bash", "read", "glob", "webfetch"]);
const JSON_ERROR_PATTERNS = [
  /json parse error/i,
  /failed to parse json/i,
  /invalid json/i,
  /malformed json/i,
  /unexpected end of json input/i,
  /syntaxerror:\s*unexpected token.*json/i,
];
const JSON_ERROR_MARKER = "[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]";
const JSON_ERROR_REMINDER = `
${JSON_ERROR_MARKER}
You sent invalid JSON arguments. The system could not parse your tool call.
STOP and do this NOW:
1. LOOK at the error message to see what was expected vs what you sent.
2. CORRECT your JSON syntax (missing braces, unescaped quotes, trailing commas).
3. RETRY the tool call with valid JSON.
DO NOT repeat the exact same invalid call.
`;

function createJsonErrorRecoveryHook() {
  return {
    "tool.execute.after": async (input, output) => {
      if (JSON_ERROR_EXCLUDED_TOOLS.has(String(input.tool).toLowerCase())) return;
      if (typeof output.output !== "string") return;
      if (output.output.includes(JSON_ERROR_MARKER)) return;
      if (JSON_ERROR_PATTERNS.some((p) => p.test(output.output))) {
        output.output += JSON_ERROR_REMINDER;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// P1: Foreground-fallback — 模型故障时自动切换备用模型链
// 迁移自 oh-my-opencode-slim（精简版：只处理我们见过的 400/429/401/403/quota）
// ---------------------------------------------------------------------------

const FALLBACK_DEDUP_MS = 5000;
const FALLBACK_ERROR_PATTERNS = [
  /reasoning_content/i, // deepseek thinking 回传错误
  /token quota is not enough/i, // 配额不足
  /rate.?limit/i,
  /429/i,
  /401/i,
  /403/i,
];

function isFallbackError(error) {
  if (!error) return false;
  const text = typeof error === "string" ? error : [error.message, error.data?.message, error.data?.responseBody].filter(Boolean).join(" ");
  return FALLBACK_ERROR_PATTERNS.some((p) => p.test(text));
}

function parseModelRef(model) {
  const idx = String(model).indexOf("/");
  if (idx <= 0 || idx >= String(model).length - 1) return null;
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}

// 从 sdd-loop.json preset 提取各 agent 的备用模型链。
// 规则：主模型 + 该 preset 下同 provider 的其他模型（去重，主模型在前）。
// 备用不足时跨 provider 补充（优先其他 preset 的模型），保证总有可切换的 fallback。
// 同时为 sdd-loop 注册 orchestrator 别名（宿主主 agent 实际名为 orchestrator）。
function buildFallbackChains(config) {
  const chains = {};
  const active = config.preset;
  const preset = config.presets?.[active];
  if (!preset) return chains;
  // 收集所有 preset 的全部模型，用于跨 provider 补充
  const allModels = new Set();
  for (const [, p] of Object.entries(config.presets ?? {})) {
    for (const [, e] of Object.entries(p)) {
      const m = typeof e?.model === "string" ? e.model : Array.isArray(e?.model) ? (typeof e.model[0] === "string" ? e.model[0] : e.model[0]?.id) : undefined;
      if (m) allModels.add(m);
    }
  }
  for (const [agentName, entry] of Object.entries(preset)) {
    const primary = typeof entry?.model === "string" ? entry.model : Array.isArray(entry?.model) && entry.model.length > 0 ? (typeof entry.model[0] === "string" ? entry.model[0] : entry.model[0]?.id) : undefined;
    if (!primary) continue;
    const providerID = primary.split("/")[0];
    const seen = new Set([primary]);
    const alternatives = [];
    // 1) 同 provider 的其他模型
    for (const [, other] of Object.entries(preset)) {
      const m = typeof other?.model === "string" ? other.model : Array.isArray(other?.model) ? (typeof other.model[0] === "string" ? other.model[0] : other.model[0]?.id) : undefined;
      if (m && !seen.has(m) && m.startsWith(providerID + "/")) {
        seen.add(m);
        alternatives.push(m);
      }
    }
    // 2) 跨 provider 补充（不同 provider 的模型作为兜底 fallback）
    for (const m of allModels) {
      if (seen.has(m) || m.startsWith(providerID + "/")) continue;
      seen.add(m);
      alternatives.push(m);
    }
    const chain = [primary, ...alternatives];
    chains[agentName] = chain;
    // 主 agent（sdd-loop）同时注册 orchestrator 别名，兼容宿主命名
    if (agentName === "sdd-loop" && !chains["orchestrator"]) {
      chains["orchestrator"] = chain;
    }
  }
  return chains;
}

function createForegroundFallbackHook(ctx, config) {
  const chains = buildFallbackChains(config);
  const enabled = Object.keys(chains).length > 0;
  const sessionModel = new Map(); // sessionID -> current model
  const sessionAgent = new Map(); // sessionID -> agent name
  const sessionTried = new Map(); // sessionID -> Set<model>
  const lastTrigger = new Map();
  const inProgress = new Set();

  async function abortSession(sessionID) {
    try {
      await ctx.client.session.abort({ path: { id: sessionID } });
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] fallback abort failed: ${e.message}`);
    }
  }

  async function execFallback(sessionID, error) {
    if (!sessionID || inProgress.has(sessionID)) return;
    const agentName = sessionAgent.get(sessionID);
    const chain = agentName ? chains[agentName] : undefined;
    if (!chain || chain.length < 2) return;
    // 去重窗口
    const now = Date.now();
    if (now - (lastTrigger.get(sessionID) ?? 0) < FALLBACK_DEDUP_MS) return;
    lastTrigger.set(sessionID, now);

    let tried = sessionTried.get(sessionID) ?? new Set();
    const currentModel = sessionModel.get(sessionID);
    if (currentModel) tried.add(currentModel);
    const nextModel = chain.find((m) => !tried.has(m));
    if (!nextModel) {
      console.error(`[${PLUGIN_NAME}] fallback chain exhausted for ${sessionID}`, { agentName, chain, tried: [...tried] });
      return;
    }
    const ref = parseModelRef(nextModel);
    if (!ref) return;
    tried.add(nextModel);
    sessionTried.set(sessionID, tried);
    sessionModel.set(sessionID, nextModel);
    inProgress.add(sessionID);
    try {
      console.error(`[${PLUGIN_NAME}] fallback: ${currentModel ?? "unknown"} -> ${nextModel} (${sessionID}, ${agentName ?? "?"})`);
      await abortSession(sessionID);
      await new Promise((r) => setTimeout(r, 300));
      // 找到最后一条用户消息重放
      const result = await ctx.client.session.messages({ path: { id: sessionID } });
      const messages = result.data ?? [];
      const lastUser = [...messages].reverse().find((m) => m?.type === "user" || m?.info?.role === "user");
      if (!lastUser) return;
      const parts = Array.isArray(lastUser.parts) ? lastUser.parts : typeof lastUser.text === "string" && lastUser.text.length > 0 ? [{ type: "text", text: lastUser.text }] : [];
      if (parts.length === 0) return;
      if (typeof ctx.client.session.promptAsync !== "function") return;
      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [...parts, { type: "text", synthetic: true, text: "Foreground fallback replay." }], model: ref, ...(agentName ? { agent: agentName } : {}) },
      });
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] fallback exec failed: ${e.message}`);
    } finally {
      inProgress.delete(sessionID);
    }
  }

  return {
    event: async ({ event }) => {
      if (!enabled || !event?.type) return;
      // 监听消息/会话事件中的故障错误
      if (event.type === "session.error") {
        const props = event.properties ?? {};
        const sessionID = props.sessionID || props.info?.id;
        if (sessionID && isFallbackError(props.error ?? props.message)) {
          await execFallback(sessionID, props.error ?? props.message);
        }
      } else if (event.type === "message.updated") {
        const info = event.properties?.info;
        if (!info?.sessionID) return;
        if (typeof info.agent === "string") sessionAgent.set(info.sessionID, info.agent);
        if (typeof info.providerID === "string" && typeof info.modelID === "string") {
          sessionModel.set(info.sessionID, `${info.providerID}/${info.modelID}`);
        }
        if (info.error && isFallbackError(info.error)) {
          await execFallback(info.sessionID, info.error);
        }
      } else if (event.type === "subagent.session.created") {
        const props = event.properties;
        if (props?.sessionID && typeof props.agentName === "string") {
          sessionAgent.set(props.sessionID, props.agentName);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// P2: Phase-reminder — 每条用户消息后注入当前流程阶段提醒
// 迁移自 oh-my-opencode-slim（缓存安全：只追加尾部，幂等去重）
// ---------------------------------------------------------------------------

const PHASE_METADATA_KEY = "sdd-loop.phaseReminder";

function createPhaseReminderHook() {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const messages = Array.isArray(output.messages) ? output.messages : [];
      const latest = [...messages].reverse().find((m) => m?.info?.role === "user" || m?.role === "user");
      if (!latest) return;
      // 只对 sdd-loop 编排器会话注入 phase 提醒，避免污染其他 agent 会话
      //（如 orchestrator、其他项目窗口）。与 postFileNudgeHook 的归属过滤一致。
      const sessionAgent = latest.info?.agent || latest.agent;
      // 白名单正向判定：只对 sdd-loop 会话注入；agent 缺失/为其他名一律不注入，
      // 彻底消除 orchestrator 等独立会话的跨会话污染。
      if (sessionAgent !== "sdd-loop") return;
      const parts = latest.parts ?? [];
      if (parts.some((p) => p?.metadata?.[PHASE_METADATA_KEY])) return;
      // 从 STATUS.md 读取当前 focus 生成提醒（失败则用通用提醒）
      let focusText = "";
      try {
        const statusPath = join(process.cwd(), ".workflow", "STATUS.md");
        if (existsSync(statusPath)) {
          const content = readFileSync(statusPath, "utf8");
          const focusLine = content.split(/\r?\n/).find((l) => /current focus/.test(l));
          if (focusLine) focusText = focusLine.replace(/^-\s*/, "").slice(0, 120);
        }
      } catch {}
      const reminder = focusText
        ? `<system-reminder>\n当前进行中任务（current focus）：${focusText}\n继续推进当前流程，按对应场景/路径的流程步骤执行。\n</system-reminder>`
        : `<system-reminder>\n继续推进当前 sdd-loop 流程。有进行中任务时按 STATUS.md 恢复；无任务时等待用户输入。\n</system-reminder>`;
      latest.parts = [...parts, { type: "text", synthetic: true, text: reminder, metadata: { [PHASE_METADATA_KEY]: true } }];
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

// Exported pure/param-driven functions for unit testing (node:test, no deps).
// These are the deterministic helpers used throughout the plugin; keeping them
// exported does not change behavior or the default plugin export below.
export {
  deepMerge,
  configCandidates,
  loadConfig,
  buildFallbackChains,
  parseModelRef,
  isFallbackError,
  resolvePreset,
  getAgentModel,
  getAgentVariant,
  getAgentDisplayName,
  parseStatusFile,
  validateStatusFile,
};

export const id = PLUGIN_NAME;

export default {
  id,
  server: async (input) => {
    const { config } = loadConfig();
    const { active, preset } = resolvePreset(config);

    // Build the agent map OpenCode consumes. Each entry carries model/variant
    // resolved from the active preset (config hook re-applies them too, but
    // providing defaults here keeps the sidebar correct on first render).
    const scenarioDefs = loadScenarioDefinitions();
    const agents = {};
    for (const def of AGENT_DEFS) {
      let prompt = loadPrompt(def.promptFile);
      // The orchestrator (sdd-loop) gets the full scenario definitions
      // injected at load time so it never depends on runtime file paths.
      if (def.name === "sdd-loop" && scenarioDefs) {
        prompt = prompt + scenarioDefs;
      }
      const entry = {
        model: getAgentModel(def.name, preset),
        prompt,
        description: def.description,
      };
      // Explicit skill allowlist per agent so subagents can reliably load the
      // skills their role needs (and nothing else). OpenCode defaults to
      // allowing skills; declaring the list (even empty) makes the contract
      // deterministic — an empty list means "no sdd-loop skills".
      if (def.skills) {
        entry.skills = def.skills;
      }
      const variant = getAgentVariant(def.name, preset);
      if (variant) entry.variant = variant;
      const displayName = getAgentDisplayName(def.name, preset);
      if (displayName) entry.displayName = displayName;
      // primary agents are user-switchable; subagents are callable only by
      // the orchestrator via the task tool and never shown in the switcher.
      entry.mode = def.role === "primary" ? "primary" : "subagent";
      // The primary orchestrator needs the question tool for the decision
      // gates (spec/design/review confirmation). Without explicit permission,
      // plugin-registered agents may not get it in CLI environments.
      // 注：PermissionObjectConfig 最小验证（.workflow/** allow + ** deny）实测发现
      // pattern 匹配基准不匹配——绝对路径不命中相对 pattern，误拦了主 agent 对 .workflow/
      // 的合法编辑（破坏编排职责）。已回退为 question: allow，待确认 pattern 基准后再落地。
      if (def.role === "primary") {
        entry.permission = { ...(entry.permission ?? {}), question: "allow" };
      }
      agents[def.name] = entry;
    }

    // 迁移自 slim 的四个机制（P0-P3），全部包 try/catch 保证不阻塞启动。
    // 注意：多个 hook 可能定义同名钩子（如 messages.transform / tool.execute.after），
    // 必须链式合并而非 Object.assign 覆盖，否则后注册的会静默顶掉前一个。
    const hookGroups = {};
    const registerHooks = (hooks) => {
      for (const [key, fn] of Object.entries(hooks)) {
        if (!fn) continue;
        if (hookGroups[key]) {
          const prev = hookGroups[key];
          hookGroups[key] = async (...args) => {
            await prev(...args);
            await fn(...args);
          };
        } else {
          hookGroups[key] = fn;
        }
      }
    };
    try {
      registerHooks(createPostFileNudgeHook());
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] failed to init post-file-nudge: ${e.message}`);
    }
    try {
      registerHooks(createJsonErrorRecoveryHook());
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] failed to init json-error-recovery: ${e.message}`);
    }
    try {
      // 使用插件注入的 client（PluginInput.client）；host 未提供时跳过 fallback 初始化
      if (input?.client) {
        registerHooks(createForegroundFallbackHook({ client: input.client, directory: input.directory ?? process.cwd() }, loadConfig().config));
      }
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] failed to init foreground-fallback: ${e.message}`);
    }
    try {
      registerHooks(createPhaseReminderHook());
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] failed to init phase-reminder: ${e.message}`);
    }

    return {
      tool: registerWorkflowCheckTool(),
      agent: agents,
      ...hookGroups,
      config: async (opencodeConfig) => {
        // Merge our agents into the host config. If the user already defined
        // an agent with the same name, keep their overrides (model etc.).
        if (!opencodeConfig.agent) {
          opencodeConfig.agent = {};
        }
        for (const [name, pluginAgent] of Object.entries(agents)) {
          const existing = opencodeConfig.agent[name];
          opencodeConfig.agent[name] = existing
            ? { ...pluginAgent, ...existing }
            : { ...pluginAgent };
        }

        // Apply the active preset: re-resolve from config each time so a
        // preset switch takes effect.
        const reResolved = resolvePreset(loadConfig().config).preset;
        for (const [name, entry] of Object.entries(opencodeConfig.agent)) {
          const model = getAgentModel(name, reResolved);
          if (model) entry.model = model;
          const variant = getAgentVariant(name, reResolved);
          if (variant) entry.variant = variant;
          const displayName = getAgentDisplayName(name, reResolved);
          if (displayName) entry.displayName = displayName;
        }

        if (active && !opencodeConfig.default_agent) {
          // Prefer sdd-loop as the default when this plugin is active and the
          // host has no explicit default.
          opencodeConfig.default_agent = "sdd-loop";
        }
      },
    };
  },
};

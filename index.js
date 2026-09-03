// sdd-loop OpenCode plugin
// Self-contained SDD workflow plugin: registers its own agents and applies
// model presets from sdd-loop.json via the config hook.

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fork } from "node:child_process";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
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
// P4: Gate timeout — question 工具（确认门禁）弹出后 N 分钟未回复，把待确认项写入
// .workflow/pending-confirms/（飞书守护进程 scripts/feishu-daemon.mjs 轮询该目录并
// 发送确认卡片）。事件类型/schema 按 @opencode-ai/sdk 的 question 事件定义：
//   question.asked     properties: { id, sessionID, questions: [{question, header, options}] }
//   question.replied   properties: { sessionID, requestID, answers }
//   question.rejected  properties: { sessionID, requestID }
// replied/rejected 通过 requestID（= asked 的 properties.id）关联取消定时器。
// 不配置 feishu / enabled=false / gateTimeoutMinutes<=0 → 返回空 hook，零行为影响。
// ---------------------------------------------------------------------------

function createQuestionTimeoutHook(directory, config, client) {
  const feishuCfg = config?.feishu;
  const timeoutMinutes = feishuCfg?.gateTimeoutMinutes;
  const enabled =
    Boolean(feishuCfg) && feishuCfg.enabled !== false && typeof timeoutMinutes === "number" && timeoutMinutes > 0;
  if (!enabled) return {};

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const pendingDir = join(directory, ".workflow", "pending-confirms");
  const requestTimers = new Map(); // requestId -> Array<setTimeout handle>
  const consumedSet = new Set(); // 已成功喂回 opencode 的 fileId（防重复喂回）
  const requestCounts = new Map(); // requestId -> 该批问题数（armTimeout 时记录，批次合并用）
  const waitingSet = new Set(); // 已 answered 但等待同批其他项的 fileId
  const fedBackRequestIds = new Set(); // 已完成批次喂回的 requestId

  // gate 日志写文件（避免 console.error 被宿主回显到 opencode UI，与 diag 同理）
  const gateLogPath = join(pendingDir, "gate.log");
  function gateLog(msg) {
    try {
      mkdirSync(pendingDir, { recursive: true });
      appendFileSync(gateLogPath, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
    } catch {}
  }

  function writePendingConfirm(question, options, requestId, inputOnly, sessionID) {
    mkdirSync(pendingDir, { recursive: true });
    const id = randomUUID();
    const item = {
      id,
      createdAt: new Date().toISOString(),
      source: "gate:question-timeout",
      requestId: requestId || null,
      sessionID: sessionID || null, // 关联会话 ID，喂回失败时降级注入用
      question: typeof question === "string" && question.trim() ? question.trim() : "需要确认",
      options:
        inputOnly
          ? []
          : Array.isArray(options) && options.length > 0
            ? options.map((o) => (typeof o === "string" ? o : o?.label ?? o?.question ?? "确认"))
            : ["确认", "拒绝"],
      inputOnly: !!inputOnly,
      status: "pending",
      answer: null,
      feishuMessageId: null,
      answeredAt: null,
      operatorOpenId: null,
    };
    const filePath = join(pendingDir, `${id}.json`);
    writeFileSync(filePath, JSON.stringify(item, null, 2), "utf8");
    gateLog(`[${PLUGIN_NAME}][gate] 超时未回复，已写入待确认队列: ${filePath}`);
    return { id, filePath };
  }

  function armTimeout(requestId, questions, sessionID) {
    const list = (Array.isArray(questions) ? questions : []).filter((q) => q && typeof q === "object");
    // 无结构化 questions 时兜底写一条（防御性：事件字段缺失）
    const items = list.length > 0 ? list : [{ question: "", options: ["确认", "拒绝"] }];
    // 记录该批问题数，用于批次合并喂回（多个问题共用一个 requestId）
    requestCounts.set(requestId, Math.max(requestCounts.get(requestId) ?? 0, items.length));
    const timers = items.map((q) => {
      const questionText =
        (typeof q.question === "string" && q.question.trim() && q.question) ||
        (typeof q.header === "string" && q.header.trim() && q.header) ||
        "需要确认";
      const qOptions = Array.isArray(q.options) ? q.options : undefined;
      const timer = setTimeout(() => {
        try {
          writePendingConfirm(questionText, qOptions, requestId, false, sessionID);
        } catch (e) {
          gateLog(`[${PLUGIN_NAME}][gate] 写入待确认队列失败: ${e.message}`);
        }
      }, timeoutMs);
      return timer;
    });
    const prev = requestTimers.get(requestId) ?? [];
    requestTimers.set(requestId, [...prev, ...timers]);
    console.error(
      `[${PLUGIN_NAME}][gate] 门禁问题已设超时 ${timeoutMinutes} 分钟（requestId=${requestId}，${timers.length} 项）`
    );
  }

  function clearTimers(requestId) {
    const timers = requestTimers.get(requestId) ?? [];
    for (const t of timers) clearTimeout(t);
    requestTimers.delete(requestId);
    if (timers.length > 0) {
      gateLog(`[${PLUGIN_NAME}][gate] 问题已回复/取消，清除超时定时器（requestId=${requestId}，${timers.length} 项）`);
    }
  }

  /** 尝试将飞书确认结果喂回 opencode question（进程内调用 SDK） */
  async function feedBackToOpencode(item, filePath, action) {
    const requestId = item.requestId;
    if (!requestId) {
      gateLog(`[${PLUGIN_NAME}][gate] 文件无 requestId，无法喂回（confirmId=${item.id}）`);
      return false;
    }

    try {
      if (action === "answered") {
        const answer = item.answer || "确认";
        if (requestId.startsWith("degraded-")) {
          // 降级路径：无 question，注入用户消息到会话
          const sessionID = requestId.slice("degraded-".length);
          if (!sessionID) throw new Error("降级 requestId 无法提取 sessionID");
          await callDegradedInject(sessionID, answer);
          gateLog(`[${PLUGIN_NAME}][gate] 降级确认已注入用户消息: ${answer}（session=${sessionID}）`);
        } else {
          await callQuestionReply(requestId, answer);
          gateLog(`[${PLUGIN_NAME}][gate] 飞书确认已喂回 opencode question: ${answer}`);
        }
      } else {
        // 拒绝：降级路径无 question 可 reject，仅日志
        if (requestId.startsWith("degraded-")) {
          gateLog(`[${PLUGIN_NAME}][gate] 降级拒绝已收到（confirmId=${item.id}，无 question 可 reject）`);
        } else {
          await callQuestionReject(requestId);
          gateLog(`[${PLUGIN_NAME}][gate] 飞书拒绝已喂回 opencode question`);
        }
      }
      consumedSet.add(item.id);
      item.status = "consumed";
      try { writeFileSync(filePath, JSON.stringify(item, null, 2), "utf8"); } catch { /* 非关键 */ }
      return true;
    } catch (e) {
      // 失败：还原为原始状态（answered/rejected），允许后续轮询重试
      item.status = action;
      try { writeFileSync(filePath, JSON.stringify(item, null, 2), "utf8"); } catch { /* 非关键 */ }
      gateLog(`[${PLUGIN_NAME}][gate] 喂回失败（${e.message}），已还原为 ${action}，等待重试`);
      return false;
    }
  }

  /** 格式化 error 为字符串（防御性） */
  function fmtErr(err) {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  /** 通过 v1 client 底层 transport 调 /question/{requestID}/reply */
  async function callQuestionReply(requestId, answer) {
    // answer 可以是单字符串（如 "确认"，自动包装为 [[answer]]）
    // 或是二维数组（如 [["确认"], ["同意"]], 批次合并时直接传入）
    const answers = Array.isArray(answer) ? answer : [[answer]];
    // 优先尝试 v2 client.question API（若 SDK 版本支持）
    const qApi = client?.question;
    if (qApi && typeof qApi.reply === "function") {
      await qApi.reply({ requestID: requestId, directory, answers });
      return;
    }
    // 回退：v1 client 的 _client 是已连到 opencode 服务器的 Hey API 底层 transport
    // 直接调 POST /question/{requestID}/reply（v2 端点，服务端已验证支持）
    const transport = client?._client;
    if (!transport || typeof transport.post !== "function") {
      throw new Error("当前 SDK 客户端无 question 回复能力（无 client.question 且无底层 transport）");
    }
    const result = await transport.post({
      url: "/question/{requestID}/reply",
      path: { requestID: requestId },
      query: { directory },
      body: { answers }, // 服务端 schema 要求二维数组 [[answer]]
    });
    if (result.error) {
      throw new Error(fmtErr(result.error));
    }
  }

  /** 降级场景：通过 transport 注入用户消息到会话（无 question 时使用） */
  async function callDegradedInject(sessionID, answer) {
    const transport = client?._client;
    if (!transport || typeof transport.post !== "function") {
      throw new Error("SDK 客户端无消息注入能力（无底层 transport）");
    }
    const result = await transport.post({
      url: "/session/{id}/message",
      path: { id: sessionID },
      query: { directory },
      body: { parts: [{ type: "text", text: `[远程确认] ${answer}` }] },
    });
    if (result.error) {
      throw new Error(fmtErr(result.error));
    }
  }

  /** 通过 v1 client 底层 transport 调 /question/{requestID}/reject */
  async function callQuestionReject(requestId) {
    const qApi = client?.question;
    if (qApi && typeof qApi.reject === "function") {
      await qApi.reject({ requestID: requestId, directory });
      return;
    }
    const transport = client?._client;
    if (!transport || typeof transport.post !== "function") {
      throw new Error("当前 SDK 客户端无 question 拒绝能力（无 client.question 且无底层 transport）");
    }
    const result = await transport.post({
      url: "/question/{requestID}/reject",
      path: { requestID: requestId },
      query: { directory },
    });
    if (result.error) {
      throw new Error(fmtErr(result.error));
    }
  }

  // 观察 pending 文件被 daemon 改成 answered/rejected 后：
  // 1. 优先通过 client 底层 transport 调 /question/{requestID}/reply 喂回
  // 2. 无 transport 时退化到只打印日志
  const observer = setInterval(async () => {
    try {
      if (!existsSync(pendingDir)) return;
      for (const name of readdirSync(pendingDir)) {
        if (!name.endsWith(".json")) continue;
        const filePath = join(pendingDir, name);
        let item;
        try {
          item = JSON.parse(readFileSync(filePath, "utf8"));
        } catch {
          continue;
        }
        if (!item?.id) continue;
        // 已消费过或等待中，跳过
        if (consumedSet.has(item.id) || waitingSet.has(item.id)) continue;
        // 只关心 answered/rejected
        if (item.status !== "answered" && item.status !== "rejected") continue;
        // 该 requestId 已完成批次喂回，跳过
        if (item.requestId && fedBackRequestIds.has(item.requestId)) continue;

        // 尝试喂回（异步，不阻塞轮询）
        if (item.requestId) {
          if (item.requestId.startsWith("degraded-") || item.inputOnly) {
            // 降级/纯输入路径：单文件独立处理
            const action = item.status;
            item.status = "processing";
            try { writeFileSync(filePath, JSON.stringify(item, null, 2), "utf8"); } catch { /* 非关键 */ }
            gateLog(`[${PLUGIN_NAME}][gate] 开始喂回 confirmId=${item.id} action=${action}（降级注入）`);
            feedBackToOpencode(item, filePath, action).catch((e) => {
              gateLog(`[${PLUGIN_NAME}][gate] 喂回异常: ${e.message}`);
            });
          } else {
            // 正常 question 门禁：批次合并，等同一 requestId 全部完成再喂回
            // 扫描同批文件
            const siblings = readdirSync(pendingDir)
              .filter(n => n.endsWith(".json"))
              .map(n => {
                try { return { ...JSON.parse(readFileSync(join(pendingDir, n), "utf8")), _file: join(pendingDir, n) }; } catch { return null; }
              })
              .filter(f => f && f.requestId === item.requestId);

            const doneItems = siblings.filter(f => f.status === "answered" || f.status === "rejected");
            const expected = requestCounts.get(item.requestId) ?? siblings.length;

            if (doneItems.length >= expected) {
              // 全部完成 → 批次喂回一次
              if (fedBackRequestIds.has(item.requestId)) continue;
              fedBackRequestIds.add(item.requestId);

              // 按 createdAt 排序，保证 answers 顺序稳定
              doneItems.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
              const hasReject = doneItems.some(f => f.status === "rejected");

              // 逐文件标记 processing（防并发）
              for (const f of doneItems) {
                f.status = "processing";
                try { writeFileSync(f._file, JSON.stringify(f, null, 2), "utf8"); } catch {}
              }

              if (hasReject) {
                const rejectId = doneItems.find(f => f.status === "rejected")?.id || item.id;
                await callQuestionReject(item.requestId).catch(e => {
                  gateLog(`[${PLUGIN_NAME}][gate] 批次 reject 失败: ${e.message}，已标记 consumed`);
                });
                gateLog(`[${PLUGIN_NAME}][gate] 批次拒绝：${doneItems.length} 项全部 reject（第一项 confirmId=${rejectId}）`);
              } else {
                // 收集所有答案，二维数组 [[answer1], [answer2], ...]
                const allAnswers = doneItems.map(f => [f.answer || "确认"]);
                await callQuestionReply(item.requestId, allAnswers).catch(e => {
                  gateLog(`[${PLUGIN_NAME}][gate] 批次喂回失败: ${e.message}，已标记 consumed`);
                });
                gateLog(`[${PLUGIN_NAME}][gate] 批次喂回：${doneItems.length} 项答案合并（requestId=${item.requestId}）`);
              }

              // 全部标记 consumed
              for (const f of doneItems) {
                consumedSet.add(f.id);
                f.status = "consumed";
                try { writeFileSync(f._file, JSON.stringify(f, null, 2), "utf8"); } catch {}
              }
            } else {
              // 部分完成 → 标记 waiting，等同类其他项
              waitingSet.add(item.id);
              item.status = "waiting";
              try { writeFileSync(filePath, JSON.stringify(item, null, 2), "utf8"); } catch {}
              gateLog(`[${PLUGIN_NAME}][gate] 批次等待：${doneItems.length}/${expected}（confirmId=${item.id}，等同类其他项）`);
            }
          }
        } else {
          // 旧版文件无 requestId → 只打印日志一次，加入 consumedSet 防重复
          gateLog(`[${PLUGIN_NAME}][gate] 飞书确认已收到: ${item.answer ?? item.status}（confirmId=${item.id}，无 requestId，无法喂回）`);
          consumedSet.add(item.id);
        }
      }
    } catch (e) {
      gateLog(`[${PLUGIN_NAME}][gate] resolve 观察失败: ${e.message}`);
    }
  }, 10000);
  if (typeof observer.unref === "function") observer.unref();

  return {
    event: async ({ event }) => {
      if (!event?.type) return;
      const props = event.properties ?? {};
      if (event.type === "question.asked" || event.type === "question.v2.asked") {
        const requestId = props.id || props.requestID || `q-${Date.now()}`;
        armTimeout(requestId, props.questions, props.sessionID);
      } else if (
        event.type === "question.replied" ||
        event.type === "question.rejected" ||
        event.type === "question.v2.replied" ||
        event.type === "question.v2.rejected"
      ) {
        const requestId = props.requestID || props.id;
        if (requestId) {
          clearTimers(requestId);
          // question 已在 opencode 侧被消费（用户直接回复）：
          // 清掉该 requestId 残留的 pending/sent 文件，防止 later 的飞书回复再被尝试喂回
          try {
            if (existsSync(pendingDir)) {
              for (const name of readdirSync(pendingDir)) {
                if (!name.endsWith(".json")) continue;
                const fp = join(pendingDir, name);
                let f;
                try { f = JSON.parse(readFileSync(fp, "utf8")); } catch { continue; }
                if (!f?.requestId || f.requestId !== requestId) continue;
                if (consumedSet.has(f.id)) continue;
                // 原状态 answered/rejected 的飞书回复不可信（question 已消费），标记 expired
                f.status = "expired";
                try { writeFileSync(fp, JSON.stringify(f, null, 2), "utf8"); } catch {}
                gateLog(`[${PLUGIN_NAME}][gate] question 已在 opencode 消费，残留确认文件标记 expired（requestId=${requestId} confirmId=${f.id}）`);
              }
            }
          } catch (e) {
            gateLog(`[${PLUGIN_NAME}][gate] 残留确认文件清理失败: ${e.message}`);
          }
        }
      } else if (event.type === "message.part.updated") {
        // 降级/纯文本问答检测：agent 输出纯文本问题时，通过 part.text 检测等待标记
        // 注：message.updated 事件只携带 Message 元数据（无文本内容），
        // 文本内容在 message.part.updated 的 part.text 中
        const part = props.part;
        if (!part || part.type !== "text") return;
        const text = part.text;
        if (!text) return;
        const sessionID = part.sessionID;
        if (!sessionID) return;
        // 检测标记：① question 工具降级为纯文本时的固定纪律文本
        // ② grilling 等纯文本问答 skill 输出的等待标记
        // ③ grilling 格式特征（❓ Q\d 模式，不依赖 agent 严格遵守标记）
        const DEGRADE_MARKERS = [
          "降级处理",
          "请从输入框回复",
          "纯文本列出决策点",
          "当前环境无 question 工具",
          "⏳ 请在回复中继续",
          "⏳ 等待确认中…", // 统一确认等待标记（grilling/spec门禁/设计确认等所有等待回复场景）
        ];
        const isGrillingFormat = /❓\s*Q\d/.test(text);
        if (!isGrillingFormat && !DEGRADE_MARKERS.some((m) => text.includes(m))) return;
        const requestId = `degraded-${sessionID}`;
        // 已为同一会话启动过降级定时器则跳过（防重复）
        if (requestTimers.has(requestId)) return;
        gateLog(`[${PLUGIN_NAME}][gate] 检测到纯文本问答等待标记（session=${sessionID}），启动超时 ${timeoutMinutes} 分钟`);
        const timer = setTimeout(() => {
          try {
            // 降级场景：无 question requestID，写 pending 时 requestId 用标记值，
            // feedBack 走「注入用户消息」路径（见 feedBackToOpencode）
            // 纯输入模式（inputOnly=true）：卡片只显示问题 + 输入框，无选项按钮
            writePendingConfirm(text.slice(0, 3000), null, requestId, true);
          } catch (e) {
            gateLog(`[${PLUGIN_NAME}][gate] 降级写队列失败: ${e.message}`);
          }
        }, timeoutMs);
        requestTimers.set(requestId, [timer]);
      }
    },
    dispose: async () => {
      for (const timers of requestTimers.values()) for (const t of timers) clearTimeout(t);
      requestTimers.clear();
      clearInterval(observer);
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
// 飞书守护进程自动启动
// ---------------------------------------------------------------------------

/** 插件加载时自动启动飞书守护进程（后台，fork 子进程）。
 *  PID 文件按项目目录隔离（.workflow/pending-confirms/.daemon.pid），
 *  不同项目各自独立守护进程，防重复启动。
 *  凭据通过 CLI 参数传入。
 *  @returns {ChildProcess|null} 子进程引用（用于 dispose 时 kill）
 */
function maybeStartFeishuDaemon(config, projectDir) {
  const feishuCfg = config?.feishu;
  if (!feishuCfg || feishuCfg.enabled === false) return null;
  const timeoutMinutes = feishuCfg.gateTimeoutMinutes;
  if (typeof timeoutMinutes !== "number" || timeoutMinutes <= 0) return null;
  if (!feishuCfg.appId || !feishuCfg.appSecret || !feishuCfg.receiverOpenId) {
    console.error(`[${PLUGIN_NAME}] feishu 配置不完整，跳过 daemon 自动启动`);
    return null;
  }

  const daemonScript = join(__dirname, "scripts", "feishu-daemon.mjs");
  if (!existsSync(daemonScript)) {
    console.error(`[${PLUGIN_NAME}] daemon 脚本不存在: ${daemonScript}`);
    return null;
  }

  const pendingDir = join(projectDir, ".workflow", "pending-confirms");
  const pidFile = join(pendingDir, ".daemon.pid");

  // 检查是否已有 daemon 在跑（PID 文件 + 进程存活检查）
  try {
    if (existsSync(pidFile)) {
      const oldPid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
      if (oldPid > 0) {
        try {
          // process.kill(pid, 0) 检查进程是否存在，不发送信号
          process.kill(oldPid, 0);
          console.error(`[${PLUGIN_NAME}] daemon 已在运行（PID ${oldPid}），跳过`);
          return null;
        } catch {
          // 进程已死，继续启动新 daemon
          console.error(`[${PLUGIN_NAME}] daemon 旧进程（PID ${oldPid}）已退出，重新启动`);
        }
      }
    }
  } catch {}

  // 确保目录存在
  try { mkdirSync(pendingDir, { recursive: true }); } catch {}

  // 使用 fork 启动 Node.js 子进程
  const child = fork(daemonScript, [
    "--app-id", feishuCfg.appId,
    "--app-secret", feishuCfg.appSecret,
    "--open-id", feishuCfg.receiverOpenId,
    "--project", projectDir,
  ], {
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // 写 PID 文件
  try { writeFileSync(pidFile, String(child.pid), "utf8"); } catch {}

  console.error(`[${PLUGIN_NAME}] daemon 自动启动成功（PID ${child.pid}，项目: ${projectDir}）`);
  return child;
}

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
      // 注入插件目录绝对路径，供 agent 加载模板/archify 等文件时拼绝对路径
      // skill 中引用模板文件应使用 <PLUGIN_ROOT>/templates/design.md 等格式
      prompt += `\n\n---\n插件目录绝对路径：${__dirname}\n`;
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
    try {
      // 门禁超时检测：question 工具弹出后 N 分钟未回复 → 写入 pending-confirms 队列
      // 不配置 feishu / enabled=false → 返回空 hook，不注册任何事件处理
      // client 用于喂回：检测到 pending 文件被 daemon resolve 后进程内调 question reply
      registerHooks(
        createQuestionTimeoutHook(input.directory ?? process.cwd(), loadConfig().config, input.client)
      );
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] failed to init question-timeout: ${e.message}`);
    }
    try {
      // 插件加载时自动启动飞书守护进程（项目级目录隔离，PID 文件防重复）
      // 返回子进程引用，随 opencode 生命周期存活（dispose 时一同退出）
      const daemonChild = maybeStartFeishuDaemon(loadConfig().config, input.directory ?? process.cwd());
      if (daemonChild) {
        const prevDispose = hookGroups.dispose;
        hookGroups.dispose = async () => {
          if (prevDispose) { try { await prevDispose(); } catch {} }
          try { daemonChild.kill(); } catch {}
        };
      }
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] daemon 自动启动失败: ${e.message}`);
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

#!/usr/bin/env node
// ============================================================================
// feishu-daemon.mjs — SDD Loop 飞书守护进程（零外部依赖，Node >= 22）
//
// 职责：
//   1. 配置读取（优先级：CLI 参数 > 环境变量 > 插件 sdd-loop.json）
//   2. tenant_access_token 管理（缓存 + 剩余 <30 分钟刷新 + 指数退避重试）
//   3. 飞书长连接监听（复用 feishu-listen2.mjs 的 protobuf 编解码，ACK 事件）
//   4. 事件处理：im.message.receive_v1 / card.action.trigger
//   5. 发送 interactive 确认卡片（动态选项/自定义输入/确认/拒绝，value 携带 confirmId）
//   6. pending 确认队列：<project>/.workflow/pending-confirms/ 目录轮询
//   7. 带时间戳日志、SIGINT/SIGTERM 优雅退出
//
// 用法：
//   node scripts/feishu-daemon.mjs \
//     --app-id <cli_xxx> --app-secret <xxx> --open-id <ou_xxx> \
//     --project <项目根目录> [--config <sdd-loop.json 路径>]
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(PLUGIN_ROOT, "sdd-loop.json");

const FEISHU_BASE = "https://open.feishu.cn";
const WS_ENDPOINT_URL = `${FEISHU_BASE}/callback/ws/endpoint`;
const TOKEN_URL = `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`;
const MESSAGE_URL = `${FEISHU_BASE}/open-apis/im/v1/messages`;

const PENDING_DIR_NAME = "pending-confirms";
const QUEUE_POLL_MS = 2000; // 目录轮询周期
const ACK_TIMEOUT_MS = 3000; // 事件 ACK 3 秒内完成
const MAX_SENT_AGE_MS = 24 * 60 * 60 * 1000; // sent 超过 24h → expired
const TOKEN_REFRESH_THRESHOLD_MS = 30 * 60 * 1000; // 剩余 <30 分钟刷新
const RECONNECT_BASE_MS = 2000; // 断线重连初始退避

// ---------------------------------------------------------------------------
// 最小 protobuf 工具（复用 feishu-listen2.mjs，保留原注释）
// ---------------------------------------------------------------------------
function writeVarint(n, out) {
  n = n >>> 0;
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
}
function readVarint(buf, state) {
  let res = 0, shift = 0;
  while (true) {
    const b = buf[state.i++];
    res |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return res >>> 0;
}
function fieldVarint(no, val, out) { writeVarint((no << 3) | 0, out); writeVarint(val, out); }
function fieldBytes(no, bytes, out) { writeVarint((no << 3) | 2, out); writeVarint(bytes.length, out); for (const b of bytes) out.push(b); }
function fieldString(no, s, out) { fieldBytes(no, Buffer.from(s, "utf8"), out); }
function encodeHeader(key, value) {
  const h = [];
  fieldString(1, key, h);
  fieldString(2, value, h);
  return h;
}
function encodeFrame(service, method, headers, payload) {
  const out = [];
  fieldVarint(3, service, out);
  fieldVarint(4, method, out);
  for (const [k, v] of headers) fieldBytes(5, Buffer.from(encodeHeader(k, v)), out);
  if (payload && payload.length) fieldBytes(8, payload, out);
  return Buffer.from(out);
}
function decodeFrame(raw) {
  const frame = { seqID: 0, logID: 0, service: 0, method: 0, headers: [], payload: Buffer.alloc(0), payloadType: "" };
  const state = { i: 0 };
  const b = raw;
  while (state.i < b.length) {
    const tag = readVarint(b, state);
    const no = tag >>> 3, wire = tag & 7;
    if (wire === 0) {
      const v = readVarint(b, state);
      if (no === 1) frame.seqID = v; else if (no === 2) frame.logID = v; else if (no === 3) frame.service = v; else if (no === 4) frame.method = v;
    } else if (wire === 2) {
      const len = readVarint(b, state);
      const bytes = b.slice(state.i, state.i + len); state.i += len;
      if (no === 5) {
        const hs = { i: 0 }; const hb = bytes; let key = "", val = "";
        while (hs.i < hb.length) {
          const htag = readVarint(hb, hs); const hno = htag >>> 3, hwire = htag & 7;
          const hlen = readVarint(hb, hs);
          const hbytes = hb.slice(hs.i, hs.i + hlen); hs.i += hlen;
          if (hno === 1) key = hbytes.toString("utf8"); else if (hno === 2) val = hbytes.toString("utf8");
        }
        frame.headers.push([key, val]);
      } else if (no === 6) frame.payloadEncoding = bytes.toString("utf8");
      else if (no === 7) frame.payloadType = bytes.toString("utf8");
      else if (no === 8) frame.payload = Buffer.from(bytes);
    }
  }
  return frame;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
/** 带时间戳 [HH:MM:SS] 前缀的日志 */
function log(...args) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}]`, ...args);
}
function logErr(...args) {
  const ts = new Date().toTimeString().slice(0, 8);
  console.error(`[${ts}]`, ...args);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** onmessage 可能交付 ArrayBuffer 或 Blob */
function toUint8Array(data) {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

// ---------------------------------------------------------------------------
// 1. 配置读取（优先级：CLI 参数 > 环境变量 > 插件 sdd-loop.json）
// ---------------------------------------------------------------------------
function parseCliArgs(argv) {
  const args = { config: DEFAULT_CONFIG_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--app-id") args.appId = next();
    else if (a === "--app-secret") args.appSecret = next();
    else if (a === "--open-id") args.openId = next();
    else if (a === "--project") args.projectDir = next();
    else if (a === "--config") args.config = next();
    else if (a === "--help" || a === "-h") {
      console.log(
        "用法: node feishu-daemon.mjs [--app-id <cli_xxx>] [--app-secret <xxx>] [--open-id <ou_xxx>] [--project <项目根目录>] [--config <sdd-loop.json路径>]\n" +
        "配置优先级: CLI 参数 > 环境变量(FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_OPEN_ID) > 插件 sdd-loop.json 顶层 feishu 字段"
      );
      process.exit(0);
    }
  }
  return args;
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    logErr(`配置文件解析失败 ${filePath}: ${e.message}`);
    return null;
  }
}

function resolveConfig() {
  const cli = parseCliArgs(process.argv.slice(2));
  const env = {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    openId: process.env.FEISHU_OPEN_ID,
  };

  let fileCfg = {};
  const fileData = readJsonFile(cli.config || DEFAULT_CONFIG_PATH);
  if (fileData && fileData.feishu && typeof fileData.feishu === "object") {
    fileCfg = {
      appId: fileData.feishu.appId,
      appSecret: fileData.feishu.appSecret,
      openId: fileData.feishu.receiverOpenId,
    };
  } else if (fileData && !fileData.feishu) {
    log(`配置 ${cli.config || DEFAULT_CONFIG_PATH} 无 feishu 字段，回退环境变量/CLI`);
  }

  const config = {
    appId: cli.appId || env.appId || fileCfg.appId || null,
    appSecret: cli.appSecret || env.appSecret || fileCfg.appSecret || null,
    openId: cli.openId || env.openId || fileCfg.openId || null,
    projectDir: cli.projectDir ? path.resolve(cli.projectDir) : process.cwd(),
    configPath: cli.config || DEFAULT_CONFIG_PATH,
  };

  if (!config.appId || !config.appSecret) {
    logErr("FATAL: appId 与 appSecret 为必填（--app-id/--app-secret 或 FEISHU_APP_ID/FEISHU_APP_SECRET 或 sdd-loop.json 的 feishu.appId/appSecret）");
    process.exit(1);
  }
  if (!config.openId) {
    log("WARN: 未配置 openId，仅接收事件，不主动发送确认卡片");
  }
  log(`配置: appId=${config.appId} openId=${config.openId || "(无)"} projectDir=${config.projectDir}`);
  return config;
}

// ---------------------------------------------------------------------------
// 2. token 管理（缓存 + 剩余 <30 分钟刷新 + 指数退避重试）
// ---------------------------------------------------------------------------
let tokenCache = { token: null, expiresAt: 0 };

async function getToken(appId, appSecret) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt - now > TOKEN_REFRESH_THRESHOLD_MS) {
    return tokenCache.token;
  }

  let delay = 1000;
  // 指数退避重试
  for (;;) {
    try {
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const data = await resp.json();
      if (data.code !== 0) {
        throw new Error(`token 接口失败 code=${data.code} msg=${data.msg || ""}`);
      }
      tokenCache = {
        token: data.tenant_access_token,
        // 有效期减 120s 作为安全余量
        expiresAt: Date.now() + Math.max(0, (data.expire || 7200) * 1000 - 120000),
      };
      log(`token 获取成功，有效期 ${data.expire}s`);
      return tokenCache.token;
    } catch (e) {
      logErr(`token 获取失败: ${e.message}，${delay / 1000}s 后重试`);
      await sleep(delay);
      delay = Math.min(delay * 2, 30000);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. pending 确认队列
// ---------------------------------------------------------------------------
function getPendingDir(projectDir) {
  return path.join(projectDir, ".workflow", PENDING_DIR_NAME);
}

function ensurePendingDir(projectDir) {
  const dir = getPendingDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readConfirmFile(dir, id) {
  const filePath = path.join(dir, `${id}.json`);
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, "utf8")), filePath };
  } catch {
    return null;
  }
}

function writeConfirmFile(filePath, item) {
  fs.writeFileSync(filePath, JSON.stringify(item, null, 2), "utf8");
}

/** 按 confirmId 找文件；无 id 时取最旧 pending/sent 项 */
function findConfirmItem(dir, confirmId) {
  if (confirmId) {
    const hit = readConfirmFile(dir, confirmId);
    return hit || null;
  }
  let best = null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(dir, name);
    let item;
    try { item = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }
    if (item.status !== "pending" && item.status !== "sent") continue;
    if (!best || new Date(item.createdAt) < new Date(best.createdAt)) {
      best = { data: item, filePath };
    }
  }
  return best;
}

/** 目录轮询：pending → 发卡片 → sent；sent 超 24h → expired */
async function scanPendingDir(projectDir, openId, appId, appSecret) {
  let dir;
  try {
    dir = ensurePendingDir(projectDir);
  } catch (e) {
    logErr(`创建 pending 目录失败: ${e.message}`);
    return;
  }

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    logErr(`扫描 pending 目录失败: ${e.message}`);
    return;
  }

  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(dir, name);
    let item;
    try { item = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }

    if (item.status === "pending") {
      if (!openId) continue; // 未配置 openId：只做接收
      if (!appId || !appSecret) continue;
      try {
        const token = await getToken(appId, appSecret);
        const msgId = await sendCard(openId, { id: item.id, question: item.question, context: item.context, options: item.options, inputOnly: item.inputOnly }, token);
        item.status = "sent";
        item.feishuMessageId = msgId;
        writeConfirmFile(filePath, item);
        log(`[队列] ${item.id} pending → sent（message_id=${msgId}）`);
      } catch (e) {
        logErr(`[队列] ${item.id} 发送卡片失败: ${e.message}（保留 pending，下轮重试）`);
      }
    } else if (item.status === "sent") {
      const createdAt = Date.parse(item.createdAt || 0);
      if (createdAt && Date.now() - createdAt > MAX_SENT_AGE_MS) {
        item.status = "expired";
        writeConfirmFile(filePath, item);
        log(`[队列] ${item.id} sent 超过 24h → expired`);
      }
    }
  }
}

/** resolve 逻辑：写 answered/rejected + 日志 */
function resolveConfirm(projectDir, confirmId, kind, answer, operatorOpenId) {
  const dir = ensurePendingDir(projectDir);
  const hit = findConfirmItem(dir, confirmId);
  if (!hit) {
    logErr(`[resolve] 未找到待确认项${confirmId ? ` confirmId=${confirmId}` : "（无最旧 pending/sent 项）"}，忽略`);
    return null;
  }
  if (hit.data.status === "answered" || hit.data.status === "rejected") {
    log(`[resolve] ${hit.data.id} 已被处理（status=${hit.data.status}），跳过重复`);
    return hit.data;
  }
  const newStatus = kind === "reject" ? "rejected" : "answered";
  hit.data.status = newStatus;
  hit.data.answer = answer || (kind === "reject" ? "拒绝" : "确认");
  hit.data.answeredAt = new Date().toISOString();
  hit.data.operatorOpenId = operatorOpenId || null;
  writeConfirmFile(hit.filePath, hit.data);
  log(`[resolve] ${hit.data.id} → ${newStatus}（answer=${hit.data.answer} operator=${operatorOpenId || "?"}）`);
  return hit.data;
}

// ---------------------------------------------------------------------------
// 5. 卡片发送
// ---------------------------------------------------------------------------
function buildConfirmCard({ id, question, context, options, inputOnly }) {
  const headerTitle = context && context.title ? String(context.title) : "需要确认";
  const bodyText = [question, context && context.detail ? `\n\n${context.detail}` : ""].join("");

  // 选项按钮：options 有值时每选项一个按钮（第一个 primary，其余 default）；
  // 无 options 时兜底「确认」按钮。末尾统一追加红色「拒绝」按钮。
  // 纯输入模式（inputOnly=true）：不生成任何选项/确认/拒绝按钮，只保留输入框
  // 卡片 2.0：按钮直接放 body.elements（无 action 容器），回调用 behaviors
  const elements = [
    // 卡片 2.0：文本段落用 markdown + content（不用 div + lark_md）
    { tag: "markdown", content: bodyText },
  ];

  if (!inputOnly) {
    const optList = Array.isArray(options) && options.length > 0 ? options : null;
    const choiceButtons = optList
      ? optList.map((opt, i) => ({
          tag: "button",
          width: "fill",
          text: { tag: "plain_text", content: String(opt) },
          type: i === 0 ? "primary" : "default",
          behaviors: [{ type: "callback", value: { confirmId: id, action: "option", option: String(opt) } }],
        }))
      : [
          {
            tag: "button",
            width: "fill",
            text: { tag: "plain_text", content: "确认" },
            type: "primary",
            behaviors: [{ type: "callback", value: { confirmId: id, action: "approve" } }],
          },
        ];
    choiceButtons.push({
      tag: "button",
      width: "fill",
      text: { tag: "plain_text", content: "拒绝" },
      type: "danger",
      behaviors: [{ type: "callback", value: { confirmId: id, action: "reject" } }],
    });
    elements.push(...choiceButtons);
  }

  // 输入框（2.0 中可直接放 body.elements，无需 form_container）
  // 带 behaviors：按 Enter 或点输入框内置提交图标即触发回调，
  // 此时 action.input_value 携带用户输入的文本（无需额外提交按钮）
  elements.push({
    tag: "input",
    name: "customAnswer",
    placeholder: { tag: "plain_text", content: "输入你的回答，Enter 提交" },
    behaviors: [
      { type: "callback", value: { confirmId: id, action: "submit" } },
    ],
  });

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: headerTitle },
      template: "blue",
    },
    body: { elements },
  };
}

/** 发送 interactive 确认卡片，返回 message_id */
async function sendCard(openId, { id, question, context, options, inputOnly }, token) {
  const card = buildConfirmCard({ id, question, context, options, inputOnly });
  const resp = await fetch(`${MESSAGE_URL}?receive_id_type=open_id`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card), // content 是卡片 JSON 字符串
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`发卡片失败 code=${data.code} msg=${data.msg || ""}`);
  }
  const msgId = data.data?.message_id || null;
  log(`[卡片] 已发送 → ${openId}（confirmId=${id} message_id=${msgId}）`);
  return msgId;
}

// ---------------------------------------------------------------------------
// 4. 事件处理
// ---------------------------------------------------------------------------
const APPROVE_KEYWORDS = ["确认", "同意", "ok", "OK", "是"];
const REJECT_KEYWORDS = ["拒绝", "取消", "no", "NO"];

function classifyText(text) {
  const t = String(text || "").trim();
  if (APPROVE_KEYWORDS.includes(t)) return "approve";
  if (REJECT_KEYWORDS.includes(t)) return "reject";
  return null;
}

function extractTextContent(msg) {
  // content 是 JSON 字符串；text 消息形如 {"text":"..."}，post 形如 {"title":"...","content":[[{"tag":"text","text":"..."}]]}
  try {
    const parsed = JSON.parse(msg?.content || "{}");
    if (parsed.text) return parsed.text;
    if (Array.isArray(parsed.content)) {
      return parsed.content.flat(Infinity).map((c) => c?.text || c || "").join("");
    }
    return JSON.stringify(parsed);
  } catch {
    return msg?.content || "";
  }
}

function handleMessageEvent(event, ctx) {
  const msg = event.event?.message || {};
  const sender = event.event?.sender?.sender_id || {};
  const text = extractTextContent(msg);
  log(`[事件] im.message.receive_v1 sender=${sender.open_id || "?"} chat_type=${msg.chat_type || "?"} text=${JSON.stringify(text)}`);

  const action = classifyText(text);
  if (!action) {
    log(`[事件] 文本未匹配确认关键词，忽略（可用: ${APPROVE_KEYWORDS.join("/")} 或 ${REJECT_KEYWORDS.join("/")}）`);
    return;
  }
  const resolved = resolveConfirm(ctx.projectDir, null, action, null, sender.open_id || null);
  if (resolved) {
    log(`[事件] 文本确认 ${action} 命中 pending 项 ${resolved.id}`);
  }
}

function handleCardActionEvent(event, ctx) {
  const actionVal = event.event?.action?.value || {};
  const confirmId = actionVal.confirmId || null;
  const action = actionVal.action || "approve"; // 兼容旧卡片 "approve"
  const operatorOpenId = event.event?.operator?.open_id || event.event?.action?.open_id || null;
  const inputValue = event.event?.action?.input_value;

  // 按 action 分支：
  //   option → 选项按钮，answer=value.option；submit → 输入框文本（空值忽略）；
  //   reject → 拒绝；approve → 兼容旧「确认」按钮
  let kind = null;
  let answer = null;
  if (action === "option") {
    kind = "answer";
    answer = actionVal.option ?? null;
    if (answer == null || answer === "") {
      logErr("[事件] 选项回调缺少 option 值，忽略");
      return;
    }
  } else if (action === "submit") {
    kind = "answer";
    // 文本来源：优先 event.action.input_value（输入框自身 behaviors 触发时携带），
    // 回退 event.action.form_value（按钮在表单容器内时按 name 携带）
    answer = String(inputValue ?? "").trim() || null;
    if (!answer) {
      const formValue = event.event?.action?.form_value;
      const fromForm = formValue && typeof formValue === "object" ? formValue.customAnswer : null;
      answer = String(fromForm ?? "").trim() || null;
    }
    if (!answer) {
      log(`[事件] 自定义输入为空，忽略 submit（confirmId=${confirmId}）`);
      return;
    }
  } else if (action === "reject") {
    kind = "reject";
  } else {
    kind = "approve";
  }

  log(`[事件] card.action.trigger confirmId=${confirmId} action=${action} answer=${answer ? JSON.stringify(answer) : "(默认)"} operator=${operatorOpenId || "?"}`);
  if (confirmId) {
    resolveConfirm(ctx.projectDir, confirmId, kind, answer, operatorOpenId);
  } else {
    logErr("[事件] 卡片回调缺少 confirmId，忽略");
  }
}

// ---------------------------------------------------------------------------
// 3. 长连接监听
// ---------------------------------------------------------------------------
const seenEventIds = new Map(); // eventId -> timestamp (ms)，用于幂等去重 + 定期清理

// 每 30 分钟清理超过 1 小时的已处理事件 ID，防止内存泄漏
const SEEN_PRUNE_MS = 30 * 60 * 1000;
const SEEN_MAX_AGE_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  const threshold = now - SEEN_MAX_AGE_MS;
  let pruned = 0;
  for (const [id, ts] of seenEventIds) {
    if (ts < threshold) { seenEventIds.delete(id); pruned++; }
  }
  if (pruned > 0) log(`[去重] 已清理 ${pruned} 条过期事件 ID`);
}, SEEN_PRUNE_MS).unref();

async function fetchWsEndpoint(appId, appSecret) {
  log("获取 ws endpoint...");
  const resp = await fetch(WS_ENDPOINT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", locale: "zh" },
    body: JSON.stringify({ AppID: appId, AppSecret: appSecret }), // 驼峰字段名，非 Bearer token
  });
  const ep = await resp.json();
  if (ep.code !== 0) throw new Error(`ws_endpoint 失败: ${ep.code} ${ep.msg}`);
  const { URL: wsUrl, ClientConfig: cfg } = ep.data;
  const serviceId = Number(new URL(wsUrl).searchParams.get("service_id")); // device_id/service_id 必须原样使用
  const pingInterval = ((cfg && cfg.PingInterval) || 90) * 1000;
  return { wsUrl, serviceId, pingInterval };
}

function openSocket(wsUrl, ctx) {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer"; // 关键：Node WebSocket 默认 blob，Buffer.from(Blob) 会崩溃
  let pingTimer = null;
  const startedAt = Date.now();

  ws.onopen = () => {
    log(`WebSocket OPEN（service=${ctx.serviceId} ping=${ctx.pingInterval / 1000}s）`);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encodeFrame(ctx.serviceId, 0, [["type", "ping"]], Buffer.alloc(0)));
      }
    }, ctx.pingInterval);
  };

  ws.onerror = (e) => logErr("ws 错误:", e.message || String(e));

  ws.onclose = (e) => {
    clearInterval(pingTimer);
    log(`ws 关闭（code=${e.code} reason=${e.reason || ""}）`);
  };

  ws.onmessage = async (ev) => {
    const raw = Buffer.from(toUint8Array(ev.data));
    let frame;
    try {
      frame = decodeFrame(raw);
    } catch (e) {
      logErr("帧解码失败:", e.message);
      return;
    }
    if (frame.method === 0) return; // control: ping/pong

    const headers = Object.fromEntries(frame.headers);
    if (headers.type !== "event") {
      log(`data 帧类型: ${headers.type}，忽略`);
      return;
    }

    let event;
    try {
      event = JSON.parse(frame.payload.toString("utf8"));
    } catch {
      logErr("事件 payload 非 JSON");
      return;
    }

    const eventType = event.header?.event_type || "?";
    const eventId = event.header?.event_id || `${eventType}:${Date.now()}`;

    // 幂等去重
    if (seenEventIds.has(eventId)) {
      log(`[去重] 事件 ${eventId} 已处理，跳过`);
    } else {
      seenEventIds.set(eventId, Date.now());
      try {
        log(`[事件] type=${eventType} id=${eventId}`);
        if (eventType === "im.message.receive_v1") {
          handleMessageEvent(event, ctx);
        } else if (eventType === "card.action.trigger") {
          handleCardActionEvent(event, ctx);
        } else {
          log(`[事件] 未处理的事件类型 ${eventType}: ${JSON.stringify(event).slice(0, 500)}`);
        }
      } catch (e) {
        logErr(`[事件] 处理失败 ${eventType}: ${e.stack || e.message}`);
      }
    }

// 必须 ACK：原样回发 + biz_rt 头 + code:0，3 秒内完成
    try {
      const bizRt = String(Date.now() - startedAt);
      // 卡片交互回调（lark_oapi SDK P2CardActionTriggerResponse 规范）：
      // toast 和 card 放在 data 内（非顶层），与 code/msg 分开
      const ackPayload = { code: 0, msg: "ok" };
      if (eventType === "card.action.trigger") {
        ackPayload.data = {
          toast: { type: "success", content: "已收到，继续推进" },
          card: {
            type: "template",
            data: {
              schema: "2.0",
              header: { title: { tag: "plain_text", content: "已收到回复" }, template: "green" },
              body: { elements: [{ tag: "markdown", content: "回复已收到，继续推进。" }] },
            },
          },
        };
      }
      ws.send(encodeFrame(frame.service, 1, [...frame.headers, ["biz_rt", bizRt]], Buffer.from(JSON.stringify(ackPayload))));
      log(`[ACK] ${eventId} ok（biz_rt=${bizRt}ms，${Date.now() - startedAt}ms 内）`);
    } catch (e) {
      logErr("ACK 失败:", e.message);
    }
  };

  return ws;
}

async function connectWithRetry(appId, appSecret, ctx) {
  let delay = RECONNECT_BASE_MS;
  for (;;) {
    try {
      const { wsUrl, serviceId, pingInterval } = await fetchWsEndpoint(appId, appSecret);
      ctx.serviceId = serviceId;
      ctx.pingInterval = pingInterval;
      log(`连接 ${wsUrl.slice(0, 80)}...`);
      return openSocket(wsUrl, ctx);
    } catch (e) {
      logErr(`连接失败: ${e.message}，${delay / 1000}s 后重试`);
      await sleep(delay);
      delay = Math.min(delay * 2, 30000);
    }
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const config = resolveConfig();
  let shuttingDown = false;
  let ws = null;
  let reconnectTimer = null;

  // PID 锁：检查同项目是否已有 daemon 在跑（防插件自动启动 + 手动启动重复实例）
  const pendingDirForLock = path.join(config.projectDir, ".workflow", PENDING_DIR_NAME);
  const pidFile = path.join(pendingDirForLock, ".daemon.pid");
  try {
    fs.mkdirSync(pendingDirForLock, { recursive: true });
    if (fs.existsSync(pidFile)) {
      const oldPid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      try {
        if (oldPid > 0 && process.kill(oldPid, 0)) {
          console.error(`[${new Date().toTimeString().slice(0, 8)}] 另一 daemon 实例已在运行（PID ${oldPid}，项目: ${config.projectDir}），本实例退出`);
          process.exit(0);
        }
      } catch { /* 旧进程已死，继续启动 */ }
    }
    fs.writeFileSync(pidFile, String(process.pid), "utf8");
  } catch (e) {
    logErr(`PID 锁读写失败（不影响运行）: ${e.message}`);
  }

  const ctx = {
    serviceId: 0,
    pingInterval: 90000,
    projectDir: config.projectDir,
    openId: config.openId,
  };

  const gracefulShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("收到退出信号，优雅关闭...");
    // 清理 PID 文件（仅当仍由本进程写入时）
    try {
      const cur = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      if (cur === process.pid) fs.unlinkSync(pidFile);
    } catch {}
    clearInterval(reconnectTimer);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    process.exit(0);
  };
  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  // 长连接（断线自动重连）
  const keepAlive = async () => {
    for (;;) {
      ws = await connectWithRetry(config.appId, config.appSecret, ctx);
      await new Promise((resolve) => {
        ws.onclose = (e) => {
          log(`ws 关闭（code=${e.code}），2s 后重连`);
          resolve();
        };
      });
      if (shuttingDown) break;
      await sleep(2000);
    }
  };
  keepAlive().catch((e) => logErr("长连接主循环异常:", e.message));

  // pending 队列轮询
  setInterval(() => {
    if (shuttingDown) return;
    scanPendingDir(config.projectDir, config.openId, config.appId, config.appSecret).catch((e) =>
      logErr("队列轮询异常:", e.message)
    );
  }, QUEUE_POLL_MS);

  log(`守护进程启动。长连接监听中，队列轮询 ${QUEUE_POLL_MS / 1000}s/次。Ctrl+C 退出。`);
  // 常驻：main 不退出，事件回调驱动
}

main().catch((e) => {
  logErr("FATAL:", e.stack || e.message);
  process.exit(1);
});

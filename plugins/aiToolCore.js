// [title: AI 工具生态公共模块]
// [name: aiToolCore]
// [desc: OpenAI function calling 工具注册表与多轮工具循环公共能力。内置时间/天气/公网IP 与 Tavily 联网搜索(search_web)，aiChat/voiceChat 等 AI 插件统一从这里取工具、复用同一套多轮回传，新增工具只需 register 一条，无需改动各对话插件。配置（如 Tavily Key）通过 configure 注入并持久化到 Bucket，跨插件共享。]
// [author: Mianpro官方]
// [version: v1.1.3]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

"use strict";
const { Bucket } = require("sillygirl");

const MAX_TOOL_ROUNDS = 4;
const CONFIG_BUCKET = "ai_tool_config";
const CONFIG_KEY = "main";
// 原生定时任务 Bucket（sillyGirl core/task.go 监听该 Bucket 动态注册 cron，插件写它即可创建/取消任务）
const TASKS_BUCKET = "tasks";
// 当前模块自身 UUID：原生任务触发 scripts=[SELF_UUID] 时，本模块顶层会以 FakerSender 上下文重跑并处理提醒发送
const SELF_UUID = (typeof uuid === "function" && uuid()) || "";

// ===== 定时提醒：cron 校验/时间转换 =====
// 原生 CRON 为 robfig/cron v3 + cron.WithSeconds()，6 段格式：秒 分 时 日 月 周，使用服务器本地时区
function validateCron6(expr) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 6) return "必须为6段（秒 分 时 日 月 周）";
  const ranges = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (let i = 0; i < 6; i += 1) {
    const seg = parts[i];
    if (!/^[0-9,\-*\/]+$/.test(seg)) return `第${i + 1}段含非法字符「${seg}」`;
    for (const tok of seg.split(",")) {
      const t = tok.trim();
      if (!t || t === "*") continue;
      if (t.includes("/")) {
        // base/step：base 可为 *、数字、a-b
        const [base, step] = t.split("/");
        const sv = Number(step);
        if (!Number.isInteger(sv) || sv < 1 || sv > 59) return `第${i + 1}段步长越界「${t}」`;
        if (base !== "*" && !/^\d+(-\d+)?$/.test(base)) return `第${i + 1}段区间非法「${t}」`;
        if (/^\d+$/.test(base)) {
          const v = Number(base);
          if (v < ranges[i][0] || v > ranges[i][1]) return `第${i + 1}段数值越界「${t}」`;
        }
        continue;
      }
      if (t.includes("-")) {
        const [a, b] = t.split("-");
        for (const n of [a, b]) {
          const v = Number(n);
          if (!Number.isInteger(v) || v < ranges[i][0] || v > ranges[i][1]) return `第${i + 1}段数值越界「${t}」`;
        }
        continue;
      }
      const v = Number(t);
      if (!Number.isInteger(v) || v < ranges[i][0] || v > ranges[i][1]) return `第${i + 1}段数值越界「${t}」`;
    }
  }
  return "";
}

// 一次性时间（本地时区）→ 6 段 cron；校验未来时间
function atToCron6(atStr) {
  const m = String(atStr || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error("at 时间格式应为 YYYY-MM-DD HH:mm（如 2026-10-25 10:00）");
  const [_, y, mo, d, h, mi, s] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
  if (Number.isNaN(dt.getTime())) throw new Error("at 时间无效");
  if (dt.getTime() <= Date.now()) throw new Error(`at 时间已过去（${dt.toLocaleString()}），请改成未来时间`);
  return `0 ${Number(mi)} ${Number(h)} ${Number(d)} ${Number(mo)} *`;
}

// ===== 定时提醒发送（由原生任务以 FakerSender 上下文触发本模块时执行）=====
function parseReminderCommand(raw) {
  // 格式：__reminder__:<taskId>:<once|repeat>:<content>
  if (!String(raw).startsWith("__reminder__:")) return null;
  const parts = String(raw).split(":");
  if (parts.length < 4) return null;
  return {
    taskId: parts[1],
    type: parts[2],
    content: parts.slice(3).join(":"),
  };
}

async function handleReminderSender(sendFn, deleteFn) {
  let raw = "";
  try {
    raw = String(await s.getMsg() || "");
  } catch (_) {}
  const meta = parseReminderCommand(raw);
  if (!meta || !meta.content) return false;
  try {
    await sendFn(meta.content);
  } catch (e) {
    console.error(`[aiToolCore] 提醒发送失败: ${e?.message || e}`);
    return true;
  }
  // 一次性任务发送后自动注销（写空触发原生 watch 删除分支）
  if (meta.type === "once") {
    try { await deleteFn(meta.taskId); } catch (_) {}
  }
  return true;
}

// 对话插件在 main() 开头调用：若当前消息是定时任务触发的提醒指令，直接回复内容并（一次性）注销，返回 true
async function reminderInterceptor() {
  return handleReminderSender(
    (text) => s.reply(text),
    (id) => new Bucket(TASKS_BUCKET).set(id, ""),
  );
}

// ===== 工具注册表 =====
// 工具结构：{ type:"function", function:{name,description,parameters}, async execute(args){...} }
const registry = new Map();
const configStore = new Bucket(CONFIG_BUCKET);

function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

async function getConfig() {
  const raw = String((await configStore.get(CONFIG_KEY, "{}")) || "{}");
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

// 宿主插件在 main 开头调用，把自己表单里的工具相关配置（如 tavilyApiKey）合并并持久化，跨插件共享
async function configure(patch = {}) {
  const cur = await getConfig();
  const next = { ...cur, ...stripEmpty(patch) };
  await configStore.set(CONFIG_KEY, JSON.stringify(next));
  return next;
}

// 注册一个工具；同名覆盖（便于内置工具被自定义实现替换）
function register(tool) {
  const name = tool?.function?.name;
  if (!name) throw new Error("工具缺少 function.name");
  if (typeof tool.execute !== "function") throw new Error(`工具 ${name} 缺少 execute 函数`);
  registry.set(name, tool);
  return tool;
}

// 返回发给模型的工具数组（仅 OpenAI function 描述部分）
function listTools() {
  return [...registry.values()].map((t) => ({
    type: "function",
    function: t.function,
  }));
}

function getTool(name) {
  return registry.get(name);
}

// 执行模型返回的一次 tool_call；参数解析失败/执行异常都返回文本，不打断对话
async function runTool(call, senderCtx) {
  const name = call?.function?.name;
  const tool = registry.get(name);
  if (!tool) return `未知工具：${name}`;
  let args = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch (_) {
    return `工具参数 JSON 解析失败：${call.function?.arguments}`;
  }
  try {
    return await tool.execute(args, { getConfig, sender: senderCtx || null });
  } catch (error) {
    return `工具 ${name} 执行失败：${error?.message || error}`;
  }
}

// ===== 内置工具 =====

register({
  type: "function",
  function: {
    name: "get_current_time",
    description: "获取机器人所在服务器的当前日期与时间（Asia/Shanghai 时区）",
    parameters: { type: "object", properties: {}, required: [] },
  },
  async execute() {
    const now = new Date();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  },
});

register({
  type: "function",
  function: {
    name: "get_weather",
    description:
      "查询指定城市的天气，支持今天/明天/后天的预报（数据来自 wttr.in）。例如“北京今天天气”“上海明天天气”“广州后天会不会下雨”。参数 city=城市名；when=今天/明天/后天（不填默认今天）",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名，例如：北京、上海、深圳" },
        when: { type: "string", description: "今天/明天/后天，不填默认今天" },
      },
      required: ["city"],
    },
  },
  async execute(args) {
    const city = encodeURIComponent(String(args.city || "").trim());
    if (!city) throw new Error("city 为空");
    const res = await fetch(`https://wttr.in/${city}?format=j1&lang=zh`, {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "curl/8.0" },
    });
    if (!res.ok) throw new Error(`wttr.in HTTP ${res.status}`);
    const data = await res.json();
    const days = Array.isArray(data?.weather) ? data.weather : [];
    if (!days.length) throw new Error("天气接口未返回数据");
    const when = String(args.when || "").trim();
    // 解析目标日期：今天=0 明天=1 后天=2；兼容 tomorrow/today 与具体日期 YYYY-MM-DD
    let idx = 0;
    if (/^(明天|明日|tomorrow|tom)$/i.test(when)) idx = 1;
    else if (/^(后天|dayaftertomorrow)/i.test(when)) idx = 2;
    else {
      const m = String(when).match(/\d{4}-\d{2}-\d{2}/);
      if (m) {
        const found = days.findIndex((d) => d.date === m[0]);
        if (found === -1) throw new Error("wttr.in 只提供今明后天 3 天预报，暂查不到该日期");
        idx = found;
      }
    }
    const day = days[idx];
    const hour = day?.hourly?.[Math.floor((day.hourly?.length || 0) / 2)] || {};
    const desc =
      hour.lang_zh?.[0]?.value || hour.weatherDesc?.[0]?.value || day.weatherDesc?.[0]?.value || "未知天气";
    const label = idx === 0 ? "今天" : idx === 1 ? "明天" : "后天";
    const dayLabel = String(day.date || "").slice(5).replace("-", "月") + "日";
    if (idx === 0) {
      const cur = data?.current_condition?.[0];
      if (cur) {
        const curDesc = cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || desc;
        return `${args.city}${label}（${dayLabel}）：当前${curDesc}，气温 ${cur.temp_C}°C（体感 ${cur.FeelsLikeC}°C），湿度 ${cur.humidity}%，风 ${cur.windspeedKmph}km/h；全天最高 ${day.maxtempC}°C / 最低 ${day.mintempC}°C，降水概率 ${hour.chanceofrain || 0}%`;
      }
    }
    return `${args.city}${label}（${dayLabel}）：${desc}，最高 ${day.maxtempC}°C / 最低 ${day.mintempC}°C，降水概率 ${hour.chanceofrain || 0}%`;
  },
});

register({
  type: "function",
  function: {
    name: "get_public_ip",
    description: "查询机器人所在服务器的公网出口 IP（用于排查网络/登录问题）",
    parameters: { type: "object", properties: {}, required: [] },
  },
  async execute() {
    const res = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ipify HTTP ${res.status}`);
    return await res.text();
  },
});

// ===== Tavily 联网搜索 =====

function truncate(text, n) {
  const out = String(text || "")
    .replace(/\s+\n/g, "\n")
    .trim();
  return out.length > n ? `${out.slice(0, n)}…` : out;
}

register({
  type: "function",
  function: {
    name: "search_web",
    description:
      "联网实时搜索（Tavily）。当用户询问最新资讯、实时信息、当下事件、新闻，或你的训练知识可能过时/不确定时调用；不要用于闲聊、简单计算或常识问题。调用后请通读返回结果，用自己的话总结归纳回答用户，并附上引用来源链接，不要直接罗列原始条目。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，简洁明确，可用中文" },
        max_results: { type: "integer", description: "返回条数，默认5，范围1-8" },
        topic: { type: "string", enum: ["general", "news"], description: "general=通用网页（默认）；news=新闻" },
      },
      required: ["query"],
    },
  },
  async execute(args, ctx) {
    const getCfg = ctx?.getConfig || getConfig;
    const cfg = await getCfg();
    const apiKey = String(cfg.tavilyApiKey || "").trim();
    if (!apiKey) return "联网搜索未配置 Tavily API Key，无法检索，请引导用户直接提问或稍后再试。";

    const query = String(args.query || "").trim();
    if (!query) throw new Error("query 为空");
    let maxResults = Number(args.max_results) || 5;
    if (!Number.isFinite(maxResults)) maxResults = 5;
    maxResults = Math.min(8, Math.max(1, Math.floor(maxResults)));
    const topic = args.topic === "news" ? "news" : "general";

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, topic, search_depth: "basic" }),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        detail = JSON.parse(text)?.detail || JSON.parse(text)?.error || detail;
      } catch (_) {}
      throw new Error(`Tavily HTTP ${res.status}：${detail}`);
    }
    const data = JSON.parse(text);
    const results = Array.isArray(data.results) ? data.results.slice(0, maxResults) : [];
    if (!results.length) return `未找到与「${query}」相关的搜索结果。`;

    const lines = results.map((item, i) => {
      const title = String(item.title || "无标题").trim();
      const url = String(item.url || "").trim();
      const content = truncate(item.content, 320);
      return `${i + 1}. ${title}\n${url}\n${content}`;
    });
    return [`【联网搜索：${query}】`, ...lines].join("\n\n");
  },
});

// ===== 定时提醒任务（复用 sillyGirl 原生定时任务机制）=====

register({
  type: "function",
  function: {
    name: "create_reminder",
    description:
      "创建定时提醒/任务：到点后给下达指令的用户本人发一条私聊消息。周期任务传 schedule（6段cron：秒 分 时 日 月 周，服务器本地时区；例如每天早10点=0 0 10 * * *，每5分钟=0 */5 * * * *）；一次性任务传 at（格式 YYYY-MM-DD HH:mm，例如“明天早上10点”应基于系统提示中的今天日期换算成具体日期）。两个参数至少传一个，同时传时以 schedule 为准。提醒内容 content 用一句简洁明确的话。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "提醒内容，一句简洁明确的话，例如：记得带伞" },
        schedule: { type: "string", description: "周期任务的 6 段 cron 表达式（秒 分 时 日 月 周）" },
        at: { type: "string", description: "一次性触发时间，格式 YYYY-MM-DD HH:mm" },
      },
      required: ["content"],
    },
  },
  async execute(args, ctx) {
    const content = String(args.content || "").trim();
    if (!content) throw new Error("content 为空");
    const schedule = String(args.schedule || "").trim();
    const at = String(args.at || "").trim();
    if (!schedule && !at) throw new Error("请提供 schedule（周期cron）或 at（一次性时间）");
    let cron = schedule;
    if (cron) {
      const err = validateCron6(cron);
      if (err) throw new Error(`cron 格式错误：${err}（6段：秒 分 时 日 月 周，例：每天早10点=0 0 10 * * *）`);
    } else {
      cron = atToCron6(at);
    }
    const sender = (ctx && ctx.sender) || {};
    if (!sender.platform || !sender.userId) throw new Error("无法确定发送对象上下文");
    // 任务到点要触发哪个插件来发提醒：优先取宿主插件在 main() 里注入的 uuid（可靠）；
    // SELF_UUID 仅在模块顶层能访问全局 uuid 时兜底；都拿不到就拒绝创建，避免建出发不出的哑任务
    const scriptUuid = String((sender && sender.uuid) || SELF_UUID || "").trim();
    if (!scriptUuid) throw new Error("提醒发送组件未就绪：宿主插件未注入 UUID（请确认本地 aiChat≥v3.5.2 / voiceChat≥v2.3.2，且未被旧版本覆盖），更新并重启后重试");
    const once = !schedule;
    const taskId = (typeof genUuid === "function" && genUuid()) || `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // 发送目标 = 下命令的会话：群里下的发群里，私聊下的发私聊（用户未加好友也能收到）
    const targetChatId = String(sender.chatId || sender.userId || "");
    const taskJson = {
      task_id: taskId,
      title: `提醒：${content.slice(0, 12)}`,
      schedule: cron,
      senders: [
        {
          platform: String(sender.platform),
          bot_id: String(sender.botId || ""),
          user_id: String(sender.userId),
          chat_id: targetChatId,
        },
      ],
      command: `__reminder__:${taskId}:${once ? "once" : "repeat"}:${content}`,
      scripts: [scriptUuid],
      enable: true,
      created_at: Math.floor(Date.now() / 1000),
      remark: "AI 对话创建",
    };
    await new Bucket(TASKS_BUCKET).set(taskId, JSON.stringify(taskJson));
    return `已创建${once ? "一次性" : "周期"}提醒：${content}\n触发时间：${cron}${once ? "" : "（周期 cron）"}\n到期将私聊提醒你`;
  },
});

// ===== 多轮工具循环（收敛各对话插件重复实现）=====
// ai: openaiChatCore 的 chat；opts: 见下；messages: 构建好的对话消息
// opts: { baseUrl, apiKey, model, provider, thinking, temperature, maxTokens, timeout, tools, enabled, maxRounds }
async function chatLoop(ai, opts = {}, messages) {
  const registered = Array.isArray(opts.tools) ? opts.tools : listTools();
  const enabled = opts.enabled !== false;
  const send = (msgs) =>
    ai.chat({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
      provider: opts.provider,
      thinking: opts.thinking,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      timeout: opts.timeout,
      messages: msgs,
      tools: enabled && registered.length ? registered : undefined,
    });

  let current = messages.slice();
  let last = await send(current);
  const rounds = Number(opts.maxRounds) || MAX_TOOL_ROUNDS;
  for (let round = 0; round < rounds && last.toolCalls?.length; round += 1) {
    // 思考模型（DeepSeek 等）要求 assistant 消息必须完整回传 reasoning_content，否则 400
    current.push({
      role: "assistant",
      content: last.content || "",
      tool_calls: last.toolCalls,
      reasoning_content: last.reasoningContent || undefined,
    });
    for (const call of last.toolCalls) {
      const result = await runTool(call, opts.sender || null);
      current.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function?.name || "unknown",
        content: String(result),
      });
    }
    last = await send(current);
  }
  return last;
}

// 顶层提醒发送分支：本模块被原生任务以 FakerSender 上下文触发时（scripts=[SELF_UUID]），
// 收到 "__reminder__:" 指令即直接回复内容并（一次性任务）注销任务；普通对话 require 时消息不含前缀，无副作用
(async () => {
  if (!SELF_UUID) return;
  try {
    await handleReminderSender(
      (text) => s.reply(text),
      (id) => new Bucket(TASKS_BUCKET).set(id, ""),
    );
  } catch (_) {}
})();

module.exports = {
  configure,
  getConfig,
  register,
  listTools,
  getTool,
  runTool,
  chatLoop,
  MAX_TOOL_ROUNDS,
  validateCron6,
  atToCron6,
  parseReminderCommand,
  handleReminderSender,
  reminderInterceptor,
};

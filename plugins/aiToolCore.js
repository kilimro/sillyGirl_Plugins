// [title: AI 工具生态公共模块]
// [name: aiToolCore]
// [desc: OpenAI function calling 工具注册表与多轮工具循环公共能力。内置时间/天气/公网IP 与 Tavily 联网搜索(search_web)，aiChat/voiceChat 等 AI 插件统一从这里取工具、复用同一套多轮回传，新增工具只需 register 一条，无需改动各对话插件。配置（如 Tavily Key）通过 configure 注入并持久化到 Bucket，跨插件共享。]
// [author: Mianpro官方]
// [version: v1.0.1]
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
async function runTool(call) {
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
    return await tool.execute(args, { getConfig });
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
      const result = await runTool(call);
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

module.exports = {
  configure,
  getConfig,
  register,
  listTools,
  getTool,
  runTool,
  chatLoop,
  MAX_TOOL_ROUNDS,
};

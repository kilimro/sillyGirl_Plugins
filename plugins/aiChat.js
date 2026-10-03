// [title: AI 聊天助手]
// [name: aiChat]
// [desc: 接入任意 OpenAI 兼容接口的群聊 AI 助手。群聊需以前缀开头才触发（如"ai你好"），否则放行给其他插件；私聊直接聊；上下文按用户隔离；支持 BaseURL/Key/模型/长系统提示词（变量插值）/上下文轮数/工具调用。]
// [author: kilimro]
// [version: v1.3.0]
// [rule: raw [\s\S]*]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999999999]
// [class: 工具]
// [icon: https://www.oppo.com/content/dam/oppo_com/oppo/product-asset-library/reno/reno16-series/cn/reno16/assets/images-design-c2-icon-1-1-80c8ba.png.webp]
// [origin: 自定义]
// [depe: ["./openaiChatCore.js"]]

const { sender: s, Bucket, plugin } = require("sillygirl");
const ai = require("./openaiChatCore.js");

const HISTORY_BUCKET = "openai_chat_history";
const MAX_CONTENT_LEN = 1500;
const MAX_TOOL_ROUNDS = 4;

const form = new plugin.Form({
  base_url: plugin.Form.string()
    .title("OpenAI 兼容 BaseURL")
    .description("例如 https://api.openai.com/v1，或第三方中转/自建地址；不需要写 /chat/completions 后缀")
    .default(ai.DEFAULT_BASE_URL)
    .required(),
  api_key: plugin.Form.string().title("API Key").default("").required(),
  model: plugin.Form.string().title("模型名").default(ai.DEFAULT_MODEL).required(),
  system_prompt: plugin.Form.string()
    .title("系统提示词（人设）")
    .description(
      "支持多行。可用变量：{now} 当前时间、{date} 日期、{weekday} 星期、{nickname} 对方昵称、{user_id} 对方ID、{platform} 平台",
    )
    .widget("textarea")
    .default(ai.DEFAULT_SYSTEM_PROMPT),
  trigger_prefix: plugin.Form.string()
    .title("群聊触发前缀（逗号分隔）")
    .description(
      "群里消息必须以前缀开头才会触发 AI，例如：ai。私聊不校验前缀直接对话；不匹配前缀的消息会放行给其他插件",
    )
    .default("ai")
    .required(),
  context_rounds: plugin.Form.integer()
    .title("携带上下文轮数")
    .description("每个用户保留多少轮对话记忆（一轮=一问一答），建议 3-20")
    .min(0)
    .max(50)
    .default(10),
  reply_probability: plugin.Form.integer()
    .title("群聊随机插话概率（%，默认 0 关闭）")
    .description("开启后群里不以前缀开头的消息也按此概率随机搭话；0=只在前缀触发时回复")
    .min(0)
    .max(100)
    .default(0),
  enable_tools: plugin.Form.boolean()
    .title("启用内置工具（时间/天气/公网IP）")
    .description("开启后 AI 可主动调用工具回答“几点了”“北京天气”“服务器 IP”这类问题")
    .default(true),
  temperature: plugin.Form.number().title("Temperature").min(0).max(2).default(0.8),
  max_tokens: plugin.Form.integer().title("单次回复最大 Token").min(64).max(4096).default(800),
  timeout: plugin.Form.integer().title("请求超时毫秒").min(5000).max(180000).default(60000),
  enable_group: plugin.Form.boolean().title("群聊启用").default(true),
  enable_private: plugin.Form.boolean().title("私聊启用").default(true),
});

const historyStore = new Bucket(HISTORY_BUCKET);

// 上下文按 platform:chatId:userId 隔离——群里每个人各自有自己的记忆
async function chatKey() {
  const platform = String((await s.getPlatform()) || "unknown");
  const chatId = String((await s.getChatId()) || (await s.getUserId()));
  const userId = String((await s.getUserId()) || "");
  return `${platform}:${chatId}:${userId}`;
}

async function loadHistory(key) {
  const raw = String(await historyStore.get(key, "[]"));
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

async function saveHistory(key, history) {
  const trimmed = history.slice(-(Number(cfg.context_rounds) * 2 + 2));
  await historyStore.set(key, JSON.stringify(trimmed));
}

function parsePrefixes(raw) {
  return String(raw || "")
    .split(/[,，]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

// 去掉消息里的触发前缀，返回真正给大模型看的文本；不匹配返回 null
function stripPrefix(content, prefixes) {
  const lower = String(content || "")
    .trim()
    .toLowerCase();
  for (const p of prefixes) {
    if (!p) continue;
    if (lower === p) return ""; // 单独发前缀，让用户自己补内容
    if (lower.startsWith(p)) {
      return String(content).trim().slice(p.length).trim();
    }
  }
  return null;
}

function isPrivateChat(chatId, userId) {
  return !chatId || String(chatId) === String(userId);
}

function clampReply(text) {
  let out = String(text || "").trim();
  if (out.length > MAX_CONTENT_LEN) out = `${out.slice(0, MAX_CONTENT_LEN)}…`;
  return out;
}

async function getNickname() {
  try {
    if (typeof s.getUserName === "function") return String(await s.getUserName());
  } catch (_) {}
  try {
    if (typeof s.getNickname === "function") return String(await s.getNickname());
  } catch (_) {}
  return "群友";
}

function renderPrompt(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

// ===== 工具注册表（OpenAI function calling）=====
const TOOLS = [
  {
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
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询指定城市的实时天气（数据来自 wttr.in）",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名，例如：北京、上海、深圳" },
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
      const cur = data?.current_condition?.[0];
      if (!cur) throw new Error("天气接口未返回数据");
      const desc = cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || "";
      return `${args.city} 当前${desc}，气温 ${cur.temp_C}°C（体感 ${cur.FeelsLikeC}°C），湿度 ${cur.humidity}%，风 ${cur.windspeedKmph}km/h`;
    },
  },
  {
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
  },
];

const toolByName = new Map(TOOLS.map((t) => [t.function.name, t]));

async function runTool(call) {
  const name = call?.function?.name;
  const tool = toolByName.get(name);
  if (!tool) return `未知工具：${name}`;
  let args = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch (_) {
    return `工具参数 JSON 解析失败：${call.function.arguments}`;
  }
  try {
    return await tool.execute(args);
  } catch (error) {
    return `工具 ${name} 执行失败：${error?.message || error}`;
  }
}

async function chatWithTools(messages) {
  const baseOptions = {
    baseUrl: cfg.base_url,
    apiKey: cfg.api_key,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.max_tokens,
    timeout: cfg.timeout,
  };
  const useTools = Boolean(cfg.enable_tools);
  const send = (msgs) =>
    ai.chat({
      ...baseOptions,
      messages: msgs,
      tools: useTools ? TOOLS : undefined,
    });

  let current = messages.slice();
  let last = await send(current);
  for (let round = 0; round < MAX_TOOL_ROUNDS && last.toolCalls?.length; round += 1) {
    current.push({ role: "assistant", content: last.content || "", tool_calls: last.toolCalls });
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

async function handleStatus(key) {
  const history = await loadHistory(key);
  const pairs = Math.floor(history.length / 2);
  const masked = ai.maskKey(cfg.api_key);
  return s.reply(
    [
      "===== AI 助手状态 =====",
      `模型：${cfg.model}`,
      `BaseURL：${ai.normalizeBaseUrl(cfg.base_url)}`,
      `Key：${masked || "未配置"}`,
      `触发前缀：${String(cfg.trigger_prefix || "").trim() || "（无）"}`,
      `上下文轮数：${cfg.context_rounds}（当前已存 ${pairs} 轮）`,
      `群聊随机插话：${cfg.reply_probability}%`,
      `内置工具：${cfg.enable_tools ? "开启（" + TOOLS.map((t) => t.function.name).join("、") + "）" : "关闭"}`,
      "发送「AI清空」可清除当前用户的记忆",
    ].join("\n"),
  );
}

async function handleClear(key) {
  await historyStore.delete(key);
  return s.reply("已清除你的 AI 记忆");
}

let cfg = {};

async function main() {
  cfg = (await form.get()) || {};
  const rawContent = String((await s.getMsg()) || "").trim();
  if (!rawContent) return;

  const key = await chatKey();
  const userId = String((await s.getUserId()) || "");
  const chatId = String((await s.getChatId()) || "");
  const privateChat = isPrivateChat(chatId, userId);

  // 管理指令：不校验前缀，直接响应
  if (rawContent === "AI状态" || rawContent === "ai状态") return handleStatus(key);
  if (rawContent === "AI清空" || rawContent === "ai清空" || rawContent === "忘记") return handleClear(key);

  if (!String(cfg.api_key || "").trim()) return;
  if (privateChat && !cfg.enable_private) return;
  if (!privateChat && !cfg.enable_group) return;

  const prefixes = parsePrefixes(cfg.trigger_prefix);
  let promptText;
  let shouldResume = false;

  if (privateChat) {
    // 私聊：直接对话，不需要前缀
    promptText = rawContent;
  } else {
    // 群聊：必须以前缀开头才触发 AI
    promptText = stripPrefix(rawContent, prefixes);
    if (promptText === null) {
      // 不以前缀开头：要么按随机概率插话，要么放行给其他插件
      const probability = Math.max(0, Math.min(100, Number(cfg.reply_probability) || 0));
      if (probability > 0 && Math.random() * 100 < probability) {
        promptText = rawContent; // 随机插话，用原文
      } else {
        shouldResume = true; // 放行
      }
    }
  }

  if (shouldResume) {
    // 让 SillyGirl 继续把这条消息分发给后面的插件（签到/查询等）
    if (typeof s.resume === "function") {
      try {
        await s.resume();
      } catch (_) {}
    }
    return;
  }

  if (!promptText) return; // 只发了个前缀，等用户补内容

  const now = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const systemVars = {
    now: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    weekday: `星期${weekdays[now.getDay()]}`,
    nickname: await getNickname(),
    user_id: userId,
    platform: String(await s.getPlatform()),
  };

  let history;
  try {
    history = await loadHistory(key);
    const systemPrompt = renderPrompt(cfg.system_prompt, systemVars);
    const messages = ai.buildMessages(systemPrompt, history, promptText);
    const result = await chatWithTools(messages);
    const replyText = clampReply(result.content);
    if (!replyText) return;
    history.push({ role: "user", content: promptText });
    history.push({ role: "assistant", content: replyText });
    await saveHistory(key, history);
    return s.reply(replyText);
  } catch (error) {
    await s.reply(`AI 暂时摸鱼了：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`AI 聊天插件异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

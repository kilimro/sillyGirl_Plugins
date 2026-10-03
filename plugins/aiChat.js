// [title: AI 聊天助手]
// [name: aiChat]
// [desc: 接入任意 OpenAI 兼容接口的群聊 AI 助手。支持自定义 BaseURL、API Key、模型、系统提示词、上下文轮数、群聊概率回复与内置工具（时间/天气/公网 IP）；@或召唤词必回。]
// [author: kilimro]
// [version: v1.1.0]
// [rule: raw [\s\S]*]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
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
    .description("支持多行。定义 AI 的性格、口吻、行为边界")
    .widget("textarea")
    .default(ai.DEFAULT_SYSTEM_PROMPT),
  context_rounds: plugin.Form.integer()
    .title("携带上下文轮数")
    .description("每个会话保留多少轮对话记忆（一轮=一问一答），建议 3-20")
    .min(0)
    .max(50)
    .default(10),
  reply_probability: plugin.Form.integer()
    .title("群聊概率回复百分比")
    .description("群里不 @/不喊召唤词时，每条消息按此概率随机回复，0 表示只在被召唤时才回")
    .min(0)
    .max(100)
    .default(30),
  summon_words: plugin.Form.string()
    .title("群聊召唤词（逗号分隔）")
    .description("群聊消息中包含任一召唤词时必回；例如：ai,小助手,机器人")
    .default("ai,小助手,机器人"),
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

async function chatKey() {
  const platform = String((await s.getPlatform()) || "unknown");
  const chatId = String((await s.getChatId()) || (await s.getUserId()));
  return `${platform}:${chatId}`;
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

function parseSummonWords(raw) {
  return String(raw || "")
    .split(/[,，]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

function containsSummonWord(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((w) => lower.includes(w));
}

function isPrivateChat(chatId, userId) {
  return !chatId || String(chatId) === String(userId);
}

function clampReply(text) {
  let out = String(text || "").trim();
  if (out.length > MAX_CONTENT_LEN) out = `${out.slice(0, MAX_CONTENT_LEN)}…`;
  return out;
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
      `上下文轮数：${cfg.context_rounds}（当前已存 ${pairs} 轮）`,
      `群聊概率：${cfg.reply_probability}%`,
      `召唤词：${String(cfg.summon_words || "").trim() || "（无）"}`,
      `内置工具：${cfg.enable_tools ? "开启（" + TOOLS.map((t) => t.function.name).join("、") + "）" : "关闭"}`,
      "发送「AI清空」可清除当前会话记忆",
    ].join("\n"),
  );
}

async function handleClear(key) {
  await historyStore.delete(key);
  return s.reply("已清除当前会话的 AI 记忆");
}

let cfg = {};

async function main() {
  cfg = (await form.get()) || {};
  const content = String((await s.getMsg()) || "").trim();
  if (!content) return;

  const key = await chatKey();
  const userId = String((await s.getUserId()) || "");
  const chatId = String((await s.getChatId()) || "");
  const privateChat = isPrivateChat(chatId, userId);

  if (content === "AI状态" || content === "ai状态") return handleStatus(key);
  if (content === "AI清空" || content === "ai清空" || content === "忘记") return handleClear(key);

  if (!String(cfg.api_key || "").trim()) return;

  if (privateChat && !cfg.enable_private) return;
  if (!privateChat && !cfg.enable_group) return;

  let shouldReply = privateChat;
  if (!privateChat) {
    const words = parseSummonWords(cfg.summon_words);
    if (containsSummonWord(content, words)) shouldReply = true;
    else if (content.length <= 6) shouldReply = false;
    else {
      const probability = Math.max(0, Math.min(100, Number(cfg.reply_probability) || 0));
      shouldReply = Math.random() * 100 < probability;
    }
  }
  if (!shouldReply) return;

  let history;
  try {
    history = await loadHistory(key);
    const messages = ai.buildMessages(cfg.system_prompt, history, content);
    const result = await chatWithTools(messages);
    const replyText = clampReply(result.content);
    if (!replyText) return;
    history.push({ role: "user", content });
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

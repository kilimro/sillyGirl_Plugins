// [title: AI 聊天助手]
// [name: aiChat]
// [desc: 接入任意 OpenAI 兼容接口的 AI 助手。消息必须以 ai/AI/机器人/小助手 开头才会触发，其他命令走原插件不抢。要改触发词请编辑下方 [rule] 那一行的正则。支持 BaseURL/Key/模型/长系统提示词（变量插值）/上下文轮数/工具调用。]
// [author: Mianpro官方]
// [version: v2.3.0]
// [rule: ^(ai|起床了绵绵|Ai|机器人|小助手)[，,、:：\s]*[\s\S]*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 大模型]
// [icon: https://ecmb.bdimg.com/tam-ogel/-341441530_114552854_88_88.png]
// [origin: 自定义]
// [depe: ["./geweCore.js","./memoryCore.js","./openaiChatCore.js","./ttsCore.js"]]

const { sender: s, Bucket, plugin } = require("sillygirl");
const ai = require("./openaiChatCore.js");
const mem = require("./memoryCore.js");
const tts = require("./ttsCore.js");
const geweCore = require("./geweCore.js");

const HISTORY_BUCKET = "openai_chat_history";
const MAX_CONTENT_LEN = 1500;
const MAX_TOOL_ROUNDS = 4;

// 剥掉消息开头的触发词（ai/AI/机器人/小助手）和紧跟的分隔符，返回真正给大模型的文本
const PREFIX_RE = /^\s*(?:ai|起床了绵绵|Ai|机器人|小助手)[，,、:：\s]*/;

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
  context_rounds: plugin.Form.integer()
    .title("携带上下文轮数")
    .description("每个用户保留多少轮对话记忆（一轮=一问一答），建议 3-20")
    .min(0)
    .max(50)
    .default(10),
  enable_tools: plugin.Form.boolean()
    .title("启用内置工具（时间/天气/公网IP）")
    .description("开启后 AI 可主动调用工具回答“几点了”“北京天气”“服务器 IP”这类问题")
    .default(true),
  enable_memory: plugin.Form.boolean()
    .title("启用长期记忆（自动记住用户个人信息）")
    .description(
      "开启后 AI 会自动从对话中提取生日、名字、喜好等信息并记住，下次对话自动带入；用户发送「我的记忆」可查看",
    )
    .default(true),
  temperature: plugin.Form.number().title("Temperature").min(0).max(2).default(0.8),
  max_tokens: plugin.Form.integer().title("单次回复最大 Token").min(64).max(4096).default(800),
  timeout: plugin.Form.integer().title("请求超时毫秒").min(5000).max(180000).default(60000),
  enable_group: plugin.Form.boolean().title("群聊启用").default(true),
  enable_private: plugin.Form.boolean().title("私聊启用").default(true),
  reply_mode: plugin.Form.string()
    .title("回复模式")
    .description("text=文字回复（默认）；voice=语音回复（需要配置下面的 TTS）")
    .default("text"),
  tts_provider: plugin.Form.string()
    .title("TTS 提供商")
    .description("minimax=MiniMax t2a_v2；custom=自定义 HTTP TTS 接口")
    .default("minimax"),
  tts_api_key: plugin.Form.string().title("TTS API Key（MiniMax 用）").default(""),
  tts_model: plugin.Form.string().title("TTS 模型（MiniMax 用）").default("speech-2.8-hd"),
  tts_voice_id: plugin.Form.string().title("TTS 音色 ID（MiniMax 用）").default("female-yujie"),
  tts_custom_base_url: plugin.Form.string()
    .title("自定义 TTS BaseURL（custom 模式用）")
    .description("你的 TTS 接口地址，GET 或 POST 返回音频 URL")
    .default(""),
  tts_custom_method: plugin.Form.string()
    .title("自定义 TTS 请求方式")
    .description("GET 或 POST，默认 POST")
    .default("POST"),
  tts_custom_text_param: plugin.Form.string()
    .title("文本参数名")
    .description("GET query / POST body 里文本字段的 key，默认 text")
    .default("text"),
  tts_custom_audio_path: plugin.Form.string()
    .title("自定义 TTS 音频 URL 字段路径")
    .description("返回 JSON 里音频 URL 的路径，如 data.audio 或 url")
    .default("url"),
  // 以下仅 Gewe 平台发语音条时需要：mp3 → silk 转换 API
  convert_api: plugin.Form.string()
    .title("mp3转silk API 地址（仅Gewe）")
    .description("GET 请求，把 mp3 公网 URL 转成 silk 公网 URL。留空则 Gewe 平台语音回退文字")
    .default(""),
  convert_url_param: plugin.Form.string()
    .title("API 请求参数名")
    .description("传给 API 的 mp3 URL 参数名")
    .default("url"),
  convert_field: plugin.Form.string()
    .title("返回值取值字段")
    .description("从 API 返回 JSON 里取 silk 公网 URL 的字段")
    .default("silk_url"),
});

const historyStore = new Bucket(HISTORY_BUCKET);

// 上下文按 platform:chatId:userId 隔离——每个人各自有自己的记忆
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

function isPrivateChat(chatId, userId) {
  return !chatId || String(chatId) === String(userId);
}

function clampReply(text) {
  let out = String(text || "").trim();
  // 过滤掉角色扮演动作描写：*xxx* 或 *xxx\nxxx*
  out = out
    .replace(/^\s*\*[^*\n]+\*\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  return s.reply(
    [
      "===== AI 助手状态 =====",
      `模型：${cfg.model}`,
      `上下文轮数：${cfg.context_rounds}（当前已存 ${pairs} 轮）`,
      `内置工具：${cfg.enable_tools ? "开启（" + TOOLS.map((t) => t.function.name).join("、") + "）" : "关闭"}`,
      "发送「ai清空」可清除你的记忆",
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

  // rule 已经过滤了：能走到这里说明消息一定是 ai/AI/机器人/小助手 开头
  let promptText = rawContent.replace(PREFIX_RE, "").trim();

  // 管理指令
  if (promptText === "状态") return handleStatus(key);
  if (promptText === "清空" || promptText === "忘记") return handleClear(key);

  // 直接存记忆：ai记一下生日是1996-01-01 / ai记下密码=123456
  if (cfg.enable_memory) {
    const addMatch = promptText.match(/^(?:记一下|记下)(.+)$/);
    if (addMatch) {
      const raw = addMatch[1].trim();
      const kv = raw.match(/^(.+?)[是:=：]\s*(.+)$/);
      let k = kv ? kv[1].trim() : "备注";
      let v = kv ? kv[2].trim() : raw;
      if (v) {
        await mem.upsert(String(await s.getPlatform()), userId, k, v);
        return s.reply(`✅ 已记住：${k} = ${v}`);
      }
    }
  }

  if (!String(cfg.api_key || "").trim()) return;
  if (privateChat && !cfg.enable_private) return;
  if (!privateChat && !cfg.enable_group) return;
  if (!promptText) return; // 只发了个"ai"，等用户补内容

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
    // 注入用户长期记忆
    let finalSystemPrompt = systemPrompt;
    if (cfg.enable_memory) {
      const memList = await mem.list(systemVars.platform, userId);
      finalSystemPrompt += mem.formatContext(memList);
    }
    const messages = ai.buildMessages(finalSystemPrompt, history, promptText);
    const result = await chatWithTools(messages);
    const replyText = clampReply(result.content);
    if (!replyText) return;
    history.push({ role: "user", content: promptText });
    history.push({ role: "assistant", content: replyText });
    await saveHistory(key, history);
    // 语音回复模式
    if (cfg.reply_mode === "voice") {
      try {
        const ttsOpts =
          cfg.tts_provider === "custom"
            ? {
                provider: "custom",
                custom: {
                  baseUrl: cfg.tts_custom_base_url,
                  method: cfg.tts_custom_method,
                  textParam: cfg.tts_custom_text_param,
                  audioUrlPath: cfg.tts_custom_audio_path || "url",
                  apiKey: cfg.tts_api_key,
                },
              }
            : {
                provider: "minimax",
                apiKey: cfg.tts_api_key,
                model: cfg.tts_model,
                voiceId: cfg.tts_voice_id,
              };
        const audioUrl = await tts.synthesize(replyText, ttsOpts);
        // 平台判断：Gewe 需把 mp3 转成 silk 公网 URL 才能发语音条
        const platform = String((await s.getPlatform()) || "").toLowerCase();
        if (platform === "gewe") {
          if (!String(cfg.convert_api || "").trim()) {
            throw new Error("Gewe 平台发语音条需配置 mp3转silk 的 API 地址（convert_api）");
          }
          const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
          if (!toWxid) throw new Error("无法确定接收人(toWxid)");
          await geweCore.sendVoiceFromMp3(toWxid, audioUrl, {
            api: cfg.convert_api,
            urlParam: cfg.convert_url_param,
            field: cfg.convert_field,
          });
          return;
        }
        await s.reply(`[CQ:record,url=${audioUrl}]`);
      } catch (ttsErr) {
        await s.reply(`语音合成失败，文字回复：${replyText}`);
      }
    } else {
      await s.reply(replyText);
    }
    // 同步提取记忆（await 确保存上）
    if (cfg.enable_memory) {
      try {
        const extracted = await mem.extractFromMessage(promptText, {
          baseUrl: cfg.base_url,
          apiKey: cfg.api_key,
          model: cfg.model,
          timeout: 15000,
        });
        if (extracted) {
          await mem.upsert(systemVars.platform, userId, extracted.key, extracted.value);
          console.log(`[aiChat] 已自动记住: ${extracted.key}=${extracted.value}`);
        }
      } catch (e) {
        console.log(`[aiChat] 记忆提取失败: ${e?.message || e}`);
      }
    }
    return;
  } catch (error) {
    await s.reply(`AI 暂时摸鱼了：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`AI 聊天插件异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

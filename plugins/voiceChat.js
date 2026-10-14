// [title: 语音对话聊天]
// [name: voiceChat]
// [desc: 仅 Gewe 平台可用。收到语音消息自动转文字并接入 AI 对话（复刻 aiChat 核心逻辑）。语音转文字（STT）与 AI 对话各自独立配置模型，内置 DeepSeek/智谱GLM/Kimi/MiniMax/通义Qwen 提供商预设，思考模式默认 off 关闭（语音回复场景无需思考）。支持系统提示词变量、上下文记忆、同人冷却、群白名单与语音回复（reply_mode=voice）。]
// [author: Mianpro官方]
// [version: v2.0.0]
// [rule: raw ^\[CQ:record[^\]]*\]$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 大模型]
// [icon: https://ecmb.bdimg.com/tam-ogel/-341441530_114552854_88_88.png]
// [origin: 自定义]
// [depe: ["./geweCore.js","./whisperCore.js","./openaiChatCore.js","./ttsCore.js"]]

"use strict";
const { sender: s, Bucket, plugin } = require("sillygirl");
const geweCore = require("./geweCore.js");
const whisper = require("./whisperCore.js");
const ai = require("./openaiChatCore.js");
const tts = require("./ttsCore.js");

const HISTORY_BUCKET = "voice_chat_history";
const COOLDOWN_BUCKET = "voice_chat_cooldown";
const MAX_CONTENT_LEN = 1500;
const MAX_TOOL_ROUNDS = 4;

const form = new plugin.Form({
  // ===== 语音转文字（STT）=====
  stt_base_url: plugin.Form.string()
    .title("语音转文字 BaseURL")
    .description("OpenAI 兼容地址，如 https://api.openai.com/v1 或你的反代；留空则复用下方对话 BaseURL")
    .default(""),
  stt_api_key: plugin.Form.string()
    .title("语音转文字 API Key")
    .description("留空则复用下方对话 API Key")
    .default(""),
  stt_model: plugin.Form.string()
    .title("语音转文字模型")
    .description("whisper 系列，如 whisper-1")
    .default("whisper-1"),
  stt_language: plugin.Form.string()
    .title("识别语言")
    .description("留空自动检测，中文可填 zh")
    .default(""),
  // ===== AI 对话（chat）=====
  provider: plugin.Form.string()
    .title("大模型提供商")
    .description(
      "openai=OpenAI；deepseek=DeepSeek；glm=智谱GLM；kimi=Kimi；minimax=MiniMax；qwen=通义Qwen；custom=自定义。选好后下面 BaseURL/模型会自动带出推荐值（仍可手改）",
    )
    .default("openai"),
  base_url: plugin.Form.string()
    .title("对话 BaseURL")
    .description("OpenAI 兼容地址，如 https://api.openai.com/v1 或你的反代；留空则按提供商自动填充；不需要写 /chat/completions 后缀")
    .default(""),
  api_key: plugin.Form.string().title("对话 API Key").default("").required(),
  model: plugin.Form.string()
    .title("对话模型名")
    .description("如 gpt-4o-mini / deepseek-chat / glm-4.5 / moonshot-v1-8k / qwen-plus 等；留空则按提供商取推荐模型")
    .default(""),
  thinking: plugin.Form.string()
    .title("思考模式")
    .description(
      "off=关闭思考（默认，语音回复请保持 off，回复最快）；low/high/max=开启思考并控制力度。注意：部分思考模型（deepseek-reasoner、GLM-5.3 等）无法在请求侧关闭，off 时也会自动隐藏思考内容、只回最终答案",
    )
    .default("off"),
  show_thinking: plugin.Form.boolean()
    .title("展示思考过程")
    .description("开启后把模型思考过程附在回复前（仅文字回复模式生效；语音回复模式始终不携带）。默认关闭")
    .default(false),
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
  temperature: plugin.Form.number().title("Temperature").min(0).max(2).default(0.8),
  max_tokens: plugin.Form.integer().title("单次回复最大 Token").min(64).max(4096).default(800),
  timeout: plugin.Form.integer().title("请求超时毫秒").min(5000).max(180000).default(60000),
  // ===== 触发范围与频率 =====
  enable_private: plugin.Form.boolean().title("私聊启用").default(true),
  enable_group: plugin.Form.boolean().title("群聊启用").default(true),
  group_whitelist: plugin.Form.string()
    .title("群聊白名单")
    .description("逗号分隔的群ID，留空=启用群聊时全部群响应；填了只响应这些群")
    .default(""),
  cooldown_seconds: plugin.Form.integer()
    .title("同人冷却（秒）")
    .description("同一用户连续发语音的处理间隔，防刷接口")
    .min(0)
    .max(3600)
    .default(10),
  // ===== 语音回复（TTS）=====
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
    .description("GET 请求，把 mp3 公网 URL 转成 silk 公网 URL。留空则语音回复回退文字")
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
const cooldownStore = new Bucket(COOLDOWN_BUCKET);

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
  // Gewe：适配器拿不到对方昵称（getUserName 返回的是 ID 串），改从简要信息接口取备注/昵称
  const platform = String(await s.getPlatform()).toLowerCase();
  if (platform === "gewe") {
    const userId = String((await s.getUserId()) || "").trim();
    if (userId) {
      try {
        const list = await geweCore.getBriefInfo([userId]);
        const info = Array.isArray(list) && list[0];
        if (info) {
          const remark = String(info.remark || "").trim();
          const nick = String(info.nickName || "").trim();
          if (remark) return remark;
          if (nick) return nick;
        }
      } catch (_) {
        // 接口失败则回退到默认取值
      }
    }
  }
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

// ===== 工具注册表（OpenAI function calling，复刻 aiChat）=====
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

// 解析后的对话配置（provider 预设 + 手动覆盖），供 chatWithTools 使用
let resolvedChat = {};

async function chatWithTools(messages) {
  const baseOptions = {
    baseUrl: resolvedChat.baseUrl,
    apiKey: resolvedChat.apiKey,
    model: resolvedChat.model,
    provider: resolvedChat.provider,
    thinking: resolvedChat.thinking,
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

let cfg = {};

async function main() {
  cfg = (await form.get()) || {};
  // 模型配置解析：provider 预设兜底 + 手动覆盖
  const providerKey = String(cfg.provider || "openai").toLowerCase().trim();
  resolvedChat = {
    baseUrl: String(cfg.base_url || "").trim() || ai.getProviderBaseUrl(providerKey),
    apiKey: String(cfg.api_key || "").trim(),
    model: String(cfg.model || "").trim() || ai.getProviderDefaultModel(providerKey),
    provider: providerKey,
    thinking: String(cfg.thinking || "off").toLowerCase(),
  };
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  // 仅 Gewe 生效：语音扩展 CQ 只有 Gewe 适配器输出
  if (platform !== "gewe") return;

  const raw = String((await s.getMsg()) || "").trim();
  if (!raw || !/\[CQ:record[^\]]*\]/.test(raw)) return;

  const userId = String((await s.getUserId()) || "");
  const chatId = String((await s.getChatId()) || "");
  const privateChat = isPrivateChat(chatId, userId);

  // 触发范围
  if (privateChat && !cfg.enable_private) return;
  if (!privateChat && !cfg.enable_group) return;
  if (!privateChat) {
    const whitelist = String(cfg.group_whitelist || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (whitelist.length && !whitelist.includes(chatId)) return;
  }

  // 同人冷却（默认 10 秒内不重复处理）
  const now = Date.now();
  const lastAt = Number(await cooldownStore.get(userId, 0)) || 0;
  const cooldownMs = (Number(cfg.cooldown_seconds) || 10) * 1000;
  if (now - lastAt < cooldownMs) return;
  await cooldownStore.set(userId, now);

  // ===== 语音链路：下载 silk -> 解码 WAV -> 转文字 =====
  let text = "";
  try {
    const silkUrl = await geweCore.downloadVoiceFromCq(raw);
    if (!silkUrl) throw new Error("downloadVoice 未返回音频地址");
    const silkRes = await fetch(silkUrl, { signal: AbortSignal.timeout(Number(cfg.timeout) || 60000) });
    if (!silkRes.ok) throw new Error(`silk 下载 HTTP ${silkRes.status}`);
    const silkBuf = new Uint8Array(await silkRes.arrayBuffer());
    const wav = await whisper.silkToWav(silkBuf, 24000);
    const sttRes = await whisper.transcribe({
      baseUrl: String(cfg.stt_base_url || "").trim() || resolvedChat.baseUrl,
      apiKey: String(cfg.stt_api_key || "").trim() || cfg.api_key,
      model: String(cfg.stt_model || "whisper-1").trim(),
      language: cfg.stt_language,
      wavBuffer: wav,
      timeout: Number(cfg.timeout) || 60000,
    });
    text = sttRes.text;
  } catch (error) {
    console.log(`[voiceChat] 语音转文字失败: ${error?.message || error}`);
    return s.reply(`语音转文字失败：${String(error?.message || error).slice(0, 120)}`);
  }
  if (!text) return s.reply("没听清你说什么，请再发一次语音");

  // ===== 以下复刻 aiChat 对话逻辑 =====
  const key = await chatKey();
  const nowDate = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const systemVars = {
    now: `${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}:${String(nowDate.getSeconds()).padStart(2, "0")}`,
    date: `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`,
    weekday: `星期${weekdays[nowDate.getDay()]}`,
    nickname: await getNickname(),
    user_id: userId,
    platform,
  };

  try {
    const history = await loadHistory(key);
    const systemPrompt = renderPrompt(cfg.system_prompt, systemVars);
    const messages = ai.buildMessages(systemPrompt, history, text);
    const result = await chatWithTools(messages);
    const replyText = clampReply(result.content);
    if (!replyText) return;
    // 展示思考过程（仅文字回复模式；语音回复读正式回答，不带思考）
    let finalReply = replyText;
    const thinkText = String(result.reasoningContent || "").trim();
    if (cfg.show_thinking && thinkText) {
      finalReply = `🤔 思考：${clampReply(thinkText).slice(0, 800)}\n\n${replyText}`;
    }
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: replyText });
    await saveHistory(key, history);
    // 语音回复模式（复刻 aiChat：TTS 合成 -> Gewe mp3转silk 发语音条，失败回退文字）
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
        const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
        if (!toWxid) throw new Error("无法确定接收人(toWxid)");
        if (!String(cfg.convert_api || "").trim()) {
          throw new Error("语音回复需配置 mp3转silk 的 API 地址（convert_api）");
        }
        await geweCore.sendVoiceFromMp3(toWxid, audioUrl, {
          api: cfg.convert_api,
          urlParam: cfg.convert_url_param,
          field: cfg.convert_field,
        });
        return;
      } catch (ttsErr) {
        console.log(`[voiceChat] 语音回复失败，回退文字: ${ttsErr?.message || ttsErr}`);
        await s.reply(`语音回复失败，文字回复：${replyText}`);
        return;
      }
    }
    await s.reply(finalReply);
  } catch (error) {
    await s.reply(`AI 暂时摸鱼了：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`语音聊天插件异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

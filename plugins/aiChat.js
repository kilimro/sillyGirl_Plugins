// [title: AI 聊天助手]
// [name: aiChat]
// [desc: 接入任意 OpenAI 兼容接口的 AI 助手，内置 DeepSeek/智谱GLM/Kimi/MiniMax/通义Qwen 提供商预设。触发词：起床了绵绵 / mark / 小助手，消息任意位置出现即触发（大小写不敏感），其他命令走原插件不抢。支持 BaseURL/Key/模型/长系统提示词（变量插值）/上下文轮数/工具调用/思考模式控制（thinking 默认 off 关闭，语音回复场景无需思考）。v3.1 起会话记忆统一走 mm_chat_history，与 voiceChat/visionChat 共享上下文（发图识别后可直接追问图片内容）。v3.4 起工具统一由 aiToolCore 注册表提供（时间/天气/公网IP/Tavily 联网搜索），新增工具无需改本插件。]
// [author: Mianpro官方]
// [version: v3.4.0]
// [rule: 起床了绵绵|mark|Mark|小助手]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 大模型]
// [icon: https://ecmb.bdimg.com/tam-ogel/-341441530_114552854_88_88.png]
// [origin: 自定义]
// [depe: ["./aiToolCore.js","./geweCore.js","./memoryCore.js","./openaiChatCore.js","./ttsCore.js"]]

const { sender: s, plugin } = require("sillygirl");
const ai = require("./openaiChatCore.js");
const tools = require("./aiToolCore.js");
const mem = require("./memoryCore.js");
const tts = require("./ttsCore.js");
const geweCore = require("./geweCore.js");

const MAX_CONTENT_LEN = 1500;

// 触发词（任意位置命中）：起床了绵绵 / mark(不区分大小写) / 小助手
const TRIGGER_RE = /起床了绵绵|mark|小助手/i;

const form = new plugin.Form({
  provider: plugin.Form.string()
    .title("大模型提供商")
    .description(
      "openai=OpenAI；deepseek=DeepSeek；glm=智谱GLM；kimi=Kimi；minimax=MiniMax；qwen=通义Qwen；custom=自定义。选好后下面 BaseURL/模型会自动带出推荐值（仍可手改）",
    )
    .default("openai"),
  base_url: plugin.Form.string()
    .title("OpenAI 兼容 BaseURL")
    .description(
      "例如 https://api.openai.com/v1，或第三方中转/自建地址；留空则按提供商自动填充；不需要写 /chat/completions 后缀",
    )
    .default(""),
  api_key: plugin.Form.string().title("API Key").default("").required(),
  model: plugin.Form.string()
    .title("模型名")
    .description("如 gpt-4o-mini / deepseek-chat / glm-4.5 / moonshot-v1-8k / qwen-plus 等；留空则按提供商取推荐模型")
    .default(""),
  thinking: plugin.Form.string()
    .title("思考模式")
    .description(
      "off=关闭思考（默认，回复最快，语音回复场景请保持 off）；low/high/max=开启思考并控制力度。注意：部分思考模型（deepseek-reasoner、GLM-5.3 等）无法在请求侧关闭，off 时也会自动隐藏思考内容、只回最终答案",
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
    .title("启用工具（时间/天气/公网IP/联网搜索）")
    .description("开启后 AI 可主动调用工具回答“几点了”“北京天气”“服务器 IP”以及需要实时联网检索的问题")
    .default(true),
  tavily_api_key: plugin.Form.string()
    .title("Tavily 联网搜索 Key（可选）")
    .description(
      "配置后解锁 search_web 实时联网搜索；填一次会被 aiToolCore 持久化，voiceChat 等其他 AI 插件共享。留空则仅使用本地工具",
    )
    .format("password")
    .default(""),
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

// 上下文按 platform:chatId:userId 隔离——统一会话记忆由 openaiChatCore 提供（与 voiceChat/visionChat 互通）
async function chatKey() {
  return ai.chatKey(
    String(await s.getPlatform()) || "unknown",
    String((await s.getChatId()) || (await s.getUserId())),
    String((await s.getUserId()) || ""),
  );
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

// 工具统一由 aiToolCore 注册表提供（时间/天气/公网IP/联网搜索），多轮循环复用 tools.chatLoop
// 解析后的对话配置（provider 预设 + 手动覆盖）
let resolvedChat = {};

async function handleStatus(key) {
  const history = await ai.loadHistory(key);
  const pairs = Math.floor(history.length / 2);
  return s.reply(
    [
      "===== AI 助手状态 =====",
      `提供商：${String(cfg.provider || "openai")}（模型：${resolvedChat.model || cfg.model}）`,
      `思考模式：${String(cfg.thinking || "off")}（${cfg.show_thinking ? "展示思考" : "隐藏思考"}）`,
      `上下文轮数：${cfg.context_rounds}（当前已存 ${pairs} 轮）`,
      `可用工具：${
        cfg.enable_tools
          ? "开启（" +
            tools
              .listTools()
              .map((t) => t.function.name)
              .join("、") +
            "）"
          : "关闭"
      }`,
      "发送「ai清空」可清除你的记忆",
    ].join("\n"),
  );
}

async function handleClear(key) {
  await ai.clearHistory(key);
  return s.reply("已清除你的 AI 记忆");
}

let cfg = {};

async function main() {
  cfg = (await form.get()) || {};
  // 模型配置解析：provider 预设兜底 + 手动覆盖
  const providerKey = String(cfg.provider || "openai")
    .toLowerCase()
    .trim();
  resolvedChat = {
    baseUrl: String(cfg.base_url || "").trim() || ai.getProviderBaseUrl(providerKey),
    apiKey: String(cfg.api_key || "").trim(),
    model: String(cfg.model || "").trim() || ai.getProviderDefaultModel(providerKey),
    provider: providerKey,
    thinking: String(cfg.thinking || "off").toLowerCase(),
  };
  // 工具配置注入（Tavily Key 持久化到 aiToolCore，跨插件共享）
  await tools.configure({ tavilyApiKey: cfg.tavily_api_key });
  const rawContent = String((await s.getMsg()) || "").trim();
  if (!rawContent) return;

  const key = await chatKey();
  const userId = String((await s.getUserId()) || "");
  const chatId = String((await s.getChatId()) || "");
  const privateChat = isPrivateChat(chatId, userId);

  // rule 已过滤：能走到这里说明消息中出现了触发词（起床了绵绵/mark/小助手），剥掉触发词后交给模型
  let promptText = rawContent
    .replace(TRIGGER_RE, "")
    .replace(/^[，,、:：\s]+|[，,、:：\s]+$/g, "")
    .trim();

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

  if (!resolvedChat.apiKey) return;
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
    history = await ai.loadHistory(key);
    const systemPrompt = renderPrompt(cfg.system_prompt, systemVars);
    // 注入用户长期记忆
    let finalSystemPrompt = systemPrompt;
    if (cfg.enable_memory) {
      const memList = await mem.list(systemVars.platform, userId);
      finalSystemPrompt += mem.formatContext(memList);
    }
    const messages = ai.buildMessages(finalSystemPrompt, history, promptText);
    const result = await tools.chatLoop(
      ai,
      {
        baseUrl: resolvedChat.baseUrl,
        apiKey: resolvedChat.apiKey,
        model: resolvedChat.model,
        provider: resolvedChat.provider,
        thinking: resolvedChat.thinking,
        temperature: cfg.temperature,
        maxTokens: cfg.max_tokens,
        timeout: cfg.timeout,
        enabled: cfg.enable_tools,
      },
      messages,
    );
    const replyText = clampReply(result.content);
    if (!replyText) return;
    // 展示思考过程（仅文字回复模式；语音回复读正式回答，不带思考）
    let finalReply = replyText;
    const thinkText = String(result.reasoningContent || "").trim();
    if (cfg.show_thinking && thinkText) {
      finalReply = `🤔 思考：${clampReply(thinkText).slice(0, 800)}\n\n${replyText}`;
    }
    history.push({ role: "user", content: promptText });
    history.push({ role: "assistant", content: replyText });
    await ai.saveHistory(key, history, Number(cfg.context_rounds) || 10);
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
      await s.reply(finalReply);
    }
    // 同步提取记忆（await 确保存上）
    if (cfg.enable_memory) {
      try {
        const extracted = await mem.extractFromMessage(promptText, {
          baseUrl: resolvedChat.baseUrl,
          apiKey: resolvedChat.apiKey,
          model: resolvedChat.model,
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

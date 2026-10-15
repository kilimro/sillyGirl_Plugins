// [title: OpenAI 对话公共模块]
// [name: openaiChatCore]
// [desc: OpenAI 兼容 /chat/completions 调用、消息历史裁剪与超时重试公共能力。内置国内主流大模型提供商预设（DeepSeek/智谱GLM/Kimi/MiniMax/通义Qwen），支持思考模式控制（thinking off/low/high/max，默认 off 关闭）、reasoning_content 解析与工具调用多轮回传。v3.0 起提供统一会话记忆（mm_chat_history），aiChat/voiceChat/visionChat 共用同一份上下文，实现跨插件记忆互通。]
// [author: Mianpro官方]
// [version: v3.0.0]
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

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_TEMPERATURE = 0.8;
const DEFAULT_MAX_TOKENS = 800;

const DEFAULT_SYSTEM_PROMPT = [
  "你是一个友善、有趣的群聊 AI 助手，正在和群友用中文聊天。",
  "要求：",
  "1. 回答简短自然，像真人聊天，不要长篇大论，不要用 markdown 标题；",
  "2. 不要主动说自己是 AI 或语言模型；",
  "3. 可以偶尔接梗、玩梗，但不抬杠、不人身攻击；",
  "4. 不知道就直接说不知道，不要编造事实；",
  "5. 不要重复用户刚说的话；",
  "6. 不要输出任何动作描写、心理活动描写，不要用 *xxx* 斜体演剧情，直接说人话。",
].join("\n");

// ===== 国内主流大模型提供商预设（均为 OpenAI 兼容接口；模型名可能更新，可手改）=====
const PROVIDERS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
    label: "OpenAI",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    label: "DeepSeek",
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4.5", "glm-4.5-thinking", "glm-5.3"],
    label: "智谱 GLM",
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "kimi-k2-thinking", "kimi-k2.6"],
    label: "Kimi",
  },
  minimax: {
    baseUrl: "https://api.minimaxi.com/v1",
    models: ["MiniMax-Text-01", "abab6.5s-chat"],
    label: "MiniMax",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    label: "通义 Qwen",
  },
  custom: { baseUrl: "", models: [], label: "自定义" },
};

function normalizeBaseUrl(value) {
  let base = String(value || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  if (!/\/chat\/completions$/.test(base)) base = `${base}/chat/completions`;
  return base;
}

function maskKey(key) {
  const text = String(key || "");
  if (text.length <= 8) return text ? "***" : "";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function trimHistory(history, maxRounds) {
  const limit = Number.isInteger(maxRounds) && maxRounds > 0 ? maxRounds : 10;
  const messages = Array.isArray(history)
    ? history.filter((m) => m && (m.role === "user" || m.role === "assistant"))
    : [];
  const maxPairs = limit * 2;
  return messages.slice(-maxPairs);
}

// ===== 统一会话记忆（aiChat / voiceChat / visionChat 共用同一份，实现跨插件记忆互通）=====
const UNIFIED_HISTORY_BUCKET = "mm_chat_history";
const historyStore = new Bucket(UNIFIED_HISTORY_BUCKET);

function chatKey(platform, chatId, userId) {
  return `${String(platform || "unknown")}:${String(chatId || userId || "")}:${String(userId || "")}`;
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

async function saveHistory(key, history, maxRounds) {
  const limit = (Number.isInteger(maxRounds) && maxRounds > 0 ? maxRounds : 10) * 2 + 2;
  const trimmed = Array.isArray(history) ? history.slice(-limit) : [];
  await historyStore.set(key, JSON.stringify(trimmed));
}

async function clearHistory(key) {
  await historyStore.delete(key);
}

function buildMessages(systemPrompt, history, userContent) {
  const messages = [];
  const system = String(systemPrompt || "").trim();
  if (system) messages.push({ role: "system", content: system });
  for (const item of trimHistory(history, Number.MAX_SAFE_INTEGER))
    messages.push({ role: item.role, content: String(item.content || "") });
  messages.push({ role: "user", content: String(userContent || "") });
  return messages;
}

// ===== 提供商解析 =====
function getProviderKey(provider) {
  const key = String(provider || "custom").toLowerCase().trim();
  return PROVIDERS[key] ? key : "custom";
}

function getProviderBaseUrl(provider) {
  const key = getProviderKey(provider);
  return PROVIDERS[key].baseUrl || DEFAULT_BASE_URL;
}

function getProviderDefaultModel(provider) {
  const key = getProviderKey(provider);
  return (PROVIDERS[key].models && PROVIDERS[key].models[0]) || DEFAULT_MODEL;
}

function getProviderModels(provider) {
  const key = getProviderKey(provider);
  return (PROVIDERS[key].models || []).slice();
}

function resolveBaseUrl(provider, baseUrl) {
  if (String(baseUrl || "").trim()) return normalizeBaseUrl(baseUrl);
  return normalizeBaseUrl(getProviderBaseUrl(provider));
}

// 判断模型名是否疑似思考模型（这些模型请求里通常不支持 temperature/top_p 等参数）
function isThinkingModel(model) {
  const m = String(model || "").toLowerCase();
  return /(reasoner|thinking|think|glm-5|k2|o1-|o3-|deepseek-r)/.test(m);
}

// 按提供商映射思考控制请求参数；off=请求侧尝试关闭思考（能关的关掉）
function buildThinkingParam(provider, model, thinking) {
  const key = getProviderKey(provider);
  const level = String(thinking || "off").toLowerCase();
  if (level === "off") {
    // 请求侧尝试关闭：GLM 旧模型 / Kimi 支持 thinking disabled；其余（deepseek-reasoner、GLM-5.3 等强制思考）忽略，由输出侧剥离
    if (key === "glm") return { thinking: { type: "disabled" } };
    if (key === "kimi") return { thinking: { type: "disabled" } };
    return null;
  }
  const effort = ["low", "high", "max"].includes(level) ? level : "high";
  if (key === "glm") return { thinking: { type: "enabled" }, reasoning_effort: effort };
  if (key === "kimi") return { thinking: { type: "enabled", effort } };
  if (key === "openai") return { reasoning_effort: effort };
  return null;
}

async function chat(options = {}) {
  const providerKey = getProviderKey(options.provider);
  const baseUrl = resolveBaseUrl(providerKey, options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw new Error("未配置 API Key");
  const preset = PROVIDERS[providerKey];
  const model = String(options.model || (preset.models && preset.models[0]) || DEFAULT_MODEL).trim();
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT;
  const temperature = options.temperature === undefined ? DEFAULT_TEMPERATURE : Number(options.temperature);
  const maxTokens = Number(options.maxTokens) || DEFAULT_MAX_TOKENS;
  const thinking = String(options.thinking || "off").toLowerCase();
  const thinkingOn = thinking !== "off";
  const thinkingModel = isThinkingModel(model);

  const body = {
    model,
    messages: Array.isArray(options.messages) ? options.messages : [],
    max_tokens: maxTokens,
    stream: false,
  };
  // 思考模式参数（off 时尝试请求侧关闭；开启时注入级别）
  const thinkingParam = buildThinkingParam(providerKey, model, thinking);
  if (thinkingParam) Object.assign(body, thinkingParam);
  // 思考场景（开启思考或模型本身是思考模型）多不支持 temperature，自动剔除避免 400
  if (!thinkingOn && !thinkingModel) body.temperature = temperature;
  if (Array.isArray(options.tools) && options.tools.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice || "auto";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`请求超时（${timeout}ms）`);
    throw new Error(`网络请求失败：${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || text.slice(0, 200);
    throw new Error(`API HTTP ${response.status}：${detail}`);
  }

  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const message = choice?.message || {};
  // 思考模型统一输出 reasoning_content（DeepSeek/Kimi/GLM/MiniMax），与 content 分开
  const reasoningContent = String(message?.reasoning_content || "").trim();
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return {
    content: String(message.content || "").trim(),
    reasoningContent,
    toolCalls,
    raw: data,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  PROVIDERS,
  normalizeBaseUrl,
  maskKey,
  trimHistory,
  buildMessages,
  getProviderKey,
  getProviderBaseUrl,
  getProviderDefaultModel,
  getProviderModels,
  resolveBaseUrl,
  isThinkingModel,
  buildThinkingParam,
  chat,
  UNIFIED_HISTORY_BUCKET,
  chatKey,
  loadHistory,
  saveHistory,
  clearHistory,
};

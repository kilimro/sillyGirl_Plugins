// [title: OpenAI 对话公共模块]
// [name: openaiChatCore]
// [desc: OpenAI 兼容 /chat/completions 调用、消息历史裁剪与超时重试公共能力，供 AI 聊天插件复用]
// [author: kilimro]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://api.iconify.design/lucide:message-square-bot.svg]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

"use strict";

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
  "5. 不要重复用户刚说的话。",
].join("\n");

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

function buildMessages(systemPrompt, history, userContent) {
  const messages = [];
  const system = String(systemPrompt || "").trim();
  if (system) messages.push({ role: "system", content: system });
  for (const item of trimHistory(history, Number.MAX_SAFE_INTEGER))
    messages.push({ role: item.role, content: String(item.content || "") });
  messages.push({ role: "user", content: String(userContent || "") });
  return messages;
}

async function chat(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw new Error("未配置 API Key");
  const model = String(options.model || DEFAULT_MODEL).trim();
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT;
  const temperature = options.temperature === undefined ? DEFAULT_TEMPERATURE : Number(options.temperature);
  const maxTokens = Number(options.maxTokens) || DEFAULT_MAX_TOKENS;

  const body = {
    model,
    messages: Array.isArray(options.messages) ? options.messages : [],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
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
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return {
      content: String(message.content || "").trim(),
      toolCalls: message.tool_calls,
      raw: data,
    };
  }
  return {
    content: String(message.content || "").trim(),
    toolCalls: [],
    raw: data,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  normalizeBaseUrl,
  maskKey,
  trimHistory,
  buildMessages,
  chat,
};

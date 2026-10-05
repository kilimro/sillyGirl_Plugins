// [title: TTS 语音合成公共模块]
// [name: ttsCore]
// [desc: 文本转语音公共模块，支持 MiniMax 和自定义 HTTP TTS 接口，返回音频 URL 供 CQ:record 使用]
// [author: Mianpro官方]
// [version: v2.1.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://platform.minimax.cn/docs/_mintlify/favicons/minimax-zh/DMz0Zpj7JInghPSs/_generated/favicon/android-chrome-192x192.png]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

"use strict";

const DEFAULT_TIMEOUT = 30000;

// ===== MiniMax provider =====
const MINIMAX_BASE = "https://api.minimax.cn";

async function synthesizeMinimax(text, opts) {
  const baseUrl = String(opts.baseUrl || MINIMAX_BASE).replace(/\/+$/, "");
  const body = {
    model: opts.model || "speech-2.8-hd",
    text,
    stream: false,
    voice_setting: {
      voice_id: opts.voiceId || "female-yujie",
      speed: Number(opts.speed || 1),
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
    output_format: "url",
  };

  const res = await fetch(`${baseUrl}/v1/t2a_v2`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`MiniMax TTS HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax TTS 错误：${data.base_resp.status_msg || "unknown"}`);
  }
  const url = data?.data?.audio;
  if (!url) throw new Error("MiniMax 未返回音频 URL");
  return url;
}

// ===== Custom HTTP provider =====
// opts.custom: { baseUrl, method: "GET"|"POST", apiKey, audioUrlPath, textParam, extraBody }
async function synthesizeCustom(text, opts) {
  const custom = opts.custom || {};
  let baseUrl = String(custom.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("custom TTS baseUrl 未配置");

  const method = String(custom.method || "POST").toUpperCase();
  const headers = {};
  if (custom.apiKey) headers.authorization = `Bearer ${custom.apiKey}`;

  let res;
  if (method === "GET") {
    const param = encodeURIComponent(custom.textParam || "text");
    const sep = baseUrl.includes("?") ? "&" : "?";
    baseUrl = `${baseUrl}${sep}${param}=${encodeURIComponent(text)}`;
    res = await fetch(baseUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT),
    });
  } else {
    headers["content-type"] = "application/json";
    const body = { [custom.textParam || "text"]: text, ...(custom.extraBody || {}) };
    res = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Custom TTS HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const path = String(custom.audioUrlPath || "url").split(".");
  let node = data;
  for (const key of path) {
    node = node?.[key];
    if (node === undefined || node === null) break;
  }
  if (!node || typeof node !== "string") {
    throw new Error(`Custom TTS 返回里找不到音频 URL（路径 ${custom.audioUrlPath}）`);
  }
  return node;
}

// ===== 统一入口 =====
// opts: { provider: "minimax"|"custom", ...minimaxOpts, custom: {...} }
async function synthesize(text, opts) {
  const content = String(text || "").trim();
  if (!content) throw new Error("待合成文本为空");

  const provider = String(opts.provider || "minimax");
  if (provider === "custom") return synthesizeCustom(content, opts);
  return synthesizeMinimax(content, opts);
}

module.exports = {
  synthesize,
  DEFAULT_TIMEOUT,
};

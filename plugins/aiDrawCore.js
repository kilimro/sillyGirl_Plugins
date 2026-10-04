// [title: AI 画图公共模块]
// [name: aiDrawCore]
// [desc: 文生图公共模块，支持 MiniMax image_generation 和 OpenAI 兼容 /v1/images/generations，返回图片 URL 列表]
// [author: kilimro]
// [version: v1.0.0]
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

const DEFAULT_TIMEOUT = 120000;

// MiniMax 文生图
// opts: { apiKey, model, prompt, aspectRatio, n }
async function drawMinimax(opts) {
  const res = await fetch("https://api.minimax.cn/v1/image_generation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model || "image-01",
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio || "1:1",
      response_format: "url",
      n: Number(opts.n || 1),
    }),
    signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`MiniMax 画图 HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax 画图错误：${data.base_resp.status_msg || "unknown"}`);
  }
  const urls = data?.data?.image_urls;
  if (!Array.isArray(urls) || !urls.length) throw new Error("MiniMax 未返回图片");
  return urls;
}

// OpenAI 兼容 /v1/images/generations
// opts: { baseUrl, apiKey, model, prompt, n, size }
async function drawOpenAI(opts) {
  const baseUrl = String(opts.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model || "dall-e-3",
      prompt: opts.prompt,
      n: Number(opts.n || 1),
      size: opts.size || "1024x1024",
    }),
    signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI 画图 HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const urls = (data?.data || []).map((d) => d.url).filter(Boolean);
  if (!urls.length) throw new Error("OpenAI 未返回图片 URL");
  return urls;
}

// 统一入口
// opts: { provider: "minimax"|"openai", ...providerOpts }
async function draw(opts) {
  const provider = String(opts.provider || "minimax");
  if (provider === "openai") return drawOpenAI(opts);
  return drawMinimax(opts);
}

module.exports = { draw, DEFAULT_TIMEOUT };

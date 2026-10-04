// [title: TTS 语音合成公共模块]
// [name: ttsCore]
// [desc: 文本转语音公共模块，当前接入 MiniMax t2a_v2，返回音频 URL 供 CQ:record 使用；后续可扩展其他 TTS 提供商]
// [author: kilimro]
// [version: v1.0.0]
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

const DEFAULT_BASE_URL = "https://api.minimax.cn";
const DEFAULT_MODEL = "speech-2.8-hd";
const DEFAULT_VOICE_ID = "female-yujie";
const DEFAULT_SPEED = 1.0;
const DEFAULT_TIMEOUT = 30000;

// 用 MiniMax t2a_v2 把文本合成语音，返回音频 URL
// opts: { baseUrl, apiKey, model, voiceId, speed, timeout }
async function synthesize(text, opts) {
  const content = String(text || "").trim();
  if (!content) throw new Error("待合成文本为空");

  const baseUrl = String(opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const body = {
    model: String(opts.model || DEFAULT_MODEL),
    text: content,
    stream: false,
    voice_setting: {
      voice_id: String(opts.voiceId || DEFAULT_VOICE_ID),
      speed: Number(opts.speed || DEFAULT_SPEED),
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

module.exports = {
  synthesize,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_VOICE_ID,
  DEFAULT_SPEED,
};

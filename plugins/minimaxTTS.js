// [title: MiniMax 语音合成]
// [name: minimaxTTS]
// [desc: 发"说你好"把文字转成语音，通过 CQ:record 回复。音色/模型/语速可配置。Gewe 平台用第三方 API 把 mp3 转成 silk 公网 URL 发送语音条；其他平台直接发 mp3 URL。]
// [author: Mianpro官方]
// [version: v4.0.0]
// [rule: ^说(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://platform.minimax.cn/docs/_mintlify/favicons/minimax-zh/DMz0Zpj7JInghPSs/_generated/favicon/android-chrome-192x192.png]
// [origin: 自定义]
// [depe: ["./ttsCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const tts = require("./ttsCore.js");

const form = new plugin.Form({
  api_key: plugin.Form.string().title("MiniMax API Key").default("").required(),
  model: plugin.Form.string()
    .title("模型")
    .description("speech-2.8-hd 最高质量，speech-2.8-turbo 更快更便宜")
    .default("speech-2.8-hd")
    .required(),
  voice_id: plugin.Form.string()
    .title("音色 ID")
    .description("默认 female-yujie（御姐）。其他音色见 https://platform.minimax.cn/docs/faq/system-voice-id")
    .default("female-yujie")
    .required(),
  speed: plugin.Form.number().title("语速").min(0.5).max(2).default(1.0),
  // 以下仅 Gewe 平台发送语音条时需要：mp3 → silk 转换 API
  convert_api: plugin.Form.string()
    .title("mp3转silk API 地址（仅Gewe）")
    .description("GET 请求，把 mp3 公网 URL 转成 silk 公网 URL。留空则 Gewe 平台不发语音条")
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

// 默认浏览器 UA：该 API 不带 UA 会返回 403
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * 调用第三方 API 把 mp3 公网 URL 转成 silk 公网 URL（供 Gewe 发语音条）。
 * @param {string} mp3Url
 * @param {{api:string, urlParam?:string, field?:string, timeout?:number}} [opts]
 * @returns {Promise<string>} silk 公网 URL
 */
async function mp3ToSilkUrl(mp3Url, opts = {}) {
  const api = String(opts.api || "").trim();
  if (!api) throw new Error("未配置 mp3 转 silk 的 API 地址（convert_api）");
  const urlParam = String(opts.urlParam || "").trim() || "url";
  const field = String(opts.field || "").trim() || "silk_url";
  const sep = api.includes("?") ? "&" : "?";
  const target = `${api}${sep}${encodeURIComponent(urlParam)}=${encodeURIComponent(mp3Url)}`;
  const res = await fetch(target, {
    method: "GET",
    headers: { "user-agent": DEFAULT_UA },
    signal: AbortSignal.timeout(Number(opts.timeout) || 30000),
  });

  // 先取文本，统一解析，避免 "not valid JSON" 这类难定位的报错
  const text = await res.text().catch(() => "");
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error(
        `mp3转silk API 返回不是 JSON（HTTP ${res.status}）——多半是 mp3 URL 失效或不可访问，或服务端报错。返回内容：${String(
          text,
        )
          .replace(/\s+/g, " ")
          .slice(0, 160)}`,
      );
    }
  }

  if (!res.ok) {
    const detail = data && (data.msg || data.error);
    throw new Error(`mp3转silk API HTTP ${res.status}${detail ? `：${detail}` : ""}`);
  }
  if (data && data.ok === false) {
    throw new Error(`mp3转silk 失败：${String(data.error || data.msg || "未知")}`);
  }
  const url = data && data[field];
  if (!url || typeof url !== "string") {
    throw new Error(`mp3转silk API 返回里找不到字段 ${field}`);
  }
  return url;
}

let cfg = {};
async function main() {
  cfg = (await form.get()) || {};
  if (!String(cfg.api_key || "").trim()) return;

  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(/^说(.+)$/);
  if (!m) return;
  const text = m[1].trim();
  if (!text) return;

  // 平台判断：只有 Gewe 需要把 mp3 转成 silk 公网 URL 才能发语音条
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const isGewe = platform === "gewe";

  try {
    const url = await tts.synthesize(text, {
      provider: "minimax",
      apiKey: cfg.api_key,
      model: cfg.model,
      voiceId: cfg.voice_id,
      speed: cfg.speed,
    });

    if (isGewe) {
      if (!String(cfg.convert_api || "").trim()) {
        return s.reply("Gewe 平台发语音条需配置 mp3转silk 的 API 地址（convert_api）");
      }
      const silkUrl = await mp3ToSilkUrl(url, {
        api: cfg.convert_api,
        urlParam: cfg.convert_url_param,
        field: cfg.convert_field,
      });
      return s.reply(`[CQ:record,url=${silkUrl}]`);
    }

    // 其他平台：直接发 mp3 URL 的 record
    await s.reply(`[CQ:record,url=${url}]`);
  } catch (error) {
    await s.reply(`语音合成失败：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`TTS 插件异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

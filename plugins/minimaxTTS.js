// [title: MiniMax 语音合成]
// [name: minimaxTTS]
// [desc: 发"说你好"把文字转成语音，通过 CQ:record 回复。音色/模型/语速可配置。Gewe 平台用第三方 API 把 mp3 转成 silk 公网 URL 发送语音条；其他平台直接发 mp3 URL。]
// [author: Mianpro官方]
// [version: v4.2.0]
// [rule: ^说(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://platform.minimax.cn/docs/_mintlify/favicons/minimax-zh/DMz0Zpj7JInghPSs/_generated/favicon/android-chrome-192x192.png]
// [origin: 自定义]
// [depe: ["./geweCore.js","./ttsCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const tts = require("./ttsCore.js");
const geweCore = require("./geweCore.js");

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
      const { url: silkUrl, duration } = await geweCore.mp3ToSilkUrl(url, {
        api: cfg.convert_api,
        urlParam: cfg.convert_url_param,
        field: cfg.convert_field,
      });
      // 走 Gewe postVoice 直接发语音条（配置从 gewe 桶自动读取，voiceDuration 用 convert 返回的时长）
      const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
      if (!toWxid) return s.reply("无法确定接收人(toWxid)");
      await geweCore.sendVoice({ toWxid, voiceUrl: silkUrl, voiceDuration: duration });
      return;
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

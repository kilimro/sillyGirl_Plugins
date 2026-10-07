// [title: MiniMax 语音合成]
// [name: minimaxTTS]
// [desc: 发"说你好"把文字转成语音，通过 CQ:record 回复。音色/模型/语速可配置。Gewe 平台自动把语音转成 silk 并上传 R2，用公网 URL 发送语音条；其他平台直接发 mp3 URL。]
// [author: Mianpro官方]
// [version: v3.0.0]
// [rule: ^说(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://platform.minimax.cn/docs/_mintlify/favicons/minimax-zh/DMz0Zpj7JInghPSs/_generated/favicon/android-chrome-192x192.png]
// [origin: 自定义]
// [depe: ["./geweMedia.js","./ttsCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const tts = require("./ttsCore.js");
const gewe = require("./geweMedia.js");

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
  // 以下仅 Gewe 平台发送语音条时需要（转 silk 上传 R2 取公网 URL）
  r2_account_id: plugin.Form.string().title("R2 账户ID（仅Gewe）").default(""),
  r2_access_key: plugin.Form.string().title("R2 Access Key ID（仅Gewe）").default(""),
  r2_secret_key: plugin.Form.string().title("R2 Secret Access Key（仅Gewe）").default(""),
  r2_bucket: plugin.Form.string().title("R2 Bucket 名（仅Gewe）").default(""),
  r2_public_url: plugin.Form.string()
    .title("R2 公网访问域名（仅Gewe）")
    .description("如 https://pub.example.com，上传后拼在 key 前")
    .default(""),
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

  // 平台判断：只有 Gewe 需要 silk + 公网 URL 才能发语音条
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
      const r2ok =
        String(cfg.r2_account_id || "").trim() &&
        String(cfg.r2_access_key || "").trim() &&
        String(cfg.r2_secret_key || "").trim() &&
        String(cfg.r2_bucket || "").trim() &&
        String(cfg.r2_public_url || "").trim();
      if (!r2ok) {
        return s.reply("Gewe 平台发语音条需配置 R2 五件套（账户ID/AccessKey/SecretKey/Bucket/公网域名）");
      }
      gewe.configure({
        upload: {
          provider: "r2",
          accountId: String(cfg.r2_account_id).trim(),
          accessKeyId: String(cfg.r2_access_key).trim(),
          secretAccessKey: String(cfg.r2_secret_key).trim(),
          bucketName: String(cfg.r2_bucket).trim(),
          publicBaseUrl: String(cfg.r2_public_url).trim(),
        },
      });
      // mp3 URL → 本地转 silk → 上传 R2 → 公网 silk URL
      const silkUrl = await gewe.toSilkPublicUrl(url);
      return s.reply(gewe.cqRecord(silkUrl));
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

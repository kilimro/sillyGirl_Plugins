// [title: MiniMax 语音合成]
// [name: minimaxTTS]
// [desc: 发"说你好"把文字转成语音，通过 CQ:record 回复。音色/模型/语速可配置。]
// [author: kilimro]
// [version: v1.0.0]
// [rule: ^说(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://platform.minimax.cn/docs/_mintlify/favicons/minimax-zh/DMz0Zpj7JInghPSs/_generated/favicon/android-chrome-192x192.png]
// [origin: 自定义]
// [depe: ["./ttsCore.js"]]

const { sender: s, plugin } = require("sillygirl");
const tts = require("./ttsCore.js");

const form = new plugin.Form({
  api_key: plugin.Form.string().title("MiniMax API Key").default("").required(),
  model: plugin.Form.string()
    .title("模型")
    .description("speech-2.8-hd 最高质量，speech-2.8-turbo 更快更便宜")
    .default(tts.DEFAULT_MODEL)
    .required(),
  voice_id: plugin.Form.string()
    .title("音色 ID")
    .description("默认 female-yujie（御姐）。其他音色见 https://platform.minimax.cn/docs/faq/system-voice-id")
    .default(tts.DEFAULT_VOICE_ID)
    .required(),
  speed: plugin.Form.number().title("语速").min(0.5).max(2).default(tts.DEFAULT_SPEED),
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

  try {
    const url = await tts.synthesize(text, {
      apiKey: cfg.api_key,
      model: cfg.model,
      voiceId: cfg.voice_id,
      speed: cfg.speed,
    });
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

// [title: 语音下载]
// [name: voiceDownload]
// [desc: 仅 Gewe 平台可用。发"下载语音/语音下载/看看这条语音"后提示在一分钟内发送语音，收到语音即调 downloadVoice 下载并回复 silk URL（可同时发语音条）。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: ^(下载语音|语音下载|看看这条语音)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const gewe = require("./geweCore.js");

const form = new plugin.Form({
  output_mode: plugin.Form.string()
    .title("回复方式")
    .description("url=回silk文字URL record=发语音条 both=都发")
    .default("url"),
  wait_tip: plugin.Form.string()
    .title("等待提示")
    .description("发出触发词后提示用户发语音的文案")
    .default("请在一分钟内发送语音"),
  timeout_tip: plugin.Form.string()
    .title("超时提示")
    .description("一分钟后没收到语音时的文案")
    .default("等待超时，请重新发送下载语音"),
});

async function main() {
  const cfg = (await form.get()) || {};
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const raw = String((await s.getMsg()) || "").trim();

  // 精确触发词（rule 已限定，此处兜底）
  if (!/^(下载语音|语音下载|看看这条语音)$/.test(raw)) return;
  // 仅 Gewe 平台可用（扩展 CQ 码只有 Gewe 适配器输出）
  if (platform !== "gewe") return s.reply("该功能仅 Gewe 平台可用");

  await s.reply(String(cfg.wait_tip || "请在一分钟内发送语音"));

  const result = await s.listen({
    rules: ["raw ^\\[CQ:record[^\\]]*\\]$"],
    timeout: 60000, // 一分钟
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (s2) => {
      // 注意：SDK 方法都是 async，必须 await，否则拿到 "[object Promise]"
      const cq = String((await s2.getMsg()) || "").trim();
      const parsed = gewe.parseRecordCq(cq);
      if (!parsed || !parsed.msgId || !parsed.xml) {
        await s2.reply("没识别到语音，请重新发送下载语音");
        return;
      }
      try {
        const url = await gewe.downloadVoiceFromCq(cq);
        const mode = String(cfg.output_mode || "url");
        if (mode === "record") return s2.reply(`[CQ:record,url=${url}]`);
        if (mode === "both") {
          await s2.reply(url);
          return s2.reply(`[CQ:record,url=${url}]`);
        }
        return s2.reply(url);
      } catch (_) {
        await s2.reply("语音下载失败，请重试");
      }
    },
  });

  // 超时或监听中断
  if (!result) {
    await s.reply(String(cfg.timeout_tip || "等待超时，请重新发送下载语音"));
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`语音下载异常：${String(error?.message || error).slice(0, 80)}`);
  } catch (_) {}
});

// [title: 图片下载]
// [name: imageDownload]
// [desc: 仅 Gewe 平台可用。发"下载图片/下载原图/看看这张图"后提示在一分钟内发送图片，收到图片即调 downloadCdn 下载并把图片 URL/图片发回。]
// [author: Mianpro官方]
// [version: v1.1.1]
// [rule: ^(下载图片|下载原图|看看这张图|图片下载)$]
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
  image_type: plugin.Form.number()
    .title("下载类型")
    .description("1=高清图片 2=常规图片（默认） 3=缩略图")
    .min(1)
    .max(3)
    .default(2),
  output_mode: plugin.Form.string()
    .title("回复方式")
    .description("image=发图片 url=回文字URL both=图片+URL")
    .default("image"),
  wait_tip: plugin.Form.string()
    .title("等待提示")
    .description("发出触发词后提示用户发图的文案")
    .default("请在一分钟内发送图片"),
  timeout_tip: plugin.Form.string()
    .title("超时提示")
    .description("一分钟后没收到图片时的文案")
    .default("等待超时，请重新发送下载图片"),
});

async function main() {
  const cfg = (await form.get()) || {};
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const raw = String((await s.getMsg()) || "").trim();

  // 精确触发词（rule 已限定，此处兜底）
  if (!/^(下载图片|下载原图|看看这张图|图片下载)$/.test(raw)) return;
  // 仅 Gewe 平台可用（扩展 CQ 码只有 Gewe 适配器输出）
  if (platform !== "gewe") return s.reply("该功能仅 Gewe 平台可用");

  await s.reply(String(cfg.wait_tip || "请在一分钟内发送图片"));

  const result = await s.listen({
    rules: ["raw ^\\[CQ:image[^\\]]*\\]$"],
    timeout: 60000, // 一分钟
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (s2) => {
      const cq = String((await s2.getMsg()) || "").trim();
      const parsed = gewe.parseImageCq(cq);
      if (!parsed || !parsed.fileId) {
        await s2.reply("没识别到图片，请重新发送下载图片");
        return;
      }
      try {
        const url = await gewe.downloadCdn({
          fileId: parsed.fileId,
          aesKey: String(parsed.aesKey || ""),
          size: String(parsed.size || ""),
          suffix: String(parsed.suffix || ""),
          type: Number(cfg.image_type) || 2,
        });
        const mode = String(cfg.output_mode || "image");
        if (mode === "url") return s2.reply(url);
        if (mode === "both") {
          await s2.reply(url);
          return s2.reply(`[CQ:image,url=${url}]`);
        }
        return s2.reply(`[CQ:image,url=${url}]`);
      } catch (_) {
        await s2.reply("图片下载失败，请重试");
      }
    },
  });

  // 超时或监听中断
  if (!result) {
    await s.reply(String(cfg.timeout_tip || "等待超时，请重新发送下载图片"));
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`图片下载异常：${String(error?.message || error).slice(0, 80)}`);
  } catch (_) {}
});

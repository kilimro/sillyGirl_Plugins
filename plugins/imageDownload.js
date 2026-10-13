// [title: 图片下载]
// [name: imageDownload]
// [desc: 仅 Gewe 平台可用。收到图片消息时只记录不下载（按需下载防打爆接口），发"下载图片/下载原图/看看这张图"时调 downloadCdn 下载最近一张图片并回复（可发图/回URL/都发）。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 工具]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, Bucket, plugin } = require("sillygirl");
const gewe = require("./geweCore.js");

const BUCKET = "gewe_img_download"; // 记录各会话最近一张图片的 CQ 参数

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
  no_img_tip: plugin.Form.string()
    .title("无图片提示")
    .description("没有最近图片时回复的话")
    .default("没找到最近的图片，先发一张图给我吧"),
});

async function main() {
  const cfg = (await form.get()) || {};
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  // 仅 Gewe 平台生效（扩展 CQ 码只有 Gewe 适配器会输出）
  if (platform !== "gewe") return s.resume();

  const raw = String((await s.getMsg()) || "").trim();
  const chatId = String((await s.getChatId()) || "").trim();
  const bucket = new Bucket(BUCKET);
  const key = `gewe:${chatId || "default"}`;

  // 1. 收到图片消息：只记录不下载，继续交给其他插件处理
  if (raw.includes("[CQ:image,")) {
    const parsed = gewe.parseImageCq(raw);
    if (parsed && parsed.fileId) {
      await bucket.set(key, { time: Date.now(), ...parsed });
    }
    return s.resume();
  }

  // 2. 触发词：下载最近一张图片
  if (!/^(下载图片|下载原图|看看这张图|图片下载)$/.test(raw)) return s.resume();

  const rec = await bucket.get(key);
  if (!rec || !rec.fileId) {
    return s.reply(String(cfg.no_img_tip || "没找到最近的图片，先发一张图给我吧"));
  }

  let url = "";
  try {
    url = await gewe.downloadCdn({
      fileId: rec.fileId,
      aesKey: String(rec.aesKey || ""),
      size: String(rec.size || ""),
      suffix: String(rec.suffix || ""),
      type: Number(cfg.image_type) || 2,
    });
  } catch (_) {
    return s.reply("图片下载失败，请重试");
  }

  const mode = String(cfg.output_mode || "image");
  if (mode === "url") return s.reply(url);
  if (mode === "both") {
    await s.reply(url);
    return s.reply(`[CQ:image,url=${url}]`);
  }
  return s.reply(`[CQ:image,url=${url}]`);
}

main().catch(async (error) => {
  try {
    await s.reply(`图片下载异常：${String(error?.message || error).slice(0, 80)}`);
  } catch (_) {}
});

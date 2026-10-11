// [title: 表情包生成]
// [name: meme]
// [desc: 发"摸头""亲亲""抱抱"等关键词生成沙雕表情包（仅 Gewe 平台，因为只有 Gewe 能取用户头像）。支持 @某人 用对方头像（如"摸头 @小明"），需两张图的表情自动用发送者+被@者，无需头像的文字类表情（如"举牌 xxx"）直接生成。也支持"表情 关键词"搜索与"表情列表"。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: ^(摸头|摸摸|摸|摸头杀|亲亲|亲|抱抱|抱|贴贴|看扁|踩|顶|锤|捶|拍|搓|打|吃|扔|丢|出警|嘲讽|taunt|praise|wave|hug|kiss|step_on|dont_touch|dont_press|shutup|bad_news|hold_tight|hug_leg|thump|twist|head_butt|punch|flick|police|eat|throw|一直|永远|结婚|离婚|抱大腿)(?=\s|@|$)[\s\S]*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js","./memeCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const geweCore = require("./geweCore.js");
const memeCore = require("./memeCore.js");

const form = new plugin.Form({
  meme_api: plugin.Form.string()
    .title("表情服务 API 地址")
    .description("meme-generator HTTP 服务地址，如 https://emoji.iotty.cn")
    .default("")
    .required(),
  image_url_base: plugin.Form.string()
    .title("图片 URL 前缀")
    .description("生成图片的公网 URL 前缀，留空则用 API 地址拼接 /image/")
    .default(""),
});

// 高频表情触发词表（key 已经 API 验证存在）
const TRIGGER_MAP = {
  摸头: "petpet",
  摸摸: "petpet",
  摸: "petpet",
  摸头杀: "petpet",
  rua: "petpet",
  亲亲: "kiss",
  亲: "kiss",
  抱抱: "hug",
  抱: "hug",
  贴贴: "hug",
  抱大腿: "hug_leg",
  看扁: "look_flat",
  踩: "step_on",
  顶: "head_butt",
  锤: "hammer",
  捶: "thump",
  拍: "slap",
  搓: "twist",
  打: "punch",
  吃: "eat",
  扔: "throw",
  丢: "throw",
  出警: "police",
  嘲讽: "taunt",
  一直: "always",
  永远: "always",
  结婚: "marriage",
  离婚: "divorce",
  praise: "praise",
  wave: "wave",
  hug: "hug",
  kiss: "kiss",
  step_on: "step_on",
  dont_touch: "dont_touch",
  dont_press: "dont_press",
  shutup: "shutup",
  bad_news: "bad_news",
  hold_tight: "hold_tight",
  taunt: "taunt",
  thump: "thump",
  twist: "twist",
  head_butt: "head_butt",
  punch: "punch",
  flick: "flick",
  police: "police",
  eat: "eat",
  throw: "throw",
};

// 解析消息里的 @昵称（Gewe 纯文本格式），兼容 yyw 的 @昵称[YW.emoji,id=xxx]
function parseAt(raw) {
  const m = String(raw || "").match(/@([^\s@\[\]]+)/);
  if (!m) return { nick: "", rest: String(raw || "") };
  const nick = m[1].trim();
  const rest = String(raw || "")
    .replace(/@[^\s@\[\]]+\s*(\[YW\.emoji[^\]]*\])?\s*/, "")
    .trim();
  return { nick, rest };
}

// 前缀匹配触发词（长词优先），返回 { word, key }
function matchTrigger(raw) {
  const words = Object.keys(TRIGGER_MAP).sort((a, b) => b.length - a.length);
  for (const w of words) {
    if (raw.startsWith(w)) {
      const after = raw.slice(w.length);
      if (!after || /^[\s@]/.test(after)) {
        return { word: w, key: TRIGGER_MAP[w] };
      }
    }
  }
  return null;
}

let cfg = {};
async function main() {
  cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();
  if (!raw) return;

  // 命令分支
  if (raw === "表情列表" || raw === "表情") return handleList();
  const searchMatch = raw.match(/^表情\s+([\s\S]+)$/);
  if (searchMatch) return handleSearch(searchMatch[1].trim());

  // 触发词分支
  const hit = matchTrigger(raw);
  if (!hit) return;

  const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
  if (!toWxid) return;

  const { nick, rest } = parseAt(raw.slice(hit.word.length));
  await handleMeme(hit.key, toWxid, hit.word, nick, rest);
}

async function handleMeme(key, toWxid, triggerWord, atNick, text) {
  const api = String(cfg.meme_api || "").trim();
  if (!api) return s.reply("请先在插件配置里填写表情服务 API 地址");
  const urlBase = String(cfg.image_url_base || "").trim() || api;

  try {
    const info = await memeCore.getInfo(api, key);
    if (!info) return s.reply(`表情 ${key} 不存在`);
    const params = info.params || {};
    const maxImages = Number(params.max_images) || 0;
    const minTexts = Number(params.min_texts) || 0;

    // 文字：需要文字时提示发送者重新发送（带文字）
    let texts = [];
    if (minTexts > 0) {
      texts = text ? [text] : [];
      if (texts.length < minTexts) {
        const need = minTexts - texts.length;
        return s.reply(`这个表情需要 ${need} 条文字，请重新发送，如：${triggerWord}${atNick ? " @" + atNick : ""} ${text || "文字内容"}`);
      }
    }

    // 组装图片：按表情需要的数量取头像
    // 0 图（举牌/文字类）不需要头像；1 图用发送者；2 图用发送者+被@者
    const senderId = String((await s.getUserId()) || "").trim();
    let heads = [];
    if (maxImages >= 2) {
      if (!atNick) return s.reply("这个表情需要 @ 一个人（如：摸头 @小明）");
      const atInfo = await geweCore.searchContact(atNick);
      const atHead = (atInfo && atInfo.bigHeadImgUrl) || "";
      if (!atHead) return s.reply(`找不到 ${atNick}，请确认他/她是你的好友`);
      const senderInfo = senderId ? await geweCore.getBriefInfo([senderId]) : [];
      const senderHead = (senderInfo[0] && senderInfo[0].bigHeadImgUrl) || "";
      heads = [senderHead, atHead];
    } else if (maxImages >= 1) {
      const senderInfo = senderId ? await geweCore.getBriefInfo([senderId]) : [];
      const senderHead = (senderInfo[0] && senderInfo[0].bigHeadImgUrl) || "";
      heads = [senderHead];
    }

    // 下载头像 -> base64 -> 上传
    const images = [];
    for (let i = 0; i < heads.length; i++) {
      const head = heads[i];
      if (!head) return s.reply(i === 0 ? "无法获取你的头像" : "无法获取对方头像");
      const b64 = await downloadToBase64(head);
      if (!b64) return s.reply(i === 0 ? "头像下载失败" : "对方头像下载失败");
      const imageId = await memeCore.uploadByData(api, b64);
      images.push({ name: i === 0 ? "sender" : "target", id: imageId });
    }

    // 生成表情
    const genId = await memeCore.generate(api, key, images, texts, {});
    const imgUrl = memeCore.imageUrl(urlBase, genId);
    await geweCore.sendImage({ toWxid, imgUrl });
  } catch (error) {
    await s.reply(`表情生成失败：${String(error?.message || error).slice(0, 120)}`);
  }
}

async function handleSearch(query) {
  const api = String(cfg.meme_api || "").trim();
  if (!api) return s.reply("请先在插件配置里填写表情服务 API 地址");
  try {
    const keys = await memeCore.search(api, query);
    if (!keys.length) return s.reply(`没有找到与"${query}"相关的表情`);
    if (keys.length === 1) {
      const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
      return handleMeme(keys[0], toWxid, "表情", "", "");
    }
    const shown = keys.slice(0, 10).map((k) => `表情 ${k}`).join("\n");
    await s.reply(`找到 ${keys.length} 个表情，发送"表情 xxx"使用：\n${shown}`);
  } catch (error) {
    await s.reply(`表情搜索失败：${String(error?.message || error).slice(0, 120)}`);
  }
}

async function handleList() {
  const api = String(cfg.meme_api || "").trim();
  if (!api) return s.reply("请先在插件配置里填写表情服务 API 地址");
  try {
    const infos = await memeCore.getInfos(api);
    if (!infos.length) return s.reply("表情列表为空");
    const lines = infos
      .filter((i) => i.keywords && i.keywords.length)
      .slice(0, 30)
      .map((i) => `${i.key}（${i.keywords.slice(0, 3).join("/")}）`);
    await s.reply(`共 ${infos.length} 个表情，常用示例：\n${lines.join("\n")}\n\n发送"表情 关键词"搜索更多`);
  } catch (error) {
    await s.reply(`表情列表获取失败：${String(error?.message || error).slice(0, 120)}`);
  }
}

// 下载图片转 base64（去掉 data: 前缀）
async function downloadToBase64(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch (_) {
    return "";
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`表情包异常：${String(error?.message || error).slice(0, 120)}`);
  } catch (_) {}
});

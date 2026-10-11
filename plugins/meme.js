// [title: 表情包生成]
// [name: meme]
// [desc: 发"摸头""踩""嘲讽"等关键词生成沙雕表情包（仅 Gewe 平台，用发送者头像生成，无需 @ 他人、无需文字）。已屏蔽需要多人或需要文字的表情。支持"表情 关键词"搜索与"表情列表"。]
// [author: Mianpro官方]
// [version: v1.2.0]
// [rule: ^(表情|摸头|摸摸|摸|摸头杀|rua|踩|顶|锤|捶|拍|搓|打|打拳|吃|扔|丢|嘲讽|一直|永远|结婚|离婚|抱大腿|抱紧|别碰|高血压|狗都不玩|鼓掌|关注|滚|红温|后空翻|加班|打工人|继续干活|精神支柱|支持|木鱼|拿捏|捏|捏脸|挠头|上香|手枪|跳|跳舞|完美|迷惑|满脑子|米哈游|垃圾|科目三|快逃|爬|敲|推车|听音乐|舔屏|舔糖|踢球|世界第一可爱|让我进去|闪瞎|万花筒|土豆|奶茶|卖掉了|波奇手稿|安全感|阿尼亚喜欢|白子舔|盯着你|对称|防诱拐|风车转|谷歌验证码|哈哈镜|合成大干员|恍惚|晃脑|灰飞烟灭|回旋转|旋风转|加载中|戒导|杰瑞盯|紧贴|禁止|警察|啾啾|卡比锤|咖波蹭|咖波贴|咖波炖|咖波画|咖波撕|咖波指|咖波撞|凯露指|可莉吃|恐龙|小恐龙|凉宫春日举|洛天依要|旅行伙伴加入|旅行伙伴觉醒|膜拜|膜|拿捏|戏弄|纳西妲啃|草神啃|你不懂啦|你的跨年|怒撕|抛|掷|普拉娜吃|普拉娜舔|墙纸|球面旋转|泉此方看|群青|三维旋转|上香|手枪|双手抓|撕衣服|唐可可举牌|汤姆嘲笑|添乱|舔棒棒糖|跳舞|火柴人跳舞|听音乐|土豆|推车|万花筒|万花镜|完美|wave|always|step_on|dont_touch|hold_tight|hug_leg|thump|twist|head_butt|punch|flick|eat|throw|taunt|marriage|divorce|pat|hammer)[\s\S]*$]
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

// 高频表情触发词表（key 已经 API 验证存在，且均为"1图无文字"可用表情）
const TRIGGER_MAP = {
  摸头: "petpet",
  摸摸: "petpet",
  摸: "petpet",
  摸头杀: "petpet",
  rua: "petpet",
  踩: "step_on",
  顶: "head_butt",
  锤: "hammer",
  捶: "thump",
  拍: "pat",
  搓: "twist",
  打: "punch",
  打拳: "punch",
  吃: "eat",
  扔: "throw",
  丢: "throw",
  嘲讽: "taunt",
  一直: "always",
  永远: "always",
  结婚: "marriage",
  离婚: "divorce",
  抱大腿: "hug_leg",
  抱紧: "hold_tight",
  别碰: "dont_touch",
  高血压: "blood_pressure",
  狗都不玩: "dog_dislike",
  鼓掌: "applaud",
  关注: "follow",
  滚: "roll",
  红温: "flush",
  后空翻: "backflip",
  加班: "overtime",
  打工人: "back_to_work",
  继续干活: "back_to_work",
  精神支柱: "support",
  支持: "support",
  木鱼: "wooden_fish",
  拿捏: "tease",
  捏: "pinch",
  捏脸: "pinch",
  挠头: "scratch_head",
  上香: "mourning",
  手枪: "gun",
  跳: "jump",
  跳舞: "stickman_dancing",
  火柴人跳舞: "stickman_dancing",
  完美: "perfect",
  迷惑: "confuse",
  满脑子: "fill_head",
  米哈游: "mihoyo",
  垃圾: "garbage",
  垃圾桶: "garbage",
  科目三: "subject3",
  快逃: "run_away",
  爬: "crawl",
  敲: "knock",
  推车: "trolley",
  听音乐: "listen_music",
  舔屏: "prpr",
  舔糖: "lick_candy",
  舔棒棒糖: "lick_candy",
  踢球: "kick_ball",
  世界第一可爱: "sekaiichi_kawaii",
  让我进去: "let_me_in",
  闪瞎: "flash_blind",
  万花筒: "kaleidoscope",
  万花镜: "kaleidoscope",
  土豆: "potato",
  奶茶: "bubble_tea",
  卖掉了: "sold_out",
  波奇手稿: "bocchi_draft",
  安全感: "safe_sense",
  阿尼亚喜欢: "anya_suki",
  白子舔: "shiroko_pero",
  盯着你: "stare_at_you",
  对称: "symmetric",
  防诱拐: "anti_kidnap",
  风车转: "windmill_turn",
  谷歌验证码: "google_captcha",
  哈哈镜: "funny_mirror",
  合成大干员: "operator_generator",
  恍惚: "trance",
  晃脑: "shake_head",
  灰飞烟灭: "fade_away",
  回旋转: "swirl_turn",
  旋风转: "swirl_turn",
  加载中: "loading",
  戒导: "abstinence",
  杰瑞盯: "jerry_stare",
  紧贴: "tightly",
  紧紧贴着: "tightly",
  禁止: "forbid",
  警察: "policeman",
  啾啾: "jiujiu",
  卡比锤: "kirby_hammer",
  卡比重锤: "kirby_hammer",
  咖波蹭: "capoo_rub",
  咖波贴: "capoo_rub",
  咖波炖: "capoo_stew",
  咖波画: "capoo_draw",
  咖波撕: "capoo_rip",
  咖波指: "capoo_point",
  咖波撞: "capoo_strike",
  咖波头槌: "capoo_strike",
  凯露指: "karyl_point",
  可莉吃: "klee_eat",
  恐龙: "dinosaur",
  小恐龙: "dinosaur",
  凉宫春日举: "haruhi_raise",
  洛天依要: "luotianyi_need",
  天依要: "luotianyi_need",
  旅行伙伴加入: "maimai_join",
  旅行伙伴觉醒: "maimai_awaken",
  膜拜: "worship",
  膜: "worship",
  戏弄: "tease",
  纳西妲啃: "nahida_bite",
  草神啃: "nahida_bite",
  你不懂啦: "you_dont_get",
  你的跨年: "your_new_years_eve",
  怒撕: "rip_angrily",
  抛: "throw_gif",
  掷: "throw_gif",
  普拉娜吃: "plana_eat",
  普拉娜舔: "plana_eat",
  墙纸: "wallpaper",
  球面旋转: "sphere_rotate",
  泉此方看: "konata_watch",
  群青: "cyan",
  三维旋转: "rotate_3d",
  双手抓: "grab_both_hands",
  撕衣服: "rip_clothes",
  唐可可举牌: "tankuku_raisesign",
  汤姆嘲笑: "tom_tease",
  添乱: "add_chaos",
  给社会添乱: "add_chaos",
  wave: "wave",
  always: "always",
  step_on: "step_on",
  dont_touch: "dont_touch",
  hold_tight: "hold_tight",
  hug_leg: "hug_leg",
  thump: "thump",
  twist: "twist",
  head_butt: "head_butt",
  punch: "punch",
  flick: "flick",
  eat: "eat",
  throw: "throw",
  taunt: "taunt",
  marriage: "marriage",
  divorce: "divorce",
  pat: "pat",
  hammer: "hammer",
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
  // 仅 Gewe 平台使用（其他平台无法获取用户头像，直接放行给其他插件）
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  if (platform !== "gewe") return s.resume();

  const raw = String((await s.getMsg()) || "").trim();
  if (!raw) return;

  // 命令分支
  if (raw === "表情列表" || raw === "表情") return handleList();
  const searchMatch = raw.match(/^表情\s+([\s\S]+)$/);
  if (searchMatch) return handleSearch(searchMatch[1].trim());

  // 触发词分支（规则是粗筛，这里精确校验，不中则放行给其他插件）
  const hit = matchTrigger(raw);
  if (!hit) return s.resume();

  const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
  if (!toWxid) return;

  const { nick, rest } = parseAt(raw.slice(hit.word.length));
  await handleMeme(hit.key, toWxid, nick, rest);
}

async function handleMeme(key, toWxid, atNick, text) {
  const api = String(cfg.meme_api || "").trim();
  if (!api) return s.reply("请先在插件配置里填写表情服务 API 地址");
  const urlBase = String(cfg.image_url_base || "").trim() || api;

  try {
    const info = await memeCore.getInfo(api, key);
    if (!info) return s.reply(`表情 ${key} 不存在`);
    const params = info.params || {};
    const maxImages = Number(params.max_images) || 0;
    const minTexts = Number(params.min_texts) || 0;

    // 屏蔽需要多人的表情（取不到对方头像）
    if (maxImages >= 2) return s.reply(`表情 ${key} 需要多张图，暂不支持`);
    // 屏蔽需要文字的表情（当前不支持文字输入）
    if (minTexts > 0) return s.reply(`表情 ${key} 需要文字，暂不支持`);

    // 只用发送者头像生成
    const senderId = String((await s.getUserId()) || "").trim();
    const senderInfo = senderId ? await geweCore.getBriefInfo([senderId]) : [];
    const senderHead = (senderInfo[0] && senderInfo[0].bigHeadImgUrl) || "";
    if (!senderHead) return s.reply("无法获取你的头像");

    // 下载头像 -> base64 -> 上传
    const b64 = await downloadToBase64(senderHead);
    if (!b64) return s.reply("头像下载失败");
    const imageId = await memeCore.uploadByData(api, b64);

    // 生成表情
    const genId = await memeCore.generate(api, key, [{ name: "sender", id: imageId }], [], {});
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
    // 过滤：只保留 1图无文字 的可用表情
    const usable = [];
    for (const k of keys) {
      const info = await memeCore.getInfo(api, k);
      if (!info) continue;
      const p = info.params || {};
      if ((Number(p.max_images) || 0) <= 1 && (Number(p.min_texts) || 0) === 0) {
        usable.push(k);
      }
      if (usable.length >= 5) break;
    }
    if (!usable.length) return s.reply(`"${query}"相关的表情都需要多人或文字，暂不支持`);
    if (usable.length === 1) {
      const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
      return handleMeme(usable[0], toWxid, "", "");
    }
    const shown = usable.slice(0, 5).map((k) => `表情 ${k}`).join("\n");
    await s.reply(`找到可用表情，发送"表情 xxx"使用：\n${shown}`);
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
    // 过滤：只保留 1图无文字 的可用表情，优先展示带中文关键词的
    const usable = infos.filter((i) => {
      const p = i.params || {};
      return (Number(p.max_images) || 0) <= 1 && (Number(p.min_texts) || 0) === 0;
    });
    const lines = usable
      .filter((i) => i.keywords && i.keywords.length)
      .slice(0, 30)
      .map((i) => `${i.key}（${i.keywords.slice(0, 3).join("/")}）`);
    await s.reply(`共 ${usable.length} 个可用表情，常用示例：\n${lines.join("\n")}\n\n发送"表情 关键词"搜索更多`);
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

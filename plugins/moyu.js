// [title: 摸鱼日报]
// [name: moyu]
// [desc: 发"摸鱼"打卡，每天可摸鱼次数可配置（默认3次），每次成功累计摸鱼天数，调用绘图接口生成摸鱼日报图片回复。Gewe 平台用真实头像，其他平台用默认头像。]
// [author: Mianpro官方]
// [version: v1.1.0]
// [rule: ^摸鱼$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, Bucket, plugin } = require("sillygirl");
const geweCore = require("./geweCore.js");

const CHECK_BUCKET = "moyu_check"; // 一天一次去重
const DAYS_BUCKET = "moyu_days"; // 摸鱼天数累计

const form = new plugin.Form({
  api_url: plugin.Form.string()
    .title("摸鱼绘图接口")
    .description("PHP 绘图接口地址，如 https://你的域名/API/my/moyu.php")
    .default("")
    .required(),
  default_avatar: plugin.Form.string()
    .title("默认头像 URL")
    .description("拿不到头像时使用的默认头像（公网图片 URL，留空则不带头像）")
    .default(""),
  repeat_tip: plugin.Form.string()
    .title("次数用完提示")
    .description("当天摸鱼次数用完时回复的话")
    .default("今天已经摸过鱼啦，老板都要被你摸秃噜皮了"),
  daily_limit: plugin.Form.number()
    .title("每天可摸鱼次数")
    .description("一天最多可摸鱼几次，超过则提示次数用完")
    .min(1)
    .max(99)
    .default(3),
});

// Gewe 平台：从简要信息接口拿真实昵称和头像
async function getNickAndAvatar(platform, userId) {
  if (platform !== "gewe") return { nickname: null, avatar: null };
  try {
    const info = await geweCore.getBriefInfo([userId]);
    if (Array.isArray(info) && info[0]) {
      const it = info[0];
      return {
        nickname: String(it.nickName || it.userName || "").trim() || null,
        avatar: String(it.bigHeadImgUrl || "").trim() || null,
      };
    }
  } catch (_) {}
  // 兜底：搜索联系人
  try {
    const found = await geweCore.searchContact(userId);
    if (found) {
      return {
        nickname: String(found.nickName || "").trim() || null,
        avatar: String(found.bigHeadImgUrl || "").trim() || null,
      };
    }
  } catch (_) {}
  return { nickname: null, avatar: null };
}

async function main() {
  const cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();
  if (!/^摸鱼$/.test(raw)) return;

  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const userId = String((await s.getUserId()) || "").trim();
  if (!userId) return s.reply("获取用户信息失败，请稍后再试");

  // 当天日期（服务器本地时区）
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const key = `${platform}:${userId}`;

  // ---- 每天次数限制（存 日期 + 当日已摸次数）----
  const dailyLimit = Number(cfg.daily_limit) || 3;
  const checkBucket = new Bucket(CHECK_BUCKET);
  const record = await checkBucket.get(key);
  const isNewDay = !record || record.date !== dateStr;
  const todayCount = isNewDay ? 0 : Number(record.count) || 0;
  if (todayCount >= dailyLimit) {
    return s.reply(String(cfg.repeat_tip || "今天已经摸过鱼啦，老板都要被你摸秃噜皮了"));
  }

  // ---- 摸鱼天数 +1（每次成功摸鱼累计一次）----
  const daysBucket = new Bucket(DAYS_BUCKET);
  const curDays = Number(await daysBucket.get(key)) || 0;
  const newDays = curDays + 1;

  // ---- 昵称 / 头像 ----
  const fallbackNick = String((await s.getUserName()) || "").trim();
  const info = await getNickAndAvatar(platform, userId);
  const nickname = encodeURIComponent(String(info.nickname || fallbackNick || "神秘摸鱼人"));
  const avatar = String(info.avatar || cfg.default_avatar || "").trim();

  // ---- 请求绘图接口 ----
  const api = String(cfg.api_url || "").trim();
  if (!api) return s.reply("未配置摸鱼绘图接口（api_url）");

  const sep = api.includes("?") ? "&" : "?";
  const target = `${api}${sep}nickname=${nickname}&days=${newDays}${
    avatar ? "&avatar=" + encodeURIComponent(avatar) : ""
  }`;

  let data = null;
  try {
    const res = await fetch(target, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        return s.reply("摸鱼接口返回异常，请稍后再试");
      }
    }
  } catch (error) {
    return s.reply("摸鱼接口请求失败，请稍后再试");
  }

  if (!data || data.code !== 200 || !data.url) {
    return s.reply(String(data?.msg || "摸鱼生成失败，请稍后再试"));
  }

  // ---- 接口成功才记录（失败可重试，不消耗次数）----
  await daysBucket.set(key, newDays);
  await checkBucket.set(key, { date: dateStr, count: todayCount + 1 });

  // 全平台通用 CQ 发图
  await s.reply(`[CQ:image,url=${data.url}]`);
}

main().catch(async (error) => {
  try {
    await s.reply(`摸鱼异常：${String(error?.message || error).slice(0, 80)}`);
  } catch (_) {}
});

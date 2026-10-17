// [title: 撸管日记]
// [name: deerDiary]
// [desc: 发「已撸」打卡（不限次数，当日次数累加），调用 deer_calendar PHP 服务渲染打卡日历图并下发。支持月历（默认）/年历/月报/年报/生涯/排行六种图：已撸=打卡+本月日历；已撸 月报/年报/年历/生涯=打卡+对应图；已撸 排行=当月排行榜（不打卡）；已撸 菜单=查看使用说明。打卡走 index.php 的 type=checkin 写入接口。uid 用平台用户 ID 区分数据，群聊+私聊都生效。]
// [author: Mianpro官方]
// [version: v1.0.6]
// [rule: ^已撸[，,、:：\s]*(.*)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 990]
// [class: 生活]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const geweCore = require("./geweCore.js");

const DEFAULT_BASE = "https://ceshi.920pdd.com/wx/deer_calendar_php/public/";

// 子命令 → 图类型（无参数默认本月日历）
const TYPE_MAP = {
  月历: "month_calendar",
  本月: "month_calendar",
  日历: "month_calendar",
  年历: "year_calendar",
  全年: "year_calendar",
  年度: "year_calendar",
  月报: "month_report",
  年报: "year_report",
  生涯: "career",
  排行: "ranking",
  排行榜: "ranking",
};

const form = new plugin.Form({
  api_base: plugin.Form.string()
    .title("API 服务地址")
    .description("deer_calendar PHP 服务地址（结尾带/），默认：https://ceshi.920pdd.com/wx/deer_calendar_php/public/")
    .default("https://ceshi.920pdd.com/wx/deer_calendar_php/public/"),
  api_token: plugin.Form.string()
    .title("打卡接口 Token")
    .description("index.php 里 CHECKIN_TOKEN 配置了才填，留空则不传"),
  enable_private: plugin.Form.boolean().title("私聊生效").default(true),
  enable_group: plugin.Form.boolean().title("群聊生效").default(true),
});

let cfg = {};

async function getNickname() {
  // Gewe：适配器拿不到对方昵称（getUserName 返回的是 ID 串），改从简要信息接口取备注/昵称
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  if (platform === "gewe") {
    const userId = String((await s.getUserId()) || "").trim();
    if (userId) {
      try {
        const list = await geweCore.getBriefInfo([userId]);
        const info = Array.isArray(list) && list[0];
        if (info) {
          const remark = String(info.remark || "").trim();
          const nick = String(info.nickName || "").trim();
          if (remark) return remark;
          if (nick) return nick;
        }
      } catch (_) {
        // 接口失败则回退到默认取值
      }
    }
  }
  // 官方 API：s.getEvent() 返回事件对象，yyw 等适配器通过 user_name(FinalFromName) 传入用户昵称
  try {
    if (typeof s.getEvent === "function") {
      const ev = (await s.getEvent()) || {};
      const n = String(
        ev.user_name || ev.UserName || ev.final_from_name || ev.FinalFromName || ev.from_name || ev.FromName || ev.nickname || ""
      ).trim();
      if (n) return n;
    }
  } catch (_) {}
  // 兜底：getUserName 返回昵称才用（过滤 wxid 这类 ID 串）
  try {
    if (typeof s.getUserName === "function") {
      const n = String(await s.getUserName() || "").trim();
      if (n && !/^wxid/i.test(n)) return n;
    }
  } catch (_) {}
  return "";
}

function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("请求超时");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();
  if (!raw) return;

  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const userId = String((await s.getUserId()) || "").trim();
  const chatId = String((await s.getChatId()) || "").trim();
  if (!userId) return;
  const isPrivate = !chatId || String(chatId) === String(userId);
  // 配置未保存（undefined）时默认放行，避免新装插件静默吞消息
  const enablePrivate = cfg.enable_private === undefined ? true : !!cfg.enable_private;
  const enableGroup = cfg.enable_group === undefined ? true : !!cfg.enable_group;
  if (isPrivate && !enablePrivate) return;
  if (!isPrivate && !enableGroup) return;

  const rest = raw.replace(/^已撸[，,、:：\s]*/, "").trim();

  // 「已撸 菜单」：纯文字使用说明，不打卡不渲染
  if (rest === "菜单") {
    await s.reply(
      "已撸使用菜单：\n" +
        "已撸 - 打卡1次，并发送本月日历\n" +
        "已撸 月报 - 打卡，并发送本月月报\n" +
        "已撸 年历 - 打卡，并发送全年日历\n" +
        "已撸 年报 - 打卡，并发送年度统计\n" +
        "已撸 生涯 - 打卡，并发送累计生涯图\n" +
        "已撸 排行 - 发送当月排行榜（不打卡）"
    );
    return;
  }

  const type = TYPE_MAP[rest] || "month_calendar";
  const needCheckin = type !== "ranking"; // 排行是查询当月全员数据，不打卡

  const base = (String(cfg.api_base || "").trim() || DEFAULT_BASE).replace(/\/+$/, "") + "/";
  const nickname = (await getNickname()) || userId;

  try {
    const today = todayStr();
    // 1. 打卡（追加当日次数，不限次数；走 index.php 的 type=checkin）
    if (needCheckin) {
      let checkinUrl = `${base}?type=checkin&uid=${encodeURIComponent(userId)}&user=${encodeURIComponent(nickname)}&count=1&date=${today}`;
      const token = String(cfg.api_token || "").trim();
      if (token) checkinUrl += `&token=${encodeURIComponent(token)}`;
      const ck = await fetchJson(checkinUrl);
      if (!ck || ck.ok !== true) throw new Error((ck && ck.error) || "打卡失败");
    }

    // 2. 渲染图片，拿公网 URL（save=1&format=json，1 天有效）
    const params = new URLSearchParams();
    params.set("type", type);
    params.set("uid", userId);
    params.set("user", nickname);
    params.set("save", "1");
    params.set("format", "json");
    params.set("today", today);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (type === "ranking") {
      params.set("year", String(year));
      params.set("month", String(month));
      params.set("platform", platform === "gewe" ? "WX" : "QQ");
    } else if (type === "month_calendar" || type === "month_report") {
      params.set("year", String(year));
      params.set("month", String(month));
    } else if (type === "year_calendar" || type === "year_report") {
      params.set("year", String(year));
    }

    const img = await fetchJson(`${base}?${params.toString()}`);
    if (!img || img.ok !== true) throw new Error((img && img.error) || "生成图片失败");
    const imageUrl = String(img.image_url || "").trim();
    if (!imageUrl) throw new Error("未从返回中解析到图片地址");

    // 3. 发图：Gewe 走 sendImage，其他平台发 CQ 码
    if (platform === "gewe") {
      const toWxid = chatId || userId;
      await geweCore.sendImage({ toWxid, imgUrl: imageUrl });
    } else {
      await s.reply(`[CQ:image,url=${imageUrl}]`);
    }
  } catch (err) {
    await s.reply(`撸管日记异常：${String(err?.message || err).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`撸管日记异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

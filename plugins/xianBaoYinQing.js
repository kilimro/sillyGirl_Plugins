// [title: 线报引擎]
// [name: xianBaoYinQing]
// [desc: 定时采集小嘀咕羊毛线报，支持去重、关键词/用户黑名单、测试推送和开关管理]
// [author: funyhook]
// [version: v6.1.0]
// [rule: ^(羊毛线报测试|线报黑名单|线报授权查询|开启线报|关闭线报)$]
// [cron: */15 * * * * *]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 999999999]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [module: false]
// [carry: true]
// [origin: backup/线报引擎_v6_By.funyhook.txt]
// [depe: []]

const { Bucket, sender: s, plugin, utils } = require("sillygirl");

const cache = new Bucket("xianBaoYinQing.cache");
const state = new Bucket("xianBaoYinQing.state");
const DEFAULT_WORDS = [
  "互助",
  "垃圾袋",
  "炸年兽",
  "30-29",
  "农保底10新",
  "开钱包",
  "速度随时黄",
  "快快快",
  "10-88",
  "刚中快",
];
const DEFAULT_UIDS = [91819, 105359, 106295, 99459];
const form = new plugin.Form({
  enabled: plugin.Form.boolean().title("线报开关").default(true),
  push_groups: plugin.Form.string().title("推送群组").description("qq:123,wx:456,tg:789；留空时推送管理员").default(""),
  source_url: plugin.Form.string()
    .title("列表接口")
    .default(
      "https://app.xiaodigu.cn/mag/info/v2/channel/infoListByCatId?step=10&channel_id=52&uniqid=61c5dcf4edb4c&is_app_first=-1&cat_id=112&p=1",
    ),
  detail_url: plugin.Form.string()
    .title("详情接口")
    .default("https://app.xiaodigu.cn/mag/circle/v3/show/showView?content_id="),
  interval_ms: plugin.Form.integer().title("单条间隔毫秒").min(0).max(10000).default(2000),
  max_items: plugin.Form.integer().title("每轮最多处理条数").min(1).max(50).default(10),
});

const HEADERS = {
  connection: "keep-alive",
  "content-type": "application/json; charset=UTF-8",
  "x-canary": "client=iOS,app=adrive,version=v4.1.3",
  "user-agent":
    "AliApp(AYSD/4.1.3) com.alicloud.smartdrive/4.1.3 Version/16.3 Channel/201200 Language/zh-Hans-CN /iOS Mobile/iPhone15,2",
  accept: "*/*",
};

async function main() {
  const cfg = (await form.get()) || {};
  const content = String((await s.getMsg()) || "").trim();
  if (content) {
    if (!(await s.isAdmin())) return s.reply("仅管理员可用");
    if (content === "开启线报") {
      await state.set("enabled", "true");
      return s.reply("【线报引擎】已开启");
    }
    if (content === "关闭线报") {
      await state.set("enabled", "false");
      return s.reply("【线报引擎】已关闭");
    }
    if (content === "线报授权查询") return s.reply("线报引擎为本地迁移版，无远程授权限制");
    if (content === "羊毛线报测试") {
      await pushMessage(cfg, "羊毛线报测试");
      return s.reply("测试消息已发送");
    }
    if (content === "线报黑名单") return editBlacklist();
  }
  const override = await state.get("enabled", "");
  if (override === "false" || (override !== "true" && cfg.enabled === false)) return;
  return collect(cfg);
}

async function collect(cfg) {
  await expireCache();
  const response = await json(cfg.source_url, HEADERS);
  if (response?.success !== true || Number(response?.code) !== 100 || !Array.isArray(response?.list)) {
    throw new Error(response?.msg || response?.message || "线报列表接口返回异常");
  }
  const blackWords = await getWords();
  const blackUids = await getUids();
  let pushed = 0;
  for (const item of response.list.slice(0, Number(cfg.max_items) || 10)) {
    const id = String(item?.id || "");
    const uid = Number(item?.user?.id || 0);
    if (!id || blackUids.includes(uid) || (await cache.get(id, ""))) continue;
    await cache.set(id, String(Date.now()));
    if (cfg.interval_ms && pushed) await sleep(Number(cfg.interval_ms));
    const detail = await json(`${cfg.detail_url}${encodeURIComponent(id)}`, HEADERS);
    if (detail?.success !== true || Number(detail?.code) !== 100 || !detail?.show) continue;
    const message = formatItem(item, detail.show);
    if (!message || blackWords.some((word) => word && message.includes(word))) continue;
    await pushMessage(cfg, message);
    pushed++;
  }
  console.log(`线报引擎：本轮推送 ${pushed} 条`);
}

function formatItem(item, show) {
  const lines = [];
  const html = [];
  if (typeof show.content === "string") html.push(show.content);
  if (Array.isArray(show.content))
    for (const block of show.content) {
      if (block?.type === "text") html.push(String(block.content || ""));
      if (block?.type === "img")
        for (const image of block.list || []) if (image?.pic_url) lines.push(utils.image(image.pic_url));
    }
  if (show.rel_article_info?.title) html.push(show.rel_article_info.title);
  for (const value of html) {
    const text = value
      .replace(/<a[^>]*href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>/gi, "$2\n$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .trim();
    if (text) lines.unshift(clearNoisyUrl(text));
  }
  for (const pic of show.pics_arr || []) if (pic?.url) lines.push(utils.image(pic.url));
  if (!lines.length) return "";
  return `${formatTime(new Date())} ${item?.user?.id || "-"}-${item?.id || "-"}\n\n${lines.join("\n")}`;
}

async function editBlacklist() {
  let words = await getWords();
  await s.reply(
    [
      "=====线报引擎黑名单=====",
      ...words.map((word, index) => `${index + 1}. ${word}`),
      "回复：0 添加；-序号 删除；q 退出",
    ].join("\n"),
  );
  const first = await listen(120000);
  if (!first || /^q$/i.test(first)) return s.reply("已退出");
  if (/^-\d+$/.test(first)) {
    const index = Number(first.slice(1)) - 1;
    if (!words[index]) return s.reply("序号无效");
    const removed = words.splice(index, 1)[0];
    await state.set("black_words", JSON.stringify(words));
    return s.reply(`已删除黑名单关键词：${removed}`);
  }
  if (first === "0") {
    await s.reply("请输入黑名单关键词");
    const word = await listen(120000);
    if (!word) return s.reply("未收到关键词");
    if (!words.includes(word)) words.push(word);
    await state.set("black_words", JSON.stringify(words));
    return s.reply(`已添加黑名单关键词：${word}`);
  }
  return s.reply("输入无效");
}

async function pushMessage(cfg, content) {
  const targets = String(cfg.push_groups || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  if (!targets.length) return s.pushAdmin(content);
  let sent = 0;
  for (const target of targets) {
    const match = target.match(/^([^:]+):(.+)$/);
    if (!match) continue;
    try {
      const adapter = await s.getAdapter(match[1]);
      if (!adapter?.push) throw new Error("渠道没有 push 能力");
      await adapter.push({ group_id: match[2], chat_id: match[2], content });
      sent++;
    } catch (error) {
      console.log(`线报群推送失败 ${target}: ${error?.message || error}`);
    }
  }
  if (!sent) await s.pushAdmin(content);
}

async function expireCache() {
  const rows = await cache.getAll();
  const deadline = Date.now() - 2 * 86400000;
  for (const [key, raw] of Object.entries(rows || {})) {
    const value = Number(raw || 0);
    if (key && (!value || value < deadline)) await cache.delete(key);
  }
}

async function getWords() {
  return parseArray(await state.get("black_words", ""), DEFAULT_WORDS).map(String);
}
async function getUids() {
  return parseArray(await state.get("black_uids", ""), DEFAULT_UIDS).map(Number);
}
function parseArray(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : fallback.slice();
  } catch {
    return fallback.slice();
  }
}
async function listen(timeout) {
  const child = await s.listen({ timeout });
  return child ? String((await child.getMsg()) || "").trim() : "";
}
async function json(url, headers) {
  const response = await fetch(String(url), { headers, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口未返回 JSON：${text.slice(0, 160)}`);
  }
}
function clearNoisyUrl(text) {
  return /(?:…|item\.jd\.com| \.\.\. )/.test(text)
    ? text.replace(/(?:https?|ftp|file):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+/g, "")
    : text;
}
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => s.reply(`线报引擎执行失败：${String(error?.message || error).slice(0, 300)}`));

// [title: 积分卡密]
// [name: jiFenKaMi]
// [desc: 合并 Python 的卡密系统、充值插件、支付接管和收款助手，共用 dd_sign_points 等兼容数据桶]
// [author: sillyGirl]
// [version: v1.0.0]
// [rule: ^(签到|积分查询|查询积分|积分明细|充值积分|积分充值|充值|充币|我要充值|充余额|查余额|收款助手|绑定账号|查询到期|续费账号|卡密列表)$|^(DD_|R_|KMXT_).+$|^生成卡密\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?$|^调整积分\s+(\S+)\s+([+-]?\d+)$|^调整收款助手余额\s+(\S+)\s+([+-]?\d+(?:\.\d+)?)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/充值插件_v1.1.0_By.rujingxianghai.py;backup/卡密系统_v6.2_By.8165799.py;backup/支付接管_v1.0.4_By.yuhualhh.py;backup/收款助手_v4.0_By.zq8884.py;backup/积分卡密系统_v5.7_By.rujingxianghai.py;backup/充值_v1.0.4_By.hicong.txt]
// [depe: ["./vortoUtils.js"]]

const { randomBytes } = require("crypto");
const { Bucket, plugin, sender: s } = require("sillygirl");
const vorto = require("./vortoUtils");

const form = new plugin.Form({
  sign_enabled: plugin.Form.boolean().title("开启签到").default(true),
  sign_min: plugin.Form.integer().title("签到最少积分").min(1).default(1),
  sign_max: plugin.Form.integer().title("签到最多积分").min(1).default(5),
  day_fee: plugin.Form.number().title("每账号每日费用").min(0).default(0.1),
  wx_qr_url: plugin.Form.string().title("微信赞赏码 URL").default(""),
  recharge_scale: plugin.Form.integer().title("每元兑换余额").min(1).default(100),
});
const points = new Bucket("dd_sign_points");
const dates = new Bucket("dd_sign_date");
const cards = new Bucket("dd_sign_cards");
const logs = new Bucket("dd_sign_tx_log");
const payUsers = new Bucket("pay_users");

async function main() {
  try {
    const cfg = await form.get();
    const content = String((await s.getMsg()) || "").trim();
    const uid = await s.getUserId();
    if (content === "签到") return sign(uid, cfg);
    if (/^(积分查询|查询积分)$/.test(content)) return s.reply(`当前积分：${await balance(uid)}`);
    if (content === "积分明细") return showLogs(uid);
    if (content === "充余额") return rechargeLegacy(uid, cfg);
    if (content === "查余额") return queryLegacy(uid);
    if (/^(充值积分|积分充值|充值|充币|我要充值)$/.test(content)) return askCard(uid);
    if (/^(DD_|R_|KMXT_)/.test(content)) return redeem(uid, content);
    if (content === "卡密列表") return listCards();
    const create = content.match(/^生成卡密\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?$/);
    if (create) return createCards(Number(create[1]), Number(create[2] || 1), Number(create[3] || 0));
    const adjust = content.match(/^调整积分\s+(\S+)\s+([+-]?\d+)$/);
    if (adjust) return adjustPoints(adjust[1], Number(adjust[2]));
    const cash = content.match(/^调整收款助手余额\s+(\S+)\s+([+-]?\d+(?:\.\d+)?)$/);
    if (cash) return adjustCash(cash[1], Number(cash[2]));
    if (content === "绑定账号") return bindPins(uid);
    if (content === "查询到期") return showExpiry(uid);
    if (content === "续费账号") return renew(uid, cfg);
    if (content === "收款助手") return assistant(uid);
  } catch (error) {
    return s.reply(`积分卡密处理失败：${err(error)}`);
  }
}

async function sign(uid, cfg) {
  if (cfg.sign_enabled === false) return s.reply("签到功能未启用");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  if ((await dates.get(uid, "")) === today) return s.reply("今日已经签到过了");
  const min = Number(cfg.sign_min) || 1;
  const max = Math.max(min, Number(cfg.sign_max) || 5);
  const amount = min + Math.floor(Math.random() * (max - min + 1));
  await dates.set(uid, today);
  const now = await change(uid, amount, "签到");
  return s.reply(`签到成功：+${amount} 积分，当前 ${now}`);
}

async function askCard(uid) {
  await s.reply("请发送卡密，输入 q 取消。");
  return s.listen({
    rules: ["raw ^(\\S+)$"],
    timeout: 60000,
    user_id: uid,
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const code = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(code)) return "已取消";
      return redeem(uid, code, next);
    },
  });
}

async function redeem(uid, code, sender = s) {
  const raw = await cards.get(code, "");
  if (!raw) return sender.reply("卡密不存在");
  const card = parseJSON(raw);
  if (card.usedBy) return sender.reply("卡密已使用");
  if (card.expiresAt && Date.now() > card.expiresAt) return sender.reply("卡密已过期");
  const now = await change(uid, Number(card.amount), `卡密充值 ${code}`);
  await cards.set(code, JSON.stringify({ ...card, usedBy: uid, usedAt: Date.now() }));
  return sender.reply(`充值成功：+${card.amount} 积分，当前 ${now}`);
}

async function createCards(amount, count, days) {
  if (!(await s.isAdmin())) return s.reply("仅管理员可生成卡密");
  if (amount <= 0 || count < 1 || count > 100 || days < 0)
    return s.reply("参数错误：生成卡密 积分 [数量1-100] [有效天数]");
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const code = `DD_${randomBytes(8).toString("hex").toUpperCase()}`;
    await cards.set(
      code,
      JSON.stringify({ amount, createdAt: Date.now(), expiresAt: days ? Date.now() + days * 86400000 : 0, usedBy: "" }),
    );
    result.push(code);
  }
  return s.reply([`生成 ${count} 张，每张 ${amount} 积分`, ...result].join("\n"));
}

async function listCards() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可查看卡密");
  const all = await cards.getAll();
  const rows = Object.entries(all);
  const unused = rows.filter(([, raw]) => !parseJSON(raw).usedBy);
  return s.reply(
    [
      `卡密总数 ${rows.length}，未使用 ${unused.length}`,
      ...unused.slice(0, 50).map(([code, raw]) => `${code}：${parseJSON(raw).amount}积分`),
    ].join("\n"),
  );
}

async function adjustPoints(uid, amount) {
  if (!(await s.isAdmin())) return s.reply("仅管理员可调整积分");
  const now = await change(uid, amount, "管理员调整");
  return s.reply(`积分调整完成：${uid} ${amount >= 0 ? "+" : ""}${amount}，当前 ${now}`);
}

async function bindPins(uid) {
  const platform = String(await s.getPlatform()).toUpperCase();
  const source = await new Bucket(`pin${platform}`).getAll();
  const pins = Object.entries(source)
    .filter(([, value]) => String(value) === uid)
    .map(([pin]) => pin);
  if (!pins.length) return s.reply(`当前 ${platform} 用户未关联 JD 账号`);
  const key = `${platform}:${uid}`;
  const old = parseJSON(await payUsers.get(key, "{}"));
  await payUsers.set(
    key,
    JSON.stringify({ ...old, uid, platform, pins, balance: Number(old.balance || 0), expiry: old.expiry || {} }),
  );
  return s.reply(`已绑定 ${pins.length} 个 JD 账号`);
}

async function assistant(uid) {
  const key = `${String(await s.getPlatform()).toUpperCase()}:${uid}`;
  const row = parseJSON(await payUsers.get(key, "{}"));
  return s.reply(
    [
      `收款助手余额：${Number(row.balance || 0).toFixed(2)} 元`,
      `JD账号：${(row.pins || []).length} 个`,
      "指令：绑定账号 / 查询到期 / 续费账号 / 我要充值",
    ].join("\n"),
  );
}

async function showExpiry(uid) {
  const key = `${String(await s.getPlatform()).toUpperCase()}:${uid}`;
  const row = parseJSON(await payUsers.get(key, "{}"));
  if (!(row.pins || []).length) return s.reply("请先发送 绑定账号");
  return s.reply(
    (row.pins || [])
      .map(
        (pin) =>
          `${decode(pin)}：${row.expiry?.[pin] ? new Date(row.expiry[pin]).toLocaleDateString("zh-CN") : "未续费"}`,
      )
      .join("\n"),
  );
}

async function renew(uid, cfg) {
  const platform = String(await s.getPlatform()).toUpperCase();
  const key = `${platform}:${uid}`;
  const row = parseJSON(await payUsers.get(key, "{}"));
  if (!(row.pins || []).length) return s.reply("请先发送 绑定账号");
  await s.reply("请输入续费天数，输入 q 取消。");
  return s.listen({
    rules: ["raw ^(\\S+)$"],
    timeout: 60000,
    user_id: uid,
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const value = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(value)) return "已取消";
      const days = Number(value);
      if (!Number.isInteger(days) || days <= 0) return next.reply("天数格式错误");
      const cost = Number(cfg.day_fee || 0.1) * days * row.pins.length;
      if (Number(row.balance || 0) < cost) return next.reply(`余额不足，需要 ${cost.toFixed(2)} 元`);
      const expiry = { ...(row.expiry || {}) };
      for (const pin of row.pins) expiry[pin] = Math.max(Date.now(), Number(expiry[pin] || 0)) + days * 86400000;
      await payUsers.set(key, JSON.stringify({ ...row, expiry, balance: Number(row.balance || 0) - cost }));
      return next.reply(`续费完成：${row.pins.length} 个账号，扣除 ${cost.toFixed(2)} 元`);
    },
  });
}

async function adjustCash(userKey, amount) {
  if (!(await s.isAdmin())) return s.reply("仅管理员可调整余额");
  const row = parseJSON(await payUsers.get(userKey, "{}"));
  const next = Number(row.balance || 0) + amount;
  if (next < 0) return s.reply("调整后余额不能为负数");
  await payUsers.set(userKey, JSON.stringify({ ...row, balance: next }));
  return s.reply(`余额调整完成：${userKey} => ${next.toFixed(2)} 元`);
}

async function rechargeLegacy(uid, cfg) {
  if (!cfg.wx_qr_url) return s.reply("请先配置微信赞赏码 URL");
  await s.reply(`请在2分钟内完成打赏，回复 q 退出\n${require("sillygirl").utils.image(cfg.wx_qr_url)}`);
  const payment = await vorto.waitPaymentEvent(s, 0, 120000);
  if (!payment?.paid || Number(payment.money) <= 0) return s.reply(payment?.cancelled ? "已退出" : "支付等待超时");
  const store = await legacyBalanceStore();
  const raw = parseJSON(await store.bucket.get(uid, "{}"));
  const amount = Number(payment.money) * (Number(cfg.recharge_scale) || 100);
  const balance = Number(raw.balance || 0) + amount;
  await store.bucket.set(
    uid,
    JSON.stringify({
      ...raw,
      balance,
      isBlacklist: false,
      registrationTime: raw.registrationTime || new Date().toISOString(),
    }),
  );
  return s.reply(`充值 ${amount}，当前余额：${balance}`);
}

async function queryLegacy(uid) {
  const store = await legacyBalanceStore();
  const raw = parseJSON(await store.bucket.get(uid, "{}"));
  return s.reply(`余额：${Number(raw.balance || 0)}`);
}
async function legacyBalanceStore() {
  const platform = String((await s.getPlatform()) || "WEB").toUpperCase();
  return { platform, bucket: new Bucket(`sm_gaia_userData_${platform}`) };
}

async function balance(uid) {
  return Number(await points.get(uid, 0)) || 0;
}
async function change(uid, amount, desc) {
  const next = (await balance(uid)) + amount;
  if (next < 0) throw new Error("积分不足");
  await points.set(uid, String(next));
  const rows = parseJSON(await logs.get(uid, "[]"));
  const list = Array.isArray(rows) ? rows : [];
  list.unshift({ time: Date.now(), amount, desc, balance: next });
  await logs.set(uid, JSON.stringify(list.slice(0, 100)));
  return next;
}
async function showLogs(uid) {
  const rows = parseJSON(await logs.get(uid, "[]"));
  return s.reply(
    Array.isArray(rows) && rows.length
      ? rows
          .slice(0, 20)
          .map(
            (row) =>
              `${new Date(row.time).toLocaleString("zh-CN")} ${row.amount >= 0 ? "+" : ""}${row.amount} ${row.desc} => ${row.balance}`,
          )
          .join("\n")
      : "暂无积分记录",
  );
}
function parseJSON(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}
function decode(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

// [title: 京东应用宝登录]
// [name: jdYingYongBaoDengLu]
// [desc: 对接 YYB Go 应用宝微信扫码服务，换取 pt_key/pt_pin、绑定用户并同步青龙]
// [author: 1934103887,97610325]
// [version: v2.2.1]
// [rule: ^(应用宝登录|应用宝扫码|微信Code登录|京东微信登录)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 101]
// [class: 工具类]
// [icon: https://www.jd.com/favicon.ico]
// [carry: true]
// [origin: backup/京东应用宝协议_v2.0.0_By.1934103887.py;backup/京东登录_v3.3.0_By.97610325.py]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin, sender: s, utils } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const notify = new Bucket("jdNotify"),
  accounts = new Bucket("jdYingYongBaoDengLu");
const form = new plugin.Form({
  yyb_url: plugin.Form.string().title("YYB Go 服务地址").default("http://127.0.0.1:18080"),
  qinglong_id: plugin.Form.integer().title("青龙编号").min(1).default(1),
  env_name: plugin.Form.string().title("Cookie 环境变量名").default("JD_COOKIE"),
  wait_seconds: plugin.Form.integer().title("扫码等待秒数").min(30).max(600).default(120),
  poll_seconds: plugin.Form.integer().title("轮询间隔秒数").min(1).max(15).default(2),
});

async function main() {
  const cfg = normalize((await form.get()) || {});
  try {
    const chatId = String((await s.getChatId()) || "");
    const userId = String((await s.getUserId()) || "");
    if (chatId && chatId !== userId) return s.reply("应用宝扫码登录请私聊机器人使用");
    const qr = await yybRequest(cfg, "/qr?as_base64=true", "POST");
    const sessionId = qr.session_id || qr.sessionId;
    if (!sessionId) throw new Error("扫码服务未返回 session_id");
    const imageUrl = absolute(cfg.yybUrl, qr.image_url || qr.imageUrl || qr.qrcode_url || qr.qr_url || "");
    if (imageUrl) await s.reply(utils.image(imageUrl));
    else await s.reply(`请使用微信扫码：${qr.url || qr.qrcode || qr.qr_url || sessionId}`);
    await s.reply("扫码后请在手机确认，正在等待应用宝授权……");
    const confirmed = await waitConfirmed(cfg, sessionId);
    const openid =
      confirmed.openid || confirmed.openId || confirmed.ref || confirmed.account?.openid || confirmed.data?.openid;
    if (!openid) throw new Error("确认结果缺少 openid/ref");
    const exchanged = await yybRequest(cfg, "/jd/pt/exchange", "POST", { ref: openid });
    const cookie = core.normalizeCookie(
      exchanged.ck || exchanged.cookie || `pt_key=${exchanged.pt_key};pt_pin=${exchanged.pt_pin};`,
    );
    if (!cookie) throw new Error("换取结果缺少 pt_key/pt_pin");
    const ql = new container.QingLong({ id: cfg.qinglongId }),
      pin = core.ptPin(cookie);
    const result = await core.upsertEnv(ql, { name: cfg.envName, value: cookie, remarks: core.decode(pin) });
    const platform = String((await s.getPlatform()) || "");
    notify.set(
      pin,
      JSON.stringify({ user_id: userId, imType: platform, nickname: core.decode(pin), updated_at: Date.now() }),
    );
    accounts.set(`${platform}:${userId}`, JSON.stringify({ openid, pin, updated_at: Date.now() }));
    await s.pushAdmin(`京东应用宝登录：${core.decode(pin)}，青龙 #${cfg.qinglongId} ${result.action}`);
    return s.reply(`京东登录成功：${core.decode(pin)}，Cookie 已${result.action === "created" ? "新增" : "更新"}`);
  } catch (error) {
    return s.reply(`应用宝扫码登录失败：${friendly(error)}`);
  }
}

async function waitConfirmed(cfg, sessionId) {
  const deadline = Date.now() + cfg.waitSeconds * 1000;
  while (Date.now() < deadline) {
    let data;
    try {
      data = await yybRequest(cfg, `/qr/${encodeURIComponent(sessionId)}/poll`, "GET");
    } catch (error) {
      if (!/timeout|deadline|awaiting headers/i.test(core.errorText(error))) throw error;
      await utils.sleep(cfg.pollSeconds * 1000);
      continue;
    }
    const status = String(data.status || "").toLowerCase();
    if (status === "authorized") return yybRequest(cfg, `/qr/${encodeURIComponent(sessionId)}/confirm`, "POST");
    if (status === "confirmed") return data;
    if (["expired", "cancelled", "unknown"].includes(status)) throw new Error(`二维码状态：${status}`);
    await utils.sleep(cfg.pollSeconds * 1000);
  }
  throw new Error("扫码超时");
}

async function yybRequest(cfg, path, method, body) {
  const response = await core.requestJson(`${cfg.yybUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    timeout: 45000,
  });
  if (response && typeof response === "object" && "code" in response && "data" in response) {
    if (![0, 200, "0", "200"].includes(response.code))
      throw new Error(response.msg || response.message || JSON.stringify(response));
    return response.data && typeof response.data === "object" ? response.data : { value: response.data };
  }
  if (response?.success === false)
    throw new Error(response.error || response.message || response.msg || JSON.stringify(response));
  return response || {};
}
function absolute(base, value) {
  if (!value) return "";
  try {
    return new URL(value, `${base}/`).toString();
  } catch (_) {
    return value;
  }
}
function friendly(error) {
  const text = core.errorText(error);
  if (/超时|expired/i.test(text)) return "扫码超时，请重新发送指令";
  if (/missing pt_key|缺少 pt_key/i.test(text)) return "请先在微信“京东购物”小程序绑定京东账号";
  return text;
}
function normalize(value) {
  return {
    yybUrl: String(value.yyb_url || "http://127.0.0.1:18080").replace(/\/+$/, ""),
    qinglongId: Number(value.qinglong_id) || 1,
    envName: String(value.env_name || "JD_COOKIE"),
    waitSeconds: Math.max(30, Math.min(600, Number(value.wait_seconds) || 120)),
    pollSeconds: Math.max(1, Math.min(15, Number(value.poll_seconds) || 2)),
  };
}
main();
module.exports = { yybRequest, waitConfirmed };

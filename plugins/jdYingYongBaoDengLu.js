// [title: 京东应用宝登录]
// [name: jdYingYongBaoDengLu]
// [desc: 对接 yyb-py 应用宝微信扫码，换取 pt_key/pt_pin 并同步青龙]
// [author: Mianpro官方]
// [version: v3.0.2]
// [rule: ^(应用宝登录|应用宝扫码|京东微信登录|扫码登录)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 101]
// [class: 工具]
// [icon: https://fc-ccimage.baidu.com/0/pic/-1452396718_1569556084_-7398448.jpg]
// [carry: true]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const crypto = require("crypto");
const { Bucket, container, plugin, sender: s, utils } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const notify = new Bucket("jdNotify"),
  accounts = new Bucket("jdYingYongBaoDengLu");

const form = new plugin.Form({
  yyb_url: plugin.Form.string().title("yyb-py 服务地址").default("https://yyb.920pdd.com"),
  license_key: plugin.Form.string().title("授权码 License Key").default("").required(),
  qinglong_id: plugin.Form.integer().title("青龙编号").min(1).default(1),
  env_name: plugin.Form.string().title("Cookie 环境变量名").default("JD_COOKIE"),
  wait_seconds: plugin.Form.integer().title("扫码等待秒数").min(30).max(600).default(120),
  poll_seconds: plugin.Form.integer().title("轮询间隔秒数").min(1).max(15).default(3),
});

/* ---- 京东协议常量 ---- */
const JD_APPID_PUB = "wx73247c7819d61796";
const JD_APPID_CONST = "599";
const JD_CLIENT_VER = "2.0.2";
const JD_SIGN_GSALT = "sb2cwlYyaCSN1KUv5RHG3tmqxfEb8NKN";
const JD_FINGER_BIZ_KEY = "bce044c839bb9eb811aad5af18a629e199da4e13";
const JD_REFERER = `https://servicewechat.com/${JD_APPID_PUB}/864/page-frame.html`;
const JD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254186b) XWEB/19481";
const JD_FINGER_TK_DEFAULT = "L64RTJ562VJEYNEQN67XMUWSR4UFLOIQHJYZ3MWERRIKJGP24SDSBDS4I4AMVU24Y3Y7A4UPDICN2";
const JD_FINGER_ALPHABET = "23IL<N01c7KvwZO56RSTAfghiFyzWJqVabGH4PQdopUrsCuX*xeBjkltDEmn89.-";

function jdMd5(str) {
  return crypto.createHash("md5").update(String(str), "utf8").digest("hex");
}
function jdRandHex(n) {
  return crypto.randomBytes(n).toString("hex");
}
function jdFingerEncode(obj) {
  const text = encodeURIComponent(JSON.stringify(obj));
  let out = "",
    i = 0;
  do {
    const e = text.charCodeAt(i++);
    const r = text.charCodeAt(i++);
    const u = text.charCodeAt(i++);
    const a = e >> 2;
    const c = ((3 & e) << 4) | (r >> 4);
    let t = ((15 & r) << 2) | (u >> 6);
    let f = 63 & u;
    if (Number.isNaN(r)) t = f = 64;
    else if (Number.isNaN(u)) f = 64;
    out +=
      JD_FINGER_ALPHABET.charAt(a) +
      JD_FINGER_ALPHABET.charAt(c) +
      JD_FINGER_ALPHABET.charAt(t) +
      JD_FINGER_ALPHABET.charAt(f);
  } while (i < text.length);
  return out + "/";
}

async function jdFetch(url, options = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(options.timeout || 20000),
    ...options,
  });
  return res;
}

/* 从 openid 换京东 cookie */
async function exchangeJdCookie(yybUrl, licenseKey, openid) {
  // 1. 先从 /accounts 找 openid 对应的账号 id
  let ref = openid;
  try {
    const r = await fetch(`${yybUrl}/accounts?licenseKey=${encodeURIComponent(licenseKey)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    if (j?.code === 0 && Array.isArray(j.data)) {
      const acc = j.data.find((a) => (a.openid || "") === openid);
      if (acc?.id) ref = String(acc.id);
    }
  } catch (_) {}

  // 2. 调 /api/yyb/get-code 拿微信小程序 code
  const codeRes = await fetch(`${yybUrl}/api/yyb/get-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-License-Key": licenseKey },
    body: JSON.stringify({ openid, appid: JD_APPID_PUB }),
    signal: AbortSignal.timeout(30000),
  });
  const codeJson = await codeRes.json();
  if (!codeJson?.success)
    throw new Error(`获取微信code失败: ${codeJson?.error || codeJson?.msg || JSON.stringify(codeJson).slice(0, 200)}`);
  const code = codeJson.code;
  if (!code) throw new Error("未拿到有效微信code");

  // 3. 获取指纹 token
  const now = Date.now();
  const env = {
    sv: "1.0.3.4",
    clist: now,
    vlv: "3.16.0",
    ve: "4.1.8.107",
    fs: -1,
    la: "zh_CN",
    br: "microsoft",
    mo: "microsoft",
    pr: 1,
    pl: "windows",
    sh: 780,
    sw: 414,
    sbh: "",
    sy: "Windows 10",
    wh: 780,
    ww: 414,
    bl: "",
    nt: "wifi",
    vid: JD_APPID_PUB,
    bk: JD_FINGER_BIZ_KEY,
    cliet: now,
    fp: jdRandHex(16),
  };
  const fingerRes = await fetch(`https://we.jd.com/stone/1/${JD_FINGER_TK_DEFAULT}`, {
    method: "POST",
    headers: { "User-Agent": JD_UA, Referer: JD_REFERER, "Content-Type": "application/json", Accept: "*/*" },
    body: jdFingerEncode(env),
    signal: AbortSignal.timeout(15000),
  });
  const fingerJson = await fingerRes.json();
  const eidToken = fingerJson?.data?.tk || fingerJson?.tk || "";

  // 4. silentauthlogin 换 pt_key/pt_pin
  const ts = Math.floor(Date.now() / 1000);
  const signData = {
    globalTokenSource: "",
    code,
    token: "",
    salt: "",
    user_data: "",
    user_iv: "",
    eid_token: eidToken,
    goToLogin: true,
    returnurl: "/pages/login/web-view/web-view",
    wxappid: JD_APPID_PUB,
    appid: JD_APPID_CONST,
    client_ver: JD_CLIENT_VER,
    ts,
  };
  const order = ["appid", "wxappid", "client_ver", "ts", "cmd", "sub_cmd", "gsalt"];
  const extra = { cmd: 52, sub_cmd: 1, gsalt: JD_SIGN_GSALT };
  const raw = order
    .map((k) => (signData[k] != null && signData[k] !== "" ? signData[k] : extra[k] != null ? extra[k] : ""))
    .join("");
  signData.sign = jdMd5(raw);

  const loginRes = await fetch("https://wxapplogin.m.jd.com/cgi-bin/jxpp/silentauthlogin", {
    method: "POST",
    headers: {
      "User-Agent": JD_UA,
      Referer: JD_REFERER,
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: "guid=; pt_pin=; pt_key=; pt_token;",
      Accept: "*/*",
    },
    body: new URLSearchParams(signData).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const loginOut = await loginRes.json();
  if (loginOut?.err_code !== 0 || !loginOut?.pt_key || !loginOut?.pt_pin)
    throw new Error(`京东登录失败: ${JSON.stringify(loginOut).slice(0, 300)}`);

  return {
    pt_key: loginOut.pt_key,
    pt_pin: loginOut.pt_pin,
    ck: `pt_key=${loginOut.pt_key};pt_pin=${loginOut.pt_pin};`,
  };
}

async function main() {
  const cfg = (await form.get()) || {};
  const yybUrl = String(cfg.yyb_url || "").replace(/\/+$/, "");
  const licenseKey = String(cfg.license_key || "").trim();
  if (!yybUrl || !licenseKey) return s.reply("请先配置 yyb-py 地址和授权码");

  try {
    const chatId = String((await s.getChatId()) || "");
    const userId = String((await s.getUserId()) || "");
    if (chatId && chatId !== userId) return s.reply("应用宝扫码登录请私聊机器人使用");

    // 1. 创建扫码会话
    await s.reply("正在生成二维码...");
    const startRes = await fetch(`${yybUrl}/api/login/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-License-Key": licenseKey },
      body: JSON.stringify({ loginSource: 1 }),
      signal: AbortSignal.timeout(30000),
    });
    const startJson = await startRes.json();
    if (!startJson?.success) throw new Error(startJson?.detail || startJson?.msg || "创建扫码失败");
    const sessionId = startJson.sessionId;
    if (!sessionId) throw new Error("未返回 sessionId");

    // 发二维码（用URL发，base64微信发不出去）
    if (startJson.qrcodeUrl) {
      await s.reply(utils.image(startJson.qrcodeUrl));
    } else if (startJson.uuid) {
      await s.reply(utils.image(`https://open.weixin.qq.com/connect/qrcode/${startJson.uuid}`));
    } else {
      throw new Error("未返回二维码");
    }
    await s.reply("请用微信扫码并确认授权，正在等待...");

    // 2. 轮询状态
    const deadline = Date.now() * 1 + (Number(cfg.wait_seconds) || 120) * 1000;
    let account = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, (Number(cfg.poll_seconds) || 3) * 1000));
      try {
        const stRes = await fetch(
          `${yybUrl}/api/login/status?sessionId=${encodeURIComponent(sessionId)}&licenseKey=${encodeURIComponent(licenseKey)}`,
          { signal: AbortSignal.timeout(15000) },
        );
        const st = await stRes.json();
        const status = String(st?.status || "").toLowerCase();
        if (status === "success" && st?.account) {
          account = st.account;
          break;
        }
        if (["expired", "rejected", "cancelled", "error"].includes(status)) throw new Error(`二维码状态：${status}`);
      } catch (e) {
        if (e.message.includes("二维码状态")) throw e;
      }
    }
    if (!account) throw new Error("扫码超时，请重新发送指令");

    const openid = account.openid;
    if (!openid) throw new Error("扫码结果缺少 openid");

    // 3. 换京东 cookie
    await s.reply("扫码成功，正在换取京东Cookie...");
    const jd = await exchangeJdCookie(yybUrl, licenseKey, openid);
    const cookie = core.normalizeCookie(jd.ck);
    if (!cookie) throw new Error("换取结果缺少 pt_key/pt_pin");

    // 4. 写青龙
    const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 });
    const pin = core.ptPin(cookie);
    const result = await core.upsertEnv(ql, {
      name: cfg.env_name || "JD_COOKIE",
      value: cookie,
      remarks: core.decode(pin),
    });

    const platform = String((await s.getPlatform()) || "");
    notify.set(
      pin,
      JSON.stringify({ user_id: userId, imType: platform, nickname: core.decode(pin), updated_at: Date.now() }),
    );
    accounts.set(`${platform}:${userId}`, JSON.stringify({ openid, pin, updated_at: Date.now() }));
    await s.pushAdmin(`京东应用宝登录：${core.decode(pin)}，青龙 #${cfg.qinglong_id} ${result.action}`);
    return s.reply(`京东登录成功：${core.decode(pin)}，Cookie 已${result.action === "created" ? "新增" : "更新"}`);
  } catch (error) {
    return s.reply(`应用宝扫码登录失败：${String(error?.message || error).slice(0, 300)}`);
  }
}

main();
module.exports = { exchangeJdCookie };

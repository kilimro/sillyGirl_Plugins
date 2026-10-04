// [title: dd_018_得间]
// [name: dd018DeJian]
// [desc: 得间短信登录、设备会话、福利金币/现金及签到状态查询]
// [author: dandan8]
// [version: v1.1.0]
// [rule: ^(得间|得间小说|dj)(教程|登录|查询|管理|清理|统计|同步|检测|授权)$]
// [cron: 30 19 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/dd_018_得间_v1.0.1_By.dandan8.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const SIGN = "http://43.143.43.159:2001/sign.php",
  API_KEY = "2026-06-18",
  DJ = "https://dj.palmestore.com",
  WELFARE = "https://welfare-dj.palmestore.com";
function p7(src) {
  let r = "__";
  for (const c of src) {
    if (/\d/.test(c)) {
      const d = Number(c);
      r += String(((d ? 10 - d : 0) * 3) % 10);
    } else r += c;
  }
  return r;
}
function dev(phone) {
  const aid = crypto.randomBytes(8).toString("hex"),
    x = p7(aid);
  return {
    zyeid: crypto.randomUUID(),
    usr: "",
    ku: "",
    kt: "",
    pc: "10",
    p1: x,
    p2: "124012",
    p3: "25295056",
    p4: "501656",
    p5: "19",
    p7: x,
    p9: "1",
    p12: "",
    p16: "22041219C",
    p21: "99",
    p22: "12",
    p25: "25295256",
    p26: "31",
    p28: crypto.randomBytes(8).toString("hex"),
    p29: "zy4248ba",
    p30: "",
    p31: x,
    p33: "com.chaozh.iReader.dj",
    p34: "Redmi",
    firm: "Redmi",
    d1: "5.5.9.2",
    rgt: "7",
    _phone: phone,
    _model: "Redmi Note 11T Pro",
    _build: "SP1A.210812.016",
    _android: "12",
  };
}
function publicDev(d) {
  return Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_")));
}
function nativeUa(d) {
  return `Dalvik/2.1.0 (Linux; U; Android ${d._android || 12}; ${d.p16} Build/${d._build || "SP1A.210812.016"})`;
}
function webUa(d) {
  return `Mozilla/5.0 (Linux; Android ${d._android || 12}; ${d.p16} Build/${d._build || "SP1A.210812.016"}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.104 Mobile Safari/537.36 zyApp/dejian zyVersion/${d.d1 || "5.5.9.2"} zyChannel/124012`;
}
async function cloud(ctx, data) {
  const r = await ctx.requestJson(SIGN, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    json: data,
  });
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "签名服务错误");
  return r.data || {};
}
async function rsa(ctx, text) {
  return (await cloud(ctx, { type: "rsa-encrypt", plaintext: text })).encrypted;
}
async function rsaSign(ctx, params) {
  return cloud(ctx, { type: "rsa-sha1", params, timestamp: String(Date.now()) });
}
async function sendSms(ctx, phone, d) {
  const phoneEnc = await rsa(ctx, phone),
    params = {
      channelId: "124012",
      device: d.p16,
      flag: "1",
      imei: d.p7,
      phone: phoneEnc,
      sendType: "0",
      times: "1",
      versionId: "25295056",
    },
    sg = await rsaSign(ctx, params),
    body = { ...params, sign: sg.sign, timestamp: sg.timestamp },
    r = await ctx.requestJson(`${DJ}/dj_user/out/sms/sendSms/V2?${new URLSearchParams(publicDev(d))}`, {
      method: "POST",
      headers: { "user-agent": nativeUa(d) },
      form: body,
    });
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "验证码发送失败");
}
function desEncrypt(text, key) {
  const k = Buffer.from(key),
    key24 = Buffer.concat([k, k, k]),
    c = crypto.createCipheriv("des-ede3-cbc", key24, k);
  return Buffer.concat([c.update(text), c.final()]).toString("base64");
}
async function smsLogin(ctx, phone, code, d) {
  const desKey = String(Math.floor(10000000 + Math.random() * 90000000)),
    pInfo = JSON.stringify({
      DesKey: await rsa(ctx, desKey),
      Data: desEncrypt(JSON.stringify({ phone, pCode: code }), desKey),
    }),
    phoneEnc = await rsa(ctx, phone),
    params = { channelId: "124012", device: d.p16, imei: d.p7, phone: phoneEnc, versionId: "25295056" },
    sg = await rsaSign(ctx, params),
    body = {
      ...params,
      userName: phone,
      pInfo,
      utdId: d.p1,
      loginSource: "手动登录",
      timestamp: sg.timestamp,
      sign: sg.sign,
    },
    r = await ctx.requestJson(`${DJ}/dj_user/out/login/loginByPhoneV3?${new URLSearchParams(publicDev(d))}`, {
      method: "POST",
      headers: { "user-agent": nativeUa(d) },
      form: body,
    });
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "得间登录失败");
  const b = r.body || {},
    usr = b.name || b.userName || b.usr,
    kt = b.token || b.kt,
    zyeid = b.zyeId || b.zyeid || b.zyeID;
  if (!usr || !kt || !zyeid) throw new Error("登录响应缺少usr、token或zyeid");
  return {
    phone,
    usr,
    ku: b.ku || b.userName || usr,
    kt,
    zyeid,
    authToken: b.authToken || "",
    uid: b.uid || "",
    signUser: b.signUser || "",
    regType: b.regType || "",
    usrMsg: b.usrMsg || {},
    login_time: Math.trunc(Date.now() / 1000),
    login_date: new Date().toISOString().slice(0, 10),
    device: { ...d, p35: Buffer.from(crypto.randomBytes(24)).toString("base64") },
    login_body: b,
  };
}
function common(sess) {
  const d = { ...sess.device, usr: sess.usr, ku: sess.ku || sess.usr, kt: sess.kt, zyeid: sess.zyeid },
    o = {
      source: "welfare",
      showContentInStatusBar: "1",
      ecpmMix: "0.0",
      ecpmVideo: "0.0",
      mcTacid: "16247",
      pca: "channel-visit",
    };
  for (const k of [
    "zyeid",
    "usr",
    "rgt",
    "p1",
    "ku",
    "kt",
    "pc",
    "p2",
    "p3",
    "p4",
    "p5",
    "p7",
    "p9",
    "p12",
    "p16",
    "p21",
    "p22",
    "p25",
    "p26",
    "p28",
    "p29",
    "p30",
    "p31",
    "p33",
    "p34",
    "firm",
    "d1",
    "p35",
  ])
    o[k] = d[k] || "";
  return o;
}
async function welfare(ctx, sess, path) {
  const params = common(sess),
    sg = await cloud(ctx, { type: "x-sign", method: "GET", path, params, body_str: "" }),
    r = await ctx.requestJson(`${WELFARE}${path}?${new URLSearchParams(params)}`, {
      headers: {
        "x-sign": sg.sign,
        "x-nonce": sg.nonce,
        "user-agent": webUa(sess.device),
        origin: "https://dj-h5.palmestore.com",
        referer: "https://dj-h5.palmestore.com/",
        "x-requested-with": "com.chaozh.iReader.dj",
      },
    });
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "得间福利查询失败");
  return r;
}
async function summary(ctx, sess) {
  const [user, tasks] = await Promise.all([
      welfare(ctx, sess, "/welfare/web/task/user"),
      welfare(ctx, sess, "/welfare/web/task/list"),
    ]),
    coin = user?.body?.coin || {};
  let sign = "未知";
  for (const task of Object.values(tasks?.body?.task_info || {})) {
    if (String(task?.task_type) !== "1005") continue;
    if (task.today_signed === true || String(task.today_signed) === "true") sign = "已签到";
    else if (task.today_signed === false || String(task.today_signed) === "false") sign = "未签到";
    else if (Number(task.done_status) >= 2 || Number(task.reward_status) === 2) sign = "已签到";
  }
  return { coin: coin.coin_amount ?? "未知", cash: coin.cash_amount ?? "未知", sign };
}
const rt = createAccountRuntime({
  title: "得间小说",
  shortName: "得间",
  prefix: "dd_018_dejian",
  defaultEnvName: "DJ_SESSION",
  orderPrefix: "DJ",
  requireAuthForQuery: false,
  async login(ctx) {
    const phone = await ctx.prompt(ctx.sender, "请输入得间手机号", 120000);
    if (!/^1[3-9]\d{9}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
    const d = dev(phone);
    await sendSms(ctx, phone, d);
    const code = await ctx.prompt(ctx.sender, "验证码已发送，请输入4-8位验证码", 120000);
    if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误");
    const sess = await smsLogin(ctx, phone, code, d),
      q = await summary(ctx, sess);
    return { account: phone, token: JSON.stringify(sess), remark: `${phone} 金币${q.coin}` };
  },
  async query(ctx, item) {
    const sess = JSON.parse(item.token),
      q = await summary(ctx, sess);
    return `📱 账号：${sess.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}\n🪙 金币：${q.coin}\n💵 现金：${q.cash}元\n📅 签到：${q.sign}`;
  },
  async cronCheck(ctx, item) {
    const q = await summary(ctx, JSON.parse(item.token));
    return `会话有效，金币${q.coin}，现金${q.cash}元，${q.sign}`;
  },
  envValue(_c, i) {
    return `${i.remark}#${i.token}`;
  },
  tutorial: "发送得间登录，输入手机号和短信验证码。插件通过原版签名服务完成登录，并查询福利金币、现金和签到状态。",
});
rt.main().catch((e) => s.reply(`得间执行失败：${e?.message || e}`));

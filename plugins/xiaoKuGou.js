// [title: 小酷狗]
// [name: xiaoKuGou]
// [desc: 酷狗短信验证码登录、金币余额与今日收入查询、授权及面板同步]
// [author: sky2022]
// [version: v2.1.0]
// [rule: ^(酷狗)(登录|登陆|查询|管理|授权|清理|教程)$|^酷狗$]
// [cron: 25 18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/小酷狗_v2.0_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const SALT = "OIlwieks28dk2k092lksi2UIkp",
  MID = "30767145192326147088652695110646018138",
  INFO_HEADERS = {
    "kg-thash": "1509162",
    "x-router": "loginservice.kugou.com",
    "user-agent": "Android9-AndroidPhone-12149-201-0-SendMobileCodeProtocolV7-wifi",
    "kg-rc": "1",
    "kg-fake": "0",
    "kg-rf": "0078a6ee",
    "content-type": "application/json; charset=utf-8",
  },
  H5_HEADERS = {
    "user-agent":
      "Mozilla/5.0 (Linux; Android 9;Build/PQ3B.190801.12281726; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36 KugouBrowser",
    "x-requested-with": "com.kugou.android",
    origin: "https://h5pkg.kugou.com",
    referer: "https://h5pkg.kugou.com/",
  };
function md5(v) {
  return crypto.createHash("md5").update(v).digest("hex");
}
function aes(text, key, iv, decrypt = false) {
  if (decrypt) {
    const c = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
    return Buffer.concat([c.update(Buffer.from(text, "hex")), c.final()]).toString("utf8");
  }
  const c = crypto.createCipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([c.update(text, "utf8"), c.final()]).toString("hex");
}
function sign(params, body = "", salt = SALT) {
  return md5(salt + [...params].sort().join("") + body + salt);
}
function query(params) {
  return params.join("&");
}
async function sendSms(ctx, mobile) {
  const params = [
      "dfid=-",
      "appid=1005",
      `mid=${MID}`,
      "clientver=12149",
      `clienttime=${Math.trunc(Date.now() / 1000)}`,
      "uuid=-",
    ],
    body = {
      plat: "1",
      businessid: 5,
      clienttime_ms: 1705903784,
      pk: "03AC4F6D2852BD7D0BE3A198C666647A0BFDFB5C51EF2FFB53E7427A99A972BAB41075404A37FBC1F23542A984114C51EF60FAA3640018A8C271507722F1E8FF4AE50D9D2BF40AE6FB2FA0D3B303552BBFD33E2224D2A40D8A01CF464E30F05230E38A1A12CD371C2690EB37965FC0585FB735F02E333729C27BFD5C417973A6",
      mobile: `${mobile.slice(0, 3)}*****${mobile.slice(-3)}`,
      params: aes(JSON.stringify({ mobile }), "795808cbe5da3c6b3b85b09541e60059", "3b85b09541e60059"),
    },
    bodyText = JSON.stringify(body),
    signature = sign(params, bodyText),
    r = await ctx.requestJson(
      `https://gateway.kugou.com:443/v8/send_mobile_code/?${params[0]}&signature=${signature}&${params.slice(1).join("&")}`,
      { method: "POST", headers: INFO_HEADERS, body: bodyText },
    );
  if (Number(r?.status) !== 1) throw new Error(r?.error_msg || "验证码发送失败");
}
async function smsLogin(ctx, mobile, code) {
  const key = "0756785487a71b02a3c5df3dca995c35",
    iv = "a3c5df3dca995c35",
    params = ["dfid=-", "appid=1005", `mid=${MID}`, "clientver=12149", "clienttime=1705903808", "uuid=-"],
    body = {
      mobile: `${mobile.slice(0, 3)}*****${mobile.slice(-3)}`,
      params: aes(JSON.stringify({ mobile, code }), key, iv),
      clienttime_ms: "1705903808203",
      dfid: "-",
      dev: "vivo PD1728",
      plat: 1,
      pk: "A046B448DB409D5E521A7892FC6CBAF8C5563927BC3E84F4DBE76F98AC4EACD977FE760FAF798E345FE08C88FD5E996293496616C416CABBAB64E314940074FD501372B8B24F20115E139BC65F73A57A60451501AED0FB7390CE090B42CA02EA7E857C9F85F867BE186E5EA7C383FD68BD8F0CE36FB5A6E55B95A47067A8661E",
      t1: "ce7fa8810d9c008b0ff1be345902b811",
      support_multi: 1,
      gitversion: "5ac9396",
      t2: "9d03b32655894a2c61d4e35dd0a1e7087be55d711bf930f327bc11653d442d0ded29f237e5eca9fc16e16f04358f6011a54b3a13ec00adaa54c08cca987dfc5c26ec00ede093ae9eb505bbcaabfa9cadbb4bdd4816ba72f07d593bb75b1fabd3529f2edc3211571cb4da06fef34c3941",
      key: "338557f741a6224d9d6c696493aae70b",
      t3: "MCwwLDAsMCwwLDY1NTMwLDAsMCww",
    },
    text = JSON.stringify(body),
    signature = sign(params, text),
    r = await ctx.requestJson(
      `https://gateway.kugou.com:443/v7/login_by_verifycode/?${params[0]}&signature=${signature}&${params.slice(1).join("&")}`,
      { method: "POST", headers: INFO_HEADERS, body: text },
    );
  if (Number(r?.status) !== 1 || Number(r?.error_code) !== 0) throw new Error(r?.error_msg || "验证码登录失败");
  const plain = JSON.parse(aes(r.data.secu_params, key, iv, true));
  if (!plain.token || !r.data.userid) throw new Error("登录响应缺少token");
  return { account: mobile, token: `${plain.token}#${r.data.userid}`, remark: mobile };
}
function parse(v) {
  const i = String(v).lastIndexOf("#");
  if (i < 1) throw new Error("酷狗凭证字段不完整");
  return { token: String(v).slice(0, i), userid: String(v).slice(i + 1) };
}
async function profile(ctx, a) {
  const base = [
      "srcappid=2919",
      "clientver=12149",
      `clienttime=${Date.now()}`,
      "mid=",
      "uuid=",
      "dfid=",
      "appid=1005",
      `userid=${a.userid}`,
      `token=${a.token}`,
      "from=client",
      "spec=15",
      "h5=1",
    ],
    signature = sign(base, "", "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt"),
    r = await ctx.requestJson(
      `https://gateway.kugou.com/mstc/musicsymbol/v1/user/info?${query(base)}&signature=${signature}`,
      { headers: H5_HEADERS },
    );
  if (Number(r?.status) !== 1) throw new Error(r?.error || "账号查询失败");
  return r?.data?.account || {};
}
async function today(ctx, a) {
  const base = [
      `userid=${a.userid}`,
      `token=${a.token}`,
      "appid=1005",
      "from=client",
      "page=1",
      "option=1",
      "pagesize=50",
      "dfid=",
      `mid=${MID}`,
      "clientver=12149",
      `clienttime=${Math.trunc(Date.now() / 1000)}`,
      "uuid=-",
    ],
    signature = sign(base),
    r = await ctx.requestJson(
      `https://gateway.kugou.com/mstc/musicsymbol/v1/user/bills?${query(base.slice(0, 8))}&signature=${signature}&${query(base.slice(8))}`,
      { headers: H5_HEADERS },
    );
  if (Number(r?.status) !== 1) throw new Error(r?.error || "金币明细查询失败");
  const now = new Date(),
    fmt = (d) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d),
    d0 = fmt(now);
  return (r?.data?.list || []).reduce(
    (n, x) => (fmt(new Date(Number(x.addtime) * 1000)) === d0 ? n + (Number(x.change_coins) || 0) : n),
    0,
  );
}
const rt = createAccountRuntime({
  title: "小酷狗",
  shortName: "酷狗",
  prefix: "dd_kg",
  defaultEnvName: "kg",
  orderPrefix: "KG",
  requireAuthForQuery: false,
  async login(ctx) {
    const mobile = await ctx.prompt(ctx.sender, "请输入11位手机号", 120000);
    if (!/^1[3-9]\d{9}$/.test(String(mobile || ""))) throw new Error("手机号格式错误");
    await sendSms(ctx, mobile);
    const code = await ctx.prompt(ctx.sender, "验证码已发送，请输入验证码", 120000);
    if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误");
    return smsLogin(ctx, mobile, code);
  },
  async query(ctx, item) {
    const a = parse(item.token),
      [p, t] = await Promise.all([profile(ctx, a), today(ctx, a)]);
    return `👤 昵称：${p.nick_name || item.remark}\n🪙 金币余额：${p.balance_coins || 0}\n📈 今日收入：${t}`;
  },
  async cronCheck(ctx, item) {
    const a = parse(item.token),
      [p, t] = await Promise.all([profile(ctx, a), today(ctx, a)]);
    return `账号有效，金币${p.balance_coins || 0}，今日收入${t}`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial: "发送酷狗登录，输入手机号和短信验证码；查询返回昵称、金币余额与今日收入，授权后自动同步面板。",
});
rt.main().catch((e) => s.reply(`酷狗执行失败：${e?.message || e}`));

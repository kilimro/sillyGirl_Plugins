// [title: 壹品仓]
// [name: yiPinCang]
// [desc: 壹品仓短信登录、签到状态查询、每日签到、授权及青龙同步。]
// [author: huawei]
// [version: v1.2.1]
// [rule: raw ^(壹品仓|ypc)(登录|登陆|上车|查询|管理|签到|一键运行|授权|清理|教程)$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/壹品仓_v1.2.1_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const HOST = "api.shanghaicang.com.cn",
  KEY = "base64:qc93zphetnxh2swb/deosb0zuwhhwhwhiu61zdapvdnojkoye=",
  PUB =
    "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAxHtZ1EY7AQT2LwzKfI/iWFX/zPxSbi7uqQ3n+8Cwz/YmXYtw2IoSPpzfff+Qhd7SqSqIqnpuB+bg+2nVsDxBLZPMC97vtlbaxRRoYZm7r+d3HzwysuT714InkVIFuqn1+DCwrYN5/ktXJAvfIhteHM1Y4TKfh40tPnTUKm9z8LJL0e9+I32lTJ4ZBurfO/Iv048veGVtJevGXHzq2cTxSxRHn9ulMuUOJPzmlw04x6uGSFnpB37JW+LVi9kt1FbE/vkaPFPXSehmq7oJiJ5YqXiegBPEgKuCsfq5FIg2bi1FeX+zWc7ZnQJuU40urw3wGuUD2O9l9dGqjufqvsURUh6vMuJPswXo402e7c2y2mnTrOW6ZT1J2bXPRxvOEYQVhN7mX2eLOX9naw4yZ7dF4r3h7P5avyhr+E5JIbkNuk/XWLRJHWe0wNqPDbOfWcuPjoWmsJjcQoLIRwvUYeqWh9SigMjv+QQvFitoV37l52WRLBpW8ZdoMvoQg9DulvS/TmzK9VhzwmiV+26rkZZQussb7uilsmGvn0aijbqwU2knvwBaAXlBdMgHtd6LDlj7WHBpXd61z/tH13IIv5vkVuo8aGZS5/35twTN7pt0Eko9c7axc1ujpCjSz/F/XqaDGe2ddPgNtxHO/0cAmxXYQXpL4rSvdAigOuNHJORVqw0CAwEAAQ==";
const md5 = (x) => crypto.createHash("md5").update(String(x)).digest("hex"),
  pem = `-----BEGIN PUBLIC KEY-----\n${PUB.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`,
  encPhone = (p) =>
    crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(p)).toString("base64");
function device() {
  const touchid = crypto.randomBytes(8).toString("hex");
  return {
    device: "android",
    version: "5.8.10",
    v_code: "32708351",
    channel: "developer-default",
    systemversion: "Xiaomi|Redmi K20 Pro|14",
    sysversion: "34",
    "content-type": "application/json; charset=UTF-8",
    "accept-encoding": "gzip",
    "user-agent": "okhttp/4.9.0",
    touchid,
    androidid: crypto.randomBytes(8).toString("hex"),
  };
}
async function serverTime(ctx, h) {
  const ts = String(Math.floor(Date.now() / 1000)),
    sign = md5(`device=android&key=${KEY}&timestamp=${ts}&touchid=${h.touchid}`),
    d = await ctx.requestJson(`https://${HOST}/api/v1/appInit/time?sign=${sign}&timestamp=${ts}`, { headers: h });
  return String(d?.data?.time || ts);
}
async function sms(ctx, phone, h) {
  const tel = encPhone(phone),
    ts = await serverTime(ctx, h),
    sign = md5(`device=android&key=${KEY}&tel=${tel.toLowerCase()}&timestamp=${ts}&touchid=${h.touchid}&type=3`),
    d = await ctx.requestJson(`https://${HOST}/api/v1/message/sms2?sign=${sign}&timestamp=${ts}`, {
      method: "POST",
      headers: h,
      json: { type: "3", tel },
    });
  if (d?.code && Number(d.code) !== 200) throw new Error(d.msg || "短信发送失败");
  return tel;
}
async function fastLogin(ctx, phone, code, h, tel) {
  const ts = await serverTime(ctx, h),
    sign = md5(`code=${code}&device=android&key=${KEY}&tel=${tel.toLowerCase()}&timestamp=${ts}&touchid=${h.touchid}`),
    d = await ctx.requestJson(`https://${HOST}/api/v1/user/login/fast2?sign=${sign}&timestamp=${ts}`, {
      method: "POST",
      headers: h,
      json: { tel, code },
    }),
    x = d?.data || {};
  const token = x.token || x.accessToken;
  if (!token) throw new Error(d?.msg || "登录失败");
  return {
    userId: String(x.userId || x.user_id || x.uid || ""),
    token: String(token),
    refreshToken: String(x.refreshToken || ""),
  };
}
function signed(v) {
  return ["1", "2"].includes(String(v));
}
function streak(d) {
  const prev = Array.isArray(d.lastMonthCalendar) ? d.lastMonthCalendar : [],
    cur = Array.isArray(d.calendar) ? d.calendar : [],
    all = [...prev, ...cur];
  let i = cur.findIndex((x) => String(x?.day) === "今天"),
    at = i < 0 ? all.length - 1 : prev.length + i;
  if (i >= 0 && !signed(all[at]?.signStatus) && String(d.isSignIn) !== "1") at--;
  let n = 0;
  for (; at >= 0 && signed(all[at]?.signStatus); at--) n++;
  return n;
}
function signParams(o) {
  const raw =
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${o[k]}`)
      .join("&") + "base64:qC93ZPHeTNxh2SwB/DeOSb0zUwhHWHWHiU61ZDAPvdnOjkOYE=";
  return md5(raw);
}
async function signApi(ctx, x, confirm = false) {
  const ts = String(Math.floor(Date.now() / 1000)),
    biz = confirm ? JSON.stringify({ signInAt: "", type: 0, deviceNo: "19E99BD9-B24E-4D82-8451-147D22E9545C" }) : "{}",
    o = {
      version: "5.6.0",
      token: x.token,
      device: "h5",
      timestamp: ts,
      touchid: "h5",
      nonstr: confirm ? "oS5rZW8u6YkPihWM" : "pPqkLVmEokfJGbSd",
      bizData: biz,
    };
  o.sign = signParams(o);
  const d = await ctx.requestJson(
    `https://ypc-services.shanghaicang.com.cn/activity-service/sign-in/${confirm ? "confirm" : "head/data"}`,
    {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 YPCAPPUserAgent",
        "content-type": "application/json",
        timestamp: ts,
        touchid: "h5",
        token: x.token,
        device: "h5",
        origin: "https://ypch5.shanghaicang.com.cn",
        referer: "https://ypch5.shanghaicang.com.cn/",
      },
      json: o,
    },
  );
  if (Number(d?.code) !== 200) throw new Error(d?.msg || "接口请求失败");
  return d.data || d;
}
const parse = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};
const rt = createAccountRuntime({
  title: "壹品仓",
  shortName: "壹品仓",
  prefix: "G_YPC",
  defaultEnvName: "G_YPC",
  orderPrefix: "YPC",
  requireAuthForQuery: true,
  async login(ctx) {
    try {
      const phone = await ctx.prompt(ctx.sender, "请输入11位手机号", 120000);
      if (!/^1\d{10}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
      const h = device(),
        tel = await sms(ctx, phone, h),
        code = await ctx.prompt(ctx.sender, "验证码已发送，请输入6位验证码", 120000);
      if (!/^\d{6}$/.test(String(code || ""))) throw new Error("验证码格式错误");
      const x = await fastLogin(ctx, phone, code, h, tel);
      return [{ account: phone, token: JSON.stringify(x), remark: phone }];
    } catch (e) {
      await ctx.sender.reply(`壹品仓登录失败：${e?.message || e}`);
      return [];
    }
  },
  async query(ctx, item) {
    const d = await signApi(ctx, parse(item.token));
    return `🔥 连续签到：${streak(d)}天\n📅 本月累计：${d.monthAccDays ?? 0}天\n📆 本年累计：${d.yearAccDays ?? 0}天\n✅ 今日状态：${String(d.isSignIn) === "1" ? "已签到" : "未签到"}`;
  },
  async cronCheck(ctx, item) {
    try {
      await signApi(ctx, parse(item.token), true);
      const d = await signApi(ctx, parse(item.token));
      return `签到成功，连续${streak(d)}天，本月${d.monthAccDays ?? 0}天`;
    } catch (e) {
      return `签到失败：${e?.message || e}`;
    }
  },
  async handle(ctx, c) {
    if (!/(签到|一键运行)/.test(c)) return undefined;
    const ids = await ctx.users.get(await ctx.currentUserId(), "");
    let n = 0;
    let list = [];
    try {
      list = JSON.parse(ids || "[]");
    } catch {
      list = String(ids).split(",").filter(Boolean);
    }
    for (const a of list)
      try {
        await signApi(ctx, parse(await ctx.tokens.get(a, "")), true);
        n++;
      } catch {}
    return ctx.sender.reply(`壹品仓签到完成：${n}/${list.length}`);
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.userId}#${x.token}#${x.refreshToken}`;
  },
  tutorial:
    "=====壹品仓教程=====\n发送壹品仓登录，输入手机号和短信验证码；插件保存 userId、token、refreshToken。\n查询签到日历，每日8点自动签到；授权后同步青龙。\n指令：壹品仓登录、查询、签到、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`壹品仓执行失败：${e?.message || e}`));

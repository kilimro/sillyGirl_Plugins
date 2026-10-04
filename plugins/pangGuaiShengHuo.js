// [title: 胖乖生活]
// [name: pangGuaiShengHuo]
// [desc: 胖乖生活短信登录、签名鉴权、余额/积分及今日积分查询、授权和青龙同步。]
// [author: sky2022]
// [version: v4.4.0]
// [rule: raw ^胖乖(登录|登陆|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/胖乖生活_v4.4_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const SECRET = "xl8v4s/5qpBLvN+8CzFx7vVjy31NgXXcedU7G0QpOMM=";
function path(url) {
  return new URL(url).pathname;
}
function headers(url, token = "", multipart = false) {
  const t = Date.now(),
    sign = crypto
      .createHash("sha256")
      .update(`appSecret=${SECRET}&channel=alipay&timestamp=${t}&token=${token}&version=1.57.0&${path(url)}`)
      .digest("hex");
  return {
    "user-agent": "okhttp/3.14.9",
    authorization: token,
    version: "1.57.0",
    channel: "android_app",
    phonebrand: "meizu",
    timestamp: String(t),
    sign,
    ...(multipart ? {} : { "content-type": "application/x-www-form-urlencoded" }),
  };
}
async function post(ctx, url, token, form) {
  return ctx.requestJson(url, { method: "POST", headers: headers(url, token), form });
}
async function profile(ctx, token) {
  const d = await post(ctx, "https://userapi.qiekj.com/user/info", token, { token });
  if (Number(d?.code) !== 0 || !d.data) throw new Error(d?.msg || "Token失效");
  return { id: String(d.data.id), phone: String(d.data.phone || "") };
}
async function assets(ctx, token) {
  const url = "https://userapi.qiekj.com/user/balance",
    a = await post(ctx, url, token, { token });
  if (Number(a?.code) !== 0 || !a.data) throw new Error(a?.msg || "查询失败");
  const fd = new FormData();
  for (const [k, v] of Object.entries({ page: "1", pageSize: "100", type: "100", receivedStatus: "1", token }))
    fd.append(k, v);
  const b = await ctx.requestJson("https://userapi.qiekj.com/integralRecord/pageList", {
      method: "POST",
      headers: headers("https://userapi.qiekj.com/integralRecord/pageList", token, true),
      body: fd,
    }),
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    gain = (b?.data?.items || [])
      .filter((x) => String(x.receivedTime || "").slice(0, 10) === today)
      .reduce((n, x) => n + Number(x.amount || 0), 0);
  return { balance: a.data.balance ?? 0, integral: a.data.integral ?? 0, today: gain };
}
const rt = createAccountRuntime({
  title: "胖乖生活",
  shortName: "胖乖",
  prefix: "dd_pg",
  defaultEnvName: "PGSH_TOKEN",
  orderPrefix: "PG",
  requireAuthForQuery: true,
  async login(ctx) {
    const phone = await ctx.prompt(ctx.sender, "请输入11位手机号", 120000);
    if (!phone) return [];
    let d = await post(ctx, "https://userapi.qiekj.com/common/sms/sendCode", "", { phone, template: "reg" });
    if (Number(d?.code) !== 0) throw new Error(d?.msg || "验证码发送失败");
    const code = await ctx.prompt(ctx.sender, "请输入4位验证码", 120000);
    if (!code) return [];
    d = await post(ctx, "https://userapi.qiekj.com/user/reg", "", { channel: "h5", phone, verify: code });
    const token = d?.data?.token;
    if (Number(d?.code) !== 0 || !token) throw new Error(d?.msg || "登录失败");
    const u = await profile(ctx, token);
    return [{ account: u.id, token, remark: u.phone || phone, extra: { mobile: u.phone || phone } }];
  },
  async query(ctx, item) {
    const u = await profile(ctx, item.token),
      a = await assets(ctx, item.token);
    return `📱 手机：${u.phone}\n💵 余额：${a.balance}\n🎯 总积分：${a.integral}\n📈 今日积分：${a.today}`;
  },
  async cronCheck(ctx, item) {
    const a = await assets(ctx, item.token);
    return `Token有效，总积分${a.integral}，今日+${a.today}，余额${a.balance}`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial: "输入手机号和4位短信验证码登录；查询胖乖余额、总积分和今日积分，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`胖乖生活执行失败：${e?.message || e}`));

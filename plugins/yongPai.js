// [title: 甬派]
// [name: yongPai]
// [desc: 甬派账号密码登录、支付宝提现信息、抽奖中奖记录与今日收益查询、授权及青龙同步。]
// [author: 601712460 / sky2022 / linzixuan]
// [version: v4.5.0]
// [rule: raw ^甬派(登录|登陆|查询|管理|今日收益|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/app_甬派_v0_By.601712460.py;backup/甬派_v4.5_By.sky2022.py;backup/甬派注册机_v1.5.5_By.linzixuan.py;backup/甬派管理_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const Q = "1DvvL80TsnkfuVjfbdhTeOa1Xz0ttq5tQkt33EX3Kvc=";
function parse(x) {
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
async function login(ctx, x) {
  const ts = Date.now(),
    id = crypto.randomUUID(),
    sign = crypto
      .createHash("md5")
      .update(`globalDatetime${ts}username${x.phone}test_123456679890123456`)
      .digest("hex"),
    u = new URL("https://ypapp.cnnb.com.cn/yongpai-user/api/login2/local3");
  for (const [k, v] of Object.entries({
    username: x.phone,
    password: x.password,
    deviceId: id,
    globalDatetime: ts,
    sign,
  }))
    u.searchParams.set(k, v);
  const d = await ctx.requestJson(u.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 Android agentweb/4.0.2 UCBrowser/11.6.4.950 yongpai",
    },
  });
  if (Number(d?.code) !== 0) throw new Error(d?.message || d?.msg || "登录失败");
  const z = d.data || {};
  return {
    account: String(z.userId || z.id || x.phone),
    session: z.token,
    name: z.nickname || x.phone,
    mobile: z.mobile || x.phone,
  };
}
async function prizes(ctx, a) {
  const h = {
      "user-agent": "Mozilla/5.0 Android yongpai",
      "x-request-id": `${Math.floor(1000 + Math.random() * 9000)}.${crypto.randomBytes(6).toString("hex")}|${Date.now()}`,
    },
    l = await ctx.requestJson("https://act.tmlyun.com/activity-api/lottery/api/auth/userLogin", {
      method: "POST",
      headers: h,
      json: { accountId: a.account, sessionId: a.session, q: Q, tenantCode: "yongpai" },
    }),
    d = l.data || {};
  if (!d.token) return [];
  const z = await ctx.requestJson(
    "https://act.tmlyun.com/activity-api/lottery/h5/activity/lottery/accountPrizeRecord/userPrizeRecord?activityId=1997",
    {
      headers: { ...h, authorization: d.token, ...(d.xToken || d.x_token ? { "x-token": d.xToken || d.x_token } : {}) },
    },
  );
  return (z?.data?.activityAccountPrizeVoList || []).map((x) => ({
    type: x.grade || "未知",
    title: x.prizeName || "未知奖品",
    time: x.createTime || "",
  }));
}
function income(ps) {
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  return ps
    .filter((x) => String(x.time).startsWith(day))
    .reduce((n, x) => n + Number(String(x.title).match(/([\d.]+)元/)?.[1] || 0), 0);
}
const rt = createAccountRuntime({
  title: "甬派",
  shortName: "甬派",
  prefix: "dd_yy",
  defaultEnvName: "YONGPAI",
  orderPrefix: "YP",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码#支付宝账号#支付宝姓名，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const [phone, password, alipay = "", realname = ""] = line.split("#"),
        x = { phone, password, alipay, realname },
        a = await login(ctx, x);
      rows.push({ account: a.account, token: JSON.stringify(x), remark: a.name });
    }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      a = await login(ctx, x),
      ps = await prizes(ctx, a);
    return `👤 昵称：${a.name}\n📱 手机：${a.mobile}\n💳 支付宝：${x.alipay || "未填"} ${x.realname || ""}\n🎁 中奖记录：${ps.length}\n💰 今日收益：${income(ps).toFixed(2)}元${
      ps.length
        ? `\n${ps
            .slice(0, 10)
            .map((p, i) => `${i + 1}. ${p.title}｜${p.time}`)
            .join("\n")}`
        : ""
    }`;
  },
  async handle(ctx, c) {
    if (!/今日收益/.test(c)) return;
    const uid = await ctx.currentUserId(),
      as = JSON.parse(await ctx.users.get(uid, "[]"));
    let sum = 0;
    for (const k of as) {
      const x = parse(await ctx.tokens.get(k, "{}")),
        a = await login(ctx, x),
        v = income(await prizes(ctx, a));
      sum += v;
      await ctx.sender.reply(`${await ctx.remarks.get(k, k)} 今日收益：${v.toFixed(2)}元`);
    }
    return ctx.sender.reply(`甬派全部账号今日收益：${sum.toFixed(2)}元`);
  },
  async cronCheck(ctx, item) {
    const a = await login(ctx, parse(item.token)),
      ps = await prizes(ctx, a);
    return `账号有效，中奖记录${ps.length}条，今日收益${income(ps).toFixed(2)}元`;
  },
  envValue(_c, i) {
    const x = parse(i.token);
    return `${x.phone}#${x.password}#${x.alipay || ""}#${x.realname || ""}`;
  },
  tutorial: "输入手机号#密码#支付宝账号#支付宝姓名；查询中奖记录与今日红包收益，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`甬派执行失败：${e?.message || e}`));

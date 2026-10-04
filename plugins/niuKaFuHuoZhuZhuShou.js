// [title: 牛卡福货主助手]
// [name: niuKaFuHuoZhuZhuShou]
// [desc: 牛卡福货主 Token 绑定、用户/余额/积分查询、每日签到、授权及青龙同步。]
// [author: 8165799]
// [version: v1.2.0]
// [rule: raw ^牛卡福货主(登录|登陆|上车|查询|管理|一键运行|授权|清理|教程)$]
// [cron: 5 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/牛卡福货主_v1.2_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://shippers.nucarf.net";
function headers(token) {
  return {
    "content-type": "application/json",
    "user-agent": "okhttp/3.14.9",
    "x-access-token": token,
    "oss-token": token,
    "x-apptype": "APP",
    "x-device-type": "ANDROID",
    "x-device-id": crypto.randomBytes(8).toString("hex"),
    "x-device-name": "Android",
    "x-appversion": "2.4.7",
    "x-term-id": "30971511",
    "request-source": "ONE_STOP_WX_DISPATCH",
    "accept-encoding": "gzip",
  };
}
async function call(ctx, token, method, path, json) {
  const d = await ctx.requestJson(BASE + path, { method, headers: headers(token), json });
  if (Number(d?.code) !== 200) throw new Error(d?.message || `${path}失败`);
  return d.data || {};
}
async function info(ctx, token) {
  const d = await call(ctx, token, "GET", "/api/shippers/user/mine"),
    u = d.userInfo || {};
  return {
    name: u.userName || "牛卡福用户",
    phone: String(u.phoneNo || ""),
    wallet: d.walletAmount ?? 0,
    points: d.pointAmount ?? 0,
  };
}
async function sign(ctx, token) {
  const st = await call(ctx, token, "GET", "/api/campaign/dailySignIn");
  if (st.signInStatus) return `今日已签到，连续${st.signInCount ?? 0}天`;
  await new Promise((r) => setTimeout(r, 2000));
  const d = await call(ctx, token, "POST", "/api/campaign/signIn", {});
  return `签到成功，获得${d.pointAmount ?? 0}积分（第${d.day ?? 0}天）`;
}
const rt = createAccountRuntime({
  title: "牛卡福货主助手",
  shortName: "牛卡福货主",
  prefix: "dd_nkf",
  defaultEnvName: "NKF_SHIPPER_TOKEN",
  orderPrefix: "NKFH",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：手机号#Token#备注，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.split("#"),
          phone = p.shift(),
          token = p.shift(),
          remark = p.join("#") || phone;
        if (!/^1\d{10}$/.test(phone) || !token) throw new Error("格式错误");
        const x = await info(ctx, token);
        if (x.phone && x.phone !== phone) throw new Error(`Token对应手机号为${ctx.mask(x.phone)}`);
        rows.push({ account: phone, token, remark: remark || x.name });
      } catch (e) {
        await ctx.sender.reply(`牛卡福货主登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await info(ctx, item.token);
    return `👤 用户：${x.name}\n📱 手机号：${ctx.mask(x.phone || item.account)}\n💰 积分：${x.points}\n💵 余额：${x.wallet}元`;
  },
  async cronCheck(ctx, item) {
    try {
      const a = await sign(ctx, item.token),
        x = await info(ctx, item.token);
      return `${a}\n当前积分${x.points}，余额${x.wallet}元`;
    } catch (_) {
      return "牛卡福货主Token已失效";
    }
  },
  envValue(_ctx, item) {
    return `${item.account}#${item.token}`;
  },
  tutorial:
    "=====牛卡福货主教程=====\n抓包牛卡福货主APP，复制 x-access-token。\n登录格式：手机号#Token#备注；查询用户、积分和余额，每日自动签到。\n授权后同步青龙格式 手机号#Token。\n指令：牛卡福货主登录、查询、管理、一键运行、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`牛卡福货主执行失败：${e?.message || e}`));

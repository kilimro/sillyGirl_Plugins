// [title: 酒仙]
// [name: jiuXian]
// [desc: 酒仙账号密码登录、会员 Token、积分及签到状态查询、授权与青龙同步。]
// [author: mrconli / rujingxianghai]
// [version: v1.2.0]
// [rule: raw ^酒仙(登录|登陆|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m039_酒仙_v1.2.0_By.mrconli.py;backup/酒仙_v1.7_By.rujingxianghai.py;backup/酒仙签到_v1.6_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const KEY = "ad96ade2-b918-3e05-86b8-ba8c34747b0c",
  BASE = {
    appVersion: "9.2.13",
    areaId: "500",
    channelCode: "0",
    cpsId: "xiaomi",
    deviceIdentify: KEY,
    deviceType: "ANDROID",
    deviceTypeExtra: "0",
    equipmentType: "M2011K2C",
    netEnv: "wifi",
    screenReslolution: "1080x2297",
    supportWebp: "1",
    sysVersion: "14",
  },
  H = { "user-agent": "okhttp/3.14.9" };
function parse(x) {
  const i = String(x).indexOf("#");
  return { user: String(x).slice(0, i), pass: String(x).slice(i + 1) };
}
async function login(ctx, x) {
  const d = await ctx.requestJson("https://newappuser.jiuxian.com/user/loginUserNamePassWd.htm", {
    method: "POST",
    headers: H,
    form: { ...BASE, appKey: KEY, userName: x.user, passWord: x.pass },
  });
  if (String(d?.success) !== "1") throw new Error(d?.errMsg || "登录失败");
  const u = d.result?.userInfo || {};
  if (!u.token) throw new Error("登录未返回Token");
  return { token: u.token, name: u.nickName || x.user };
}
async function info(ctx, token) {
  const u = new URL("https://newappuser.jiuxian.com/memberChannel/memberInfo.htm");
  for (const [k, v] of Object.entries({ ...BASE, token, appKey: KEY })) u.searchParams.set(k, v);
  const d = await ctx.requestJson(u.toString(), { headers: H });
  if (String(d?.success) !== "1") throw new Error(d?.errMsg || "会员信息失败");
  return d.result || {};
}
const rt = createAccountRuntime({
  title: "酒仙",
  shortName: "酒仙",
  prefix: "m039_jiuxian",
  defaultEnvName: "JX_COOKIE",
  orderPrefix: "JX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 账号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const x = parse(line),
        a = await login(ctx, x);
      rows.push({ account: x.user, token: line.trim(), remark: a.name });
    }
    return rows;
  },
  async query(ctx, item) {
    const a = await login(ctx, parse(item.token)),
      d = await info(ctx, a.token);
    return `👤 昵称：${a.name}\n🎯 积分：${d.goldMoney ?? 0}\n📅 今日签到：${d.isSignTody ? "已签到" : "未签到"}`;
  },
  async cronCheck(ctx, item) {
    const a = await login(ctx, parse(item.token)),
      d = await info(ctx, a.token);
    return `账号有效，积分${d.goldMoney ?? 0}，今日${d.isSignTody ? "已签到" : "未签到"}`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial: "输入酒仙账号#密码；插件实时登录获取 Token，查询会员积分和今日签到状态，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`酒仙执行失败：${e?.message || e}`));

// [title: 上观新闻]
// [name: shangGuanXinWen]
// [desc: 上观新闻账密登录、积分查询、授权及青龙同步。]
// [author: rujingxianghai]
// [version: v1.1.2]
// [rule: raw ^(上观|sgxw)(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/上观新闻_v1.1.2_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
async function login(ctx, mobile, password) {
  const times = Date.now(),
    sign = crypto.createHash("md5").update(`${mobile}$${times}$rVX9ITrrTPrCurUe`).digest("hex"),
    d = await ctx.requestJson("https://services.shobserver.cn/user/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "okhttp/4.10.0",
        "accept-encoding": "gzip",
        connection: "Keep-Alive",
      },
      form: { mobile, password, times, sign },
    });
  if (d?.breturn !== true) throw new Error(d?.errorinfo || "账号密码错误");
  return {
    userId: String(d?.object?.id || ""),
    score: d?.object?.score ?? 0,
    name: d?.object?.nickname || d?.object?.name || mobile,
  };
}
const parse = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};
const rt = createAccountRuntime({
  title: "上观新闻",
  shortName: "上观",
  prefix: "sgxw",
  defaultEnvName: "S_SGXW",
  orderPrefix: "SGXW",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码#备注，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.split("#"),
          mobile = p.shift(),
          password = p.shift(),
          remark = p.join("#") || mobile;
        if (!/^1\d{10}$/.test(mobile) || !password) throw new Error("格式错误");
        const x = await login(ctx, mobile, password);
        rows.push({
          account: mobile,
          token: JSON.stringify({ mobile, password, userId: x.userId }),
          remark: remark || x.name,
        });
      } catch (e) {
        await ctx.sender.reply(`上观登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      d = await login(ctx, x.mobile || item.account, x.password);
    return `📱 手机号：${ctx.mask(item.account)}\n👤 用户：${d.name}\n🪙 当前积分：${d.score}\n🆔 用户ID：${d.userId}`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = parse(item.token),
        d = await login(ctx, x.mobile || item.account, x.password);
      return `账号有效，当前积分${d.score}`;
    } catch (_) {
      return "上观新闻账号登录失效，请检查密码";
    }
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.mobile || item.account}#${x.password}`;
  },
  tutorial:
    "=====上观新闻教程=====\n先在上观新闻客户端注册账号，发送上观登录，按 手机号#密码#备注 提交。\n插件使用原版时间戳MD5签名登录并查询积分，授权后同步青龙。\n指令：上观登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`上观新闻执行失败：${e?.message || e}`));

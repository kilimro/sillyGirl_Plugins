// [title: 雨云签到]
// [name: yuYunQianDao]
// [desc: 雨云账号密码批量登录、CSRF会话验证、用户信息查询、授权及青龙/呆呆面板同步。]
// [author: rujingxianghai / sky2022]
// [version: v1.1.1]
// [rule: raw ^雨云(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 12 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/雨云_v1.1.1_By.sky2022.py;backup/雨云签到_v1.1_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://api.v2.rainyun.com";
function cookieHeader(headers) {
  const values =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  return values
    .filter(Boolean)
    .map((v) => v.split(";", 1)[0])
    .join("; ");
}
function csrf(cookie) {
  return decodeURIComponent(cookie.match(/(?:^|;\s*)X-CSRF-Token=([^;]+)/i)?.[1] || "");
}
async function session(ctx, username, password) {
  const r = await ctx.request(`${BASE}/user/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { field: username, password },
    }),
    d = JSON.parse(r.text);
  if (Number(d?.code) !== 200) throw new Error(d?.message || d?.msg || "登录失败");
  const cookie = cookieHeader(r.headers),
    token = csrf(cookie);
  if (!token) throw new Error("登录成功但未获取X-CSRF-Token");
  const info = await ctx.requestJson(`${BASE}/user/?no_cache=false`, {
    headers: { "content-type": "application/json", "x-csrf-token": token, cookie },
  });
  if (Number(info?.code) !== 200) throw new Error(info?.message || info?.msg || "用户信息获取失败");
  return info.data || {};
}
const rt = createAccountRuntime({
  title: "雨云签到",
  shortName: "雨云",
  prefix: "s_yy",
  defaultEnvName: "S_YYQD",
  orderPrefix: "YYQD",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入账号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const cut = line.indexOf("#"),
          account = line.slice(0, cut).trim(),
          password = line.slice(cut + 1).trim();
        if (cut < 0 || !account || !password) throw new Error("格式应为账号#密码");
        const x = await session(ctx, account, password);
        rows.push({ account, token: password, remark: x.name || x.username || account });
      } catch (e) {
        await ctx.sender.reply(`雨云登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await session(ctx, item.account, item.token);
    return `👤 用户：${x.name || x.username || item.remark}\n🆔 ID：${x.id ?? x.uid ?? "未知"}\n💰 积分：${x.points ?? x.point ?? x.score ?? "未知"}\n💴 余额：${x.balance ?? x.money ?? "未知"}\n📧 邮箱：${x.email || "未知"}`;
  },
  async cronCheck(ctx, item) {
    try {
      await session(ctx, item.account, item.token);
      return "登录凭证有效，可由面板签到脚本继续运行";
    } catch (_) {
      return "雨云账号或密码已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return `${item.account}#${item.token}`;
  },
  tutorial:
    "=====雨云签到教程=====\n发送雨云登录，按账号#密码提交，支持批量\n插件实时登录并查询用户信息，授权后同步账号#密码至青龙/呆呆面板，由面板脚本执行每日签到\n指令：雨云登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`雨云签到执行失败：${e?.message || e}`));

// [title: 游侠网]
// [name: youXiaWang]
// [desc: 游侠网账号密码批量登录、金币/现金/可提现/历史收益查询、账号管理、授权、青龙同步和到期检测。]
// [author: mrconli]
// [version: v1.3.1]
// [rule: raw ^游侠(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 47 9,18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/游侠网_v1.3.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto2 = require("node:crypto");
const { sender: sy } = require("sillygirl");
const { createAccountRuntime: createRuntime } = require("./mrconliAccountRuntime");
async function loginAli(ctx, username, password) {
  const time = Math.floor(Date.now() / 1000),
    raw = `username-${username}-time-${time}-passwd-${password}-from-feedearn-action-loginBGg)K6ng4?&x9sCIuO%C2%{@TJ?fnFJ,bZKy/[/EWnw9UsC$@1`,
    signature = crypto2.createHash("md5").update(raw).digest("hex");
  const data = await ctx.requestJson("https://i.ali213.net/api.html", {
    method: "POST",
    headers: {
      connection: "keep-alive",
      accept: "application/json, text/plain, */*",
      "user-agent": "Apache-HttpClient/UNAVAILABLE (java 1.4)",
      "content-type": "application/x-www-form-urlencoded",
    },
    form: { action: "login", username, passwd: password, time, from: "feedearn", signature },
  });
  if (Number(data?.status) !== 1 || !data?.data?.token) throw new Error(data?.message || "登录失败");
  return {
    phone: String(data.data.userinfo.mobile),
    nickname: data.data.userinfo.nickname || "",
    token: data.data.token,
  };
}
async function userInfo(ctx, token) {
  const url = new URL("https://api3.ali213.net/feedearn/userbaseinfo");
  url.searchParams.set("token", token);
  const d = await ctx.requestJson(url, {
    method: "POST",
    headers: {
      "accept-encoding": "gzip, deflate, br",
      accept: "*/*",
      connection: "keep-alive",
      host: "api3.ali213.net",
      "user-agent": "ali213app",
      "accept-language": "zh-Hans-CN;q=1",
      "content-length": "0",
    },
  });
  if (!d?.mobile) throw new Error("token查询失败");
  return {
    phone: String(d.mobile),
    nickname: d.nickname || "",
    total: Number(d.total || 0) / 100,
    available: Number(d.available || 0) / 100,
    coins: d.coins || 0,
    history: Number(d.history || 0) / 100,
  };
}
function splitCred(raw) {
  const i = String(raw).indexOf("#");
  if (i <= 0) throw new Error("格式应为账号#密码");
  return { username: String(raw).slice(0, i), password: String(raw).slice(i + 1) };
}
const rt = createRuntime({
  title: "游侠网",
  shortName: "游侠",
  prefix: "mrconli.youxia",
  defaultEnvName: "m_yxw",
  orderPrefix: "YXW",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入账号#密码，支持批量每行一个", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const c = splitCred(line.trim()),
          x = await loginAli(ctx, c.username, c.password);
        rows.push({ account: x.phone, token: `${c.username}#${c.password}`, remark: x.nickname || x.phone });
      } catch (error) {
        await ctx.sender.reply(`游侠登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const c = splitCred(item.token),
      login = await loginAli(ctx, c.username, c.password),
      x = await userInfo(ctx, login.token);
    return `👤 昵称：${x.nickname}\n🎯 当前金币：${x.coins}\n💰 当前现金：${x.total}元\n💹 可提余额：${x.available}元\n📊 历史总额：${x.history}元`;
  },
  async cronCheck(ctx, item) {
    try {
      const c = splitCred(item.token);
      await loginAli(ctx, c.username, c.password);
      return "";
    } catch (_) {
      return "账号密码登录失效，请更新凭证";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====游侠网教程=====\n登录格式：账号#密码，支持批量\n查询金币、当前现金、可提现余额和历史总额\n指令：游侠登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (error) => sy.reply(`游侠网执行失败：${error?.message || error}`));

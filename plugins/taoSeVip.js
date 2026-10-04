// [title: 桃色VIP]
// [name: taoSeVip]
// [desc: 桃色VIP账号密码批量登录、SSID刷新、等级/成长值/豆子查询、每日签到、授权和账号管理。]
// [author: rujingxianghai]
// [version: v1.4.0]
// [rule: raw ^桃色(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 18 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/桃色VIP_v1.4.0_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://wxapp.lllac.com/xqw";
function headers(cookie = "") {
  return {
    host: "wxapp.lllac.com",
    connection: "keep-alive",
    charset: "utf-8",
    cookie,
    "user-agent":
      "Mozilla/5.0 (Linux; Android 15; 2210132C) AppleWebKit/537.36 Chrome/130.0.6723.103 Mobile Safari/537.36 MicroMessenger/8.0.49 MiniProgramEnv/android",
    "content-type": "application/x-www-form-urlencoded",
    "accept-encoding": "gzip,compress,br,deflate",
    referer: "https://servicewechat.com/wxa11d535651f0f097/58/page-frame.html",
  };
}
async function login(ctx, user, password) {
  const ssid = crypto.randomBytes(16).toString("hex"),
    d = await ctx.requestJson(`${BASE}/login.php`, {
      method: "POST",
      headers: headers(`SSID=${ssid}`),
      form: { act: "login", u_name: user, u_pass: password, session_id: ssid },
    });
  if (Number(d?.error) !== 0) throw new Error(d?.msg || "登录失败");
  return `SSID=${ssid}`;
}
async function info(ctx, cookie) {
  const d = await ctx.requestJson(
    `${BASE}/user_home_v2.php?act=home&channel=tsvip&qudao=normal&cid_most=&gid_most=&version=30&od_count=`,
    { headers: headers(cookie) },
  );
  if (Number(d?.error) !== 0) throw new Error(d?.msg || "用户信息获取失败");
  return {
    name: d.user_name || "未知",
    rank: d.user_rank || "未知",
    point: d.user_point || 0,
    dou: d.user_dou || 0,
    nextRank: d.next_rank || "未知",
    nextPoint: d.next_point || 0,
    bar: d.bar || 0,
  };
}
async function sign(ctx, cookie) {
  const ssid = String(cookie).replace(/^SSID=/i, ""),
    d = await ctx.requestJson(`${BASE}/user_mall.php?act=signToday&ssid=${encodeURIComponent(ssid)}&spm=x.user`, {
      headers: headers(cookie),
    });
  return d;
}
const rt = createAccountRuntime({
  title: "桃色VIP",
  shortName: "桃色",
  prefix: "s_taose",
  defaultEnvName: "S_TAOSE",
  orderPrefix: "TAOSE",
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
        const cookie = await login(ctx, account, password),
          x = await info(ctx, cookie);
        rows.push({ account, token: password, remark: x.name || account });
      } catch (e) {
        await ctx.sender.reply(`桃色登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const cookie = await login(ctx, item.account, item.token),
      x = await info(ctx, cookie);
    return `👤 昵称：${x.name}\n🎖️ 等级：${x.rank}\n📈 成长值：${x.point}\n💰 豆子：${x.dou}\n⏭️ 下一级：${x.nextRank}（${x.nextPoint}）`;
  },
  async cronCheck(ctx, item) {
    const cookie = await login(ctx, item.account, item.token),
      d = await sign(ctx, cookie),
      x = await info(ctx, cookie);
    return `签到：${d?.msg || d?.message || (Number(d?.error) === 0 ? "成功" : "失败")}\n当前豆子：${x.dou}，等级：${x.rank}`;
  },
  envValue(_ctx, item) {
    return `${item.account}#${item.token}`;
  },
  tutorial:
    "=====桃色VIP教程=====\n发送桃色登录，按账号#密码提交，支持批量\n每次运行自动重新登录刷新SSID，查询等级/成长值/豆子并每日签到\n指令：桃色登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`桃色VIP执行失败：${e?.message || e}`));

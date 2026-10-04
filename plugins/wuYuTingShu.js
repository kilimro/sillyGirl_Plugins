// [title: 唔语听书]
// [name: wuYuTingShu]
// [desc: 唔语听书Bearer Token批量绑定、用户名/红花/广告/收听时长查询、授权和青龙同步。]
// [author: 97610325]
// [version: v2.3.0]
// [rule: raw ^唔语(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 20 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/唔语听书_vV2.3_By.97610325.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const URL = "https://xcx.myinyun.com:4438/napi/wx/getUserDetail";
function clean(v) {
  return String(v || "")
    .trim()
    .replace(/^bearer\s+/i, "");
}
async function detail(ctx, token) {
  const d = await ctx.requestJson(URL, {
    headers: {
      host: "xcx.myinyun.com:4438",
      connection: "keep-alive",
      "content-type": "application/json",
      "accept-encoding": "gzip,compress,br,deflate",
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.70 MiniProgramEnv/iOS",
      referer: "https://servicewechat.com/wxa25139b08fe6e2b6/23/page-frame.html",
      authorization: `Bearer ${clean(token)}`,
    },
  });
  if (!d?.username) throw new Error(d?.message || "Token失效");
  return d;
}
const rt = createAccountRuntime({
  title: "唔语听书",
  shortName: "唔语",
  prefix: "dd_wuyu",
  defaultEnvName: "WuyuToken",
  orderPrefix: "WUYU",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入Token，支持Bearer前缀和批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const token = clean(raw),
          x = await detail(ctx, token),
          account = `wuyu_${crypto.createHash("md5").update(token).digest("hex").slice(0, 12)}`;
        rows.push({ account, token, remark: x.username });
      } catch (e) {
        await ctx.sender.reply(`唔语登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await detail(ctx, item.token);
    return `📱 用户名：${x.username}\n🌹 红花数量：${x.flowerCount ?? 0}\n📺 广告次数：${x.adCount ?? 0}\n⏱️ 总收听时长：${x.totalListenTime ?? 0}秒`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = await detail(ctx, item.token);
      return `Token有效，红花${x.flowerCount ?? 0}，收听${x.totalListenTime ?? 0}秒`;
    } catch (_) {
      return "唔语Token已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return clean(item.token);
  },
  tutorial:
    "=====唔语听书教程=====\n抓包 getUserDetail 请求取得 authorization Token，带不带Bearer都支持，可批量换行提交\n查询用户名、红花、广告次数和总收听时长；授权后同步青龙\n指令：唔语登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`唔语听书执行失败：${e?.message || e}`));

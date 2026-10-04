// [title: 好奇车生活]
// [name: haoQiCheShengHuo]
// [desc: 好奇车生活 accountId 批量绑定、积分/今日收入/到期积分/商城奖励查询、授权及青龙同步。]
// [author: sky2022]
// [version: v7.9.0]
// [rule: raw ^(车生活|好奇)(登录|登陆|上车|查询|管理|奖励|授权|清理|教程)$]
// [cron: 15 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/好奇车生活_vV7.9_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://channel.cheryfs.cn/archer/activity-api",
  UA =
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 Chrome/81.0.4044.138 MicroMessenger/7.0.9.501 MiniProgramEnv/Windows";
function clean(v) {
  return String(v || "").trim();
}
function headers(accountId, mall = false) {
  return {
    host: "channel.cheryfs.cn",
    connection: "keep-alive",
    wxappid: "619669369294712832",
    tenantid: "619669306447261696",
    activityid: mall ? "621950054462152705" : "621883730893492225",
    accountid: clean(accountId),
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    ...(mall
      ? {
          timestamp: String(Date.now()),
          assemblyname: "%E5%88%AE%E5%88%AE%E4%B9%90",
          sign: "eff41a284067d208807fbd94740245c7",
          requesturl:
            "https://channel.cheryfs.cn/archer/act/619669306447261696/619669369294712832/activity/luckydraw-detail/620821692188483585",
          referer:
            "https://channel.cheryfs.cn/archer/act/619669306447261696/619669369294712832/activity/pointsmall-detail/621911913692942337",
        }
      : {}),
  };
}
async function point(ctx, ck) {
  const d = await ctx.requestJson(
    `${BASE}/common/accountPointLeft?pointId=620415610219683840&showExpire=true&timeType=day&indexDay=`,
    { headers: headers(ck) },
  );
  if (Number(d?.code) !== 200) throw new Error(d?.message || "accountId失效");
  return { point: d.result, expire: d.message };
}
async function today(ctx, ck) {
  const d = await ctx.requestJson(`${BASE}/common/accountPointInfo`, {
    method: "POST",
    headers: { ...headers(ck, true), "content-type": "application/json" },
    json: {
      pointId: "620415610219683840",
      accountId: "",
      type: 2,
      pageNumber: 1,
      pageSize: 10,
      startDate: "",
      endDate: "",
    },
  });
  if (Number(d?.code) !== 200) throw new Error(d?.message || "积分流水获取失败");
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  return (d?.result?.accountPointLogs || [])
    .filter((x) => String(x?.updateTime || "").startsWith(day))
    .reduce((n, x) => n + Number(x?.amount || 0), 0);
}
async function rewards(ctx, ck) {
  const d = await ctx.requestJson(`${BASE}/pointsmall/queryPointsMallCardList?isGroup=false`, {
    headers: headers(ck, true),
  });
  if (d?.success !== true) throw new Error(d?.message || "奖励列表获取失败");
  return (d?.result?.["全部"] || []).map((x) => `${x.cardName}：${x.exchangePointsValue}积分（ID:${x.id}）`);
}
const rt = createAccountRuntime({
  title: "好奇车生活",
  shortName: "车生活",
  prefix: "dd_hqcsh",
  defaultEnvName: "hqcshck",
  orderPrefix: "HQC",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入accountId，格式 备注#accountId，支持批量换行", 180000);
    if (input === null) return [];
    const rows = [];
    for (const [i, raw] of input.split(/\r?\n/).filter(Boolean).entries())
      try {
        const p = raw.indexOf("#"),
          remark = p > 0 ? raw.slice(0, p).trim() : `账号${i + 1}`,
          token = clean(p > 0 ? raw.slice(p + 1) : raw);
        await point(ctx, token);
        rows.push({
          account: `hqc_${crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)}`,
          token,
          remark,
        });
      } catch (e) {
        await ctx.sender.reply(`第${i + 1}个账号失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const [p, t, r] = await Promise.all([point(ctx, item.token), today(ctx, item.token), rewards(ctx, item.token)]);
    return `💰 当前积分：${p.point}\n📈 今日获得：${t}\n⏳ 到期积分：${p.expire || "无"}\n🎁 最新奖励：\n${r.length ? r.join("\n") : "暂无"}`;
  },
  async cronCheck(ctx, item) {
    try {
      const p = await point(ctx, item.token);
      return `accountId有效，当前积分${p.point}${p.expire ? `，到期积分${p.expire}` : ""}`;
    } catch (_) {
      return "accountId已失效，请重新登录";
    }
  },
  async handle(ctx, content) {
    if (!/奖励/.test(content)) return undefined;
    const input = await ctx.prompt(ctx.sender, "请输入accountId查询奖励，退出输入q", 60000);
    if (input === null || /^q$/i.test(input)) return ctx.sender.reply("已退出");
    try {
      const list = await rewards(ctx, input);
      return ctx.sender.reply(`======最新奖励======\n${list.join("\n") || "暂无奖励"}\n==================`);
    } catch (e) {
      return ctx.sender.reply(`奖励查询失败：${e?.message || e}`);
    }
  },
  envValue(_ctx, item) {
    return clean(item.token);
  },
  tutorial:
    "=====好奇车生活教程=====\n抓包好奇车生活小程序 channel.cheryfs.cn，请求头 accountId 即凭证。\n登录格式：备注#accountId，支持批量换行。\n查询返回当前积分、今日积分、到期积分和商城奖励；授权后同步青龙变量 hqcshck。\n指令：车生活登录、查询、奖励、管理、授权、清理、教程\n======================",
});
rt.main().catch(async (e) => s.reply(`好奇车生活执行失败：${e?.message || e}`));

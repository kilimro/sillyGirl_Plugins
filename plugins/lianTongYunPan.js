// [title: 联通云盘]
// [name: lianTongYunPan]
// [desc: 联通 token_online 登录、ecs_token 刷新、话费红包/积分/云盘积分查询、授权及青龙同步。]
// [author: sky2022]
// [version: v1.5.0]
// [rule: raw ^联通云盘(登录|登陆|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/联通云盘_v1.5_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js","./unicomAssetCore.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const uc = require("./unicomAssetCore.js");
function parse(x) {
  try {
    return JSON.parse(x);
  } catch {
    return { token_online: String(x) };
  }
}
async function online(ctx, t) {
  const d = await ctx.requestJson("https://m.client.10010.com/mobileService/onLine.htm", {
    method: "POST",
    headers: { "user-agent": "Dalvik/2.1.0;unicom{version:android@11.0702}" },
    form: { isFirstInstall: "1", version: "android@11.0702", token_online: t },
  });
  if (["9999", "ECS99999"].includes(String(d?.code)) || !d?.ecs_token)
    throw new Error(d?.dsc || d?.msg || "token_online失效");
  return { phone: String(d.desmobile || ""), ecs: String(d.ecs_token) };
}
async function cloud(ctx, ecs) {
  const ua = "Dalvik/2.1.0;unicom{version:android@11.0702}",
    td = await ctx.requestJson(
      `https://m.client.10010.com/edop_ng/getTicketByNative?appId=edop_unicom_d67b3e30&token=${encodeURIComponent(ecs)}`,
      { headers: { "user-agent": ua } },
    ),
    ticket = td.ticket;
  if (!ticket) return { all: null, available: null };
  const t = Date.now(),
    seq = 123456 + Math.floor(Math.random() * 76543),
    sign = crypto.createHash("md5").update(`HandheldHallAutoLoginV2${t}${seq}wohome`).digest("hex"),
    dp = await ctx.requestJson("https://panservice.mail.wo.cn/wohome/dispatcher", {
      method: "POST",
      headers: { "user-agent": ua },
      json: {
        header: {
          key: "HandheldHallAutoLoginV2",
          resTime: String(t),
          reqSeq: seq,
          channel: "wohome",
          version: "",
          sign,
        },
        body: { clientId: "1001000003", ticket },
      },
    }),
    token = dp?.RSP?.DATA?.token;
  if (!token) return { all: null, available: null };
  const ut = await ctx.requestJson("https://panservice.mail.wo.cn/api-user/api/user/ticket", {
      method: "POST",
      headers: {
        "user-agent": ua,
        "x-yp-access-token": token,
        accesstoken: token,
        token,
        clientid: "1001000003",
        "x-yp-client-id": "1001000003",
        "source-type": "woapi",
        "app-type": "unicom",
      },
      json: {},
    }),
    userTicket = ut?.result?.ticket;
  if (!userTicket) return { all: null, available: null };
  const d = await ctx.requestJson("https://m.jf.10010.com/jf-external-application/jftask/userInfo", {
      method: "POST",
      headers: {
        ticket: userTicket,
        partnersid: "1649",
        origin: "https://m.jf.10010.com",
        clienttype: "yunpan_android",
        "x-requested-with": "com.sinovatech.unicom.ui",
      },
      json: {},
    }),
    x = d.data || {};
  return { all: x.allEarnScore ?? null, available: x.availableScore ?? null };
}
async function detail(ctx, x) {
  const o = await online(ctx, x.token_online),
    a = await uc.get(ctx, o.ecs),
    c = await cloud(ctx, o.ecs);
  return { ...o, a, c };
}
const rt = createAccountRuntime({
  title: "联通云盘",
  shortName: "联通云盘",
  prefix: "dd_ltyp",
  defaultEnvName: "chinaUnicomCookie",
  orderPrefix: "LTYP",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 token_online，支持 备注#token_online 和批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      let remark = "",
        token = line.trim();
      const i = line.indexOf("#");
      if (i > 0) {
        remark = line.slice(0, i);
        token = line.slice(i + 1);
      }
      const o = await online(ctx, token);
      rows.push({
        account: o.phone || crypto.createHash("md5").update(token).digest("hex").slice(0, 16),
        token: JSON.stringify({ token_online: token, ecs_token: o.ecs }),
        remark: remark || o.phone,
      });
    }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      d = await detail(ctx, x);
    x.ecs_token = d.ecs;
    await ctx.tokens.set(item.account, JSON.stringify(x));
    return `📱 手机：${d.phone}\n💰 话费红包：${d.a.tel}元\n🎯 联通积分：${d.a.score}（今日+${d.a.today}）\n☁️ 云盘已赚积分：${d.c.all ?? "--"}\n💎 云盘可用积分：${d.c.available ?? "--"}`;
  },
  async cronCheck(ctx, item) {
    const x = parse(item.token),
      d = await detail(ctx, x);
    x.ecs_token = d.ecs;
    await ctx.tokens.set(item.account, JSON.stringify(x));
    return `Token有效，话费红包${d.a.tel}元，联通积分${d.a.score}，云盘可用积分${d.c.available ?? "--"}`;
  },
  envValue(_c, i) {
    return parse(i.token).token_online;
  },
  tutorial:
    "抓包中国联通 App 的 token_online；插件自动换取 ecs_token，查询话费红包、联通积分和云盘积分，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`联通云盘执行失败：${e?.message || e}`));

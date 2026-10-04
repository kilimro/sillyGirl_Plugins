// [title: 大潮]
// [name: daChao]
// [desc: 大潮账号密码登录、积分查询、活动 member_token 与未领取红包链接、授权和青龙同步。]
// [author: rujingxianghai]
// [version: v1.4.0]
// [rule: raw ^(大潮|dc)(登录|登陆|查询|管理|红包推送|检测|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/大潮_v1.4_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js","./tmuyunAccountCore.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const tm = require("./tmuyunAccountCore.js");
function parse(x) {
  const i = String(x).indexOf("#");
  return { phone: String(x).slice(0, i), password: String(x).slice(i + 1) };
}
async function auth(ctx, t) {
  return tm.login(ctx, { ...t, tenant: "94", client: "10048" });
}
async function member(ctx, a) {
  const t = Math.floor(Date.now() / 1000),
    d = a.detail || {},
    signature = crypto
      .createHash("sha256")
      .update(` &id&mobile&nick_name&&${t}&&KO>N<O5&3^L1%23YH0H1#G91*2H`)
      .digest("hex"),
    body = {
      accountId: a.account,
      signature,
      mobile: "1",
      sessionId: a.session,
      login: "1",
      user: {
        realName: "",
        image_url: d.image_url || "",
        nick_name: d.nick_name || "",
        is_face_verify: 0,
        idcard: "",
        id: a.account,
      },
      timestamp: String(t),
      sign: "xsb_hn",
    },
    r = await ctx.requestJson("https://m.aihoge.com/api/memberhy/tm/signature", {
      method: "POST",
      headers: {
        "x-device-sign": "xsb_hn",
        "x-client-version": "1314",
        sessionid: a.session,
        accountid: a.account,
        "x-device-id": "000",
      },
      json: body,
    });
  if (!r?.token) throw new Error("member_token获取失败");
  return JSON.stringify({
    id: r.id || "",
    black: 0,
    btoken: r.btoken || "",
    expire: r.expire || "",
    token: r.token || "",
    source: "xsb_hn",
  });
}
async function redpacks(ctx, a) {
  const m = await member(ctx, a),
    d = await ctx.requestJson(
      "https://axh5.aihoge.com/api/lotteryhy/api/client/cj/member/prize/info?prize_type=3&page=1&count=20",
      {
        headers: {
          "x-device-sign": "xsb_hn",
          "x-client-version": "1314",
          member: m,
          sessionid: a.session,
          accountid: a.account,
          "x-device-id": "000",
          referer: "https://axh5.aihoge.com/winningList",
        },
      },
    );
  return (d?.data || [])
    .filter((x) => ![2, 6].includes(Number(x.status)))
    .map((x) => {
      let p = {};
      try {
        p = JSON.parse(x.prize_info || "{}");
      } catch {}
      return {
        amount: x.prize_content || "未知",
        expire: x.end_time
          ? new Date(x.end_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
          : "未知",
        activity: x.activity_name || "",
        link: `https://m.aihoge.com/lottery/rotor/drawRedPacket?CHECK_CODE=${p.code || ""}`,
      };
    });
}
const rt = createAccountRuntime({
  title: "大潮",
  shortName: "大潮",
  prefix: "s_dc",
  defaultEnvName: "DA_CHAO",
  orderPrefix: "DC",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const p = parse(line),
        a = await auth(ctx, p);
      rows.push({ account: a.account, token: line.trim(), remark: a.detail.nick_name || p.phone });
    }
    return rows;
  },
  async query(ctx, item) {
    const a = await auth(ctx, parse(item.token)),
      r = await redpacks(ctx, a);
    return `👤 昵称：${a.detail.nick_name || item.remark}\n📱 手机：${a.detail.mobile || parse(item.token).phone}\n💰 积分：${a.detail.total_integral ?? 0}\n🧧 未领取红包：${r.length}${r.length ? `\n${r.map((x, i) => `${i + 1}. ${x.amount}｜${x.expire}\n${x.link}`).join("\n")}` : ""}`;
  },
  async handle(ctx, c) {
    if (!/红包推送/.test(c)) return;
    const uid = await ctx.currentUserId(),
      as = JSON.parse(await ctx.users.get(uid, "[]"));
    for (const k of as) {
      const a = await auth(ctx, parse(await ctx.tokens.get(k, ""))),
        r = await redpacks(ctx, a);
      await ctx.sender.reply(
        `${await ctx.remarks.get(k, k)} 未领取红包 ${r.length} 个${r.length ? `\n${r.map((x) => `${x.amount} ${x.link}`).join("\n")}` : ""}`,
      );
    }
  },
  async cronCheck(ctx, item) {
    const a = await auth(ctx, parse(item.token)),
      r = await redpacks(ctx, a);
    return `账号有效，积分${a.detail.total_integral ?? 0}，未领取红包${r.length}个`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial: "输入大潮手机号#密码登录；查询积分与未领取红包，红包推送会返回领取链接，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`大潮执行失败：${e?.message || e}`));

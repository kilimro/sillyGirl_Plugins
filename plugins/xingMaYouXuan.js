// [title: 星妈优选]
// [name: xingMaYouXuan]
// [desc: 飞鹤星妈优选 Token 登录、会员积分查询、Token 刷新、签到和任务、授权及青龙同步。]
// [author: huawei / sky2022]
// [version: v1.2.0]
// [rule: raw ^(星妈|xing ?ma)(登录|登陆|查询|管理|一键运行|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/【插件】-星妈_v1.2.0_By.huawei.py;backup/星妈优选_v1.0.5_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const APPID = "xmyx",
  KEY = "TwUQ01lKS1Km5zlV2f7amsZc5EQYkTbv",
  BASE = "https://www.feihevip.com/api";
function nonce() {
  const a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: 16 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}
function sign(refresh = false) {
  const n = nonce(),
    t = Math.floor(Date.now() / 1000),
    id = refresh ? "xmh" : APPID,
    key = refresh ? "98d9fe9b613a479dbcb111ca261e3ce1" : KEY,
    body = refresh ? "" : "{}";
  return {
    fhAppid: id,
    fhNonceStr: n,
    fhTimestamp: String(t),
    fhSign: crypto
      .createHash("md5")
      .update(`fhAppid${id}fhNonceStr${n}fhTimestamp${t}${body}${key}`)
      .digest("hex")
      .toUpperCase(),
  };
}
function headers(token, refresh = false) {
  return {
    token,
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8) Mobile MicroMessenger/8.0.48",
    referer: "https://servicewechat.com/wx4205ec55b793245e/215/page-frame.html",
    source: "1",
    ...sign(refresh),
  };
}
async function get(ctx, token, path) {
  return ctx.requestJson(`${BASE}${path}`, { headers: headers(token) });
}
async function post(ctx, token, path) {
  return ctx.requestJson(`${BASE}${path}`, { method: "POST", headers: headers(token), json: {} });
}
async function info(ctx, token) {
  const d = await post(ctx, token, "/starMember/getMemberInfo");
  if (String(d?.code) !== "200" || !d.data) throw new Error(d?.msg || "Token失效");
  const b = d.data.baseInfo || {},
    p = d.data.memberPoints || {};
  return {
    raw: d.data,
    id: String(b.mobile || b.fullName || b.openId || ""),
    name: b.nickName || b.fullName || b.mobile || "星妈用户",
    points: p.scoreBalance ?? 0,
  };
}
async function refresh(ctx, token) {
  const d = await ctx.requestJson("https://mom.feihe.com/program/token/refreshToken", {
    headers: { ...headers(token, true), fhAppid: "xmh" },
  });
  return d?.data || token;
}
async function run(ctx, token) {
  const out = [],
    sd = await post(ctx, token, "/member/signin/sign");
  out.push(`签到：${String(sd?.code) === "200" ? "成功或已签到" : sd?.msg || "失败"}`);
  const td = await get(ctx, token, "/member/signin/getTaskList"),
    tasks = Array.isArray(td?.data) ? td.data : [];
  for (const t of tasks) {
    const name = t.taskName || t.name || "未知任务",
      type = t.taskType || t.type;
    if (!type || /购买任意商品/.test(name)) continue;
    await get(ctx, token, `/member/signin/tofinish?taskType=${encodeURIComponent(type)}`);
    await new Promise((r) => setTimeout(r, 1000));
    const d = await get(ctx, token, `/member/signin/completeTask?taskType=${encodeURIComponent(type)}`);
    out.push(
      `${name}：${String(d?.code) === "200" ? `完成${d?.data?.awardSendPoints ? ` +${d.data.awardSendPoints}分` : ""}` : d?.msg || "失败"}`,
    );
  }
  const u = await info(ctx, token);
  out.push(`当前积分：${u.points}`);
  return out;
}
const rt = createAccountRuntime({
  title: "星妈优选",
  shortName: "星妈",
  prefix: "G_xmyx",
  defaultEnvName: "XING_MA_YOU_XUAN",
  orderPrefix: "XMYX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入飞鹤星妈 token，支持换行批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/[\r\n,;|]+/).filter(Boolean)) {
      try {
        const token = await refresh(ctx, raw.trim()),
          u = await info(ctx, token);
        rows.push({ account: u.id, token, remark: u.name });
      } catch (e) {
        await ctx.sender.reply(`Token验证失败：${e?.message || e}`);
      }
    }
    return rows;
  },
  async query(ctx, item) {
    const token = await refresh(ctx, item.token);
    if (token !== item.token) await ctx.tokens.set(item.account, token);
    const u = await info(ctx, token);
    return `👤 用户：${u.name}\n📱 账号：${u.id}\n💰 积分：${u.points}`;
  },
  async handle(ctx, content) {
    if (!/一键运行/.test(content)) return;
    const uid = await ctx.currentUserId(),
      accounts = JSON.parse(await ctx.users.get(uid, "[]"));
    if (!accounts.length) return ctx.sender.reply("❌ 未找到星妈账号");
    for (const account of accounts) {
      const remark = await ctx.remarks.get(account, account);
      try {
        const token = await refresh(ctx, await ctx.tokens.get(account, ""));
        await ctx.tokens.set(account, token);
        await ctx.sender.reply(
          `=====星妈运行=====\n👤 ${remark}\n${(await run(ctx, token)).join("\n")}\n==================`,
        );
      } catch (e) {
        await ctx.sender.reply(`❌ ${remark}：${e?.message || e}`);
      }
    }
  },
  async cronCheck(ctx, item) {
    const token = await refresh(ctx, item.token);
    if (token !== item.token) await ctx.tokens.set(item.account, token);
    return (await run(ctx, token)).join("\n");
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial: "抓包飞鹤星妈小程序请求头 token；登录后可查询积分，一键运行签到与每日任务，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`星妈优选执行失败：${e?.message || e}`));

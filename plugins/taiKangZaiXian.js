// [title: 泰康在线]
// [name: taiKangZaiXian]
// [desc: 泰康在线 unionid 批量绑定、实名/金币/红包查询、每日签到、授权及青龙同步。]
// [author: mrconli]
// [version: v1.5.0]
// [rule: raw ^泰康(登录|登陆|上车|查询|管理|签到|授权|清理|教程)$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/泰康在线_v1.5.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.25";
function h(url) {
  return {
    host: new URL(url).host,
    connection: "keep-alive",
    "user-agent": UA,
    referer: "https://servicewechat.com/wx9e3e7020c4a10356/185/page-frame.html",
    "content-type": "application/x-www-form-urlencoded",
  };
}
async function form(ctx, url, data) {
  return ctx.requestJson(url, {
    method: "POST",
    headers: h(url),
    form: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v])),
  });
}
async function user(ctx, unionid) {
  const d = await form(ctx, "https://m.tk.cn/member_api/", {
    api_s: "member.userbind",
    api_m: "selectwxbindbybindid",
    params: { platform: "APPLET", fromid: "71672", bindid: unionid },
  });
  if (d?.result !== "success" || !d?.data?.memberid) throw new Error(d?.message || "unionid失效");
  const p = d.data.pmemberuser || {};
  return {
    memberid: String(d.data.memberid),
    token: d.data.token,
    mobile: String(p.membertmmobile || ""),
    name: p.membertmrealname || "",
  };
}
async function mainPage(ctx, u) {
  const d = await form(ctx, "https://m.tk.cn/activity_execute/rest/membergoldbean/mainPage", {
    enc: false,
    memberid: u.memberid,
    token: u.token,
    platform: "WECHAT",
    fromid: "71672",
  });
  if (![0, "0"].includes(d?.error_code)) throw new Error(d?.error_message || d?.message || "金币查询失败");
  return d?.data?.allbeans ?? 0;
}
async function coupon(ctx, u, status) {
  const d = await form(ctx, "https://m.tk.cn/member_api/", {
    api_s: "member.coupon",
    api_m: "selectmembercouponlist",
    params: { memberid: u.memberid, token: u.token, status: String(status), fromid: "67527" },
  });
  return d?.result === "success" ? d?.data?.pmembercoupon || [] : [];
}
async function sign(ctx, unionid, u) {
  const d = await form(ctx, "https://m.tk.cn/activity_execute/rest/membergoldbean/sign", {
    enc: false,
    memberid: u.memberid,
    token: u.token,
    unionid,
    deviceId: "",
    fromid: "71672",
    platform: "WECHAT",
    coordinate: "",
    nickName: "",
  });
  if ([0, "0"].includes(d?.error_code)) return `签到成功，获得${d?.data?.amount ?? 0}积分`;
  if (String(d?.error_code) === "200004200003") return "今日已完成签到";
  throw new Error(d?.error_message || d?.message || d?.msg || "签到失败");
}
const rt = createAccountRuntime({
  title: "泰康在线",
  shortName: "泰康",
  prefix: "mrconli.taikang",
  defaultEnvName: "mrconli_tkzx",
  orderPrefix: "TKZX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入unionid，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const unionid of input
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean))
      try {
        const u = await user(ctx, unionid);
        rows.push({ account: u.memberid, token: unionid, remark: u.mobile || u.name || u.memberid });
      } catch (e) {
        await ctx.sender.reply(`泰康登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const u = await user(ctx, item.token),
      [beans, pending, used] = await Promise.all([mainPage(ctx, u), coupon(ctx, u, 1), coupon(ctx, u, 2)]),
      total = used.reduce((n, x) => n + Number(x.inventoryvalue || 0), 0),
      p = pending
        .slice(0, 5)
        .map((x) => `${x.couponname || "红包"} ${x.inventoryvalue || 0}元 至${x.voiddateend || ""}`);
    return `📱 手机：${ctx.mask(u.mobile)}\n👤 实名：${u.name ? `**${u.name.slice(-1)}` : "***"}\n💰 金币：${beans}\n🍀 待领红包：${pending.length}个\n${p.join("\n")}\n🍃 已领：${used.length}个，共${total.toFixed(2)}元`;
  },
  async cronCheck(ctx, item) {
    const u = await user(ctx, item.token);
    return `${await sign(ctx, item.token, u)}\n当前金币：${await mainPage(ctx, u)}`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====泰康在线教程=====\n抓包泰康在线小程序 https://m.tk.cn/wechat_item/rest/xcx/login，复制响应 unionid。\n支持批量换行登录；查询实名、金币、待领/已领红包，每日自动签到。\n授权后同步青龙变量 mrconli_tkzx。\n指令：泰康登录、查询、管理、签到、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`泰康在线执行失败：${e?.message || e}`));

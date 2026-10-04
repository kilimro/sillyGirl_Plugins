// [title: 福田e家]
// [name: fuTianEJia]
// [desc: 福田e家账号密码登录、会员积分/今日积分/订单查询、授权及青龙同步。]
// [author: sky2022]
// [version: v5.0.0]
// [rule: raw ^福田(登录|登陆|查询|管理|订单|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/福田e家_v5.0_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://czyl.foton.com.cn/ehomes-new/homeManager";
function parse(x) {
  const i = String(x).indexOf("#");
  return { user: String(x).slice(0, i), pass: String(x).slice(i + 1) };
}
async function login(ctx, user, pass) {
  const d = await ctx.requestJson(`${BASE}/getLoginMember`, {
    method: "POST",
    headers: { "user-agent": "okhttp/3.14.9", "content-type": "application/json" },
    json: { password: pass, name: user },
  });
  if (!d?.data?.memberID) throw new Error(d?.msg || "登录失败");
  return { account: String(d.data.uid), memberId: String(d.data.memberID), mobile: user, data: d.data };
}
async function assets(ctx, id) {
  const h = { "user-agent": "web", "content-type": "application/json" },
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    [a, b] = await Promise.all([
      ctx.requestJson(`${BASE}/api/Member/findMemberPointsInfo`, {
        method: "POST",
        headers: h,
        json: { memberId: id },
      }),
      ctx.requestJson(`${BASE}/api/Member/getIntegralList`, {
        method: "POST",
        headers: h,
        json: { memberId: id, transactionDate: today },
      }),
    ]),
    x = a?.data,
    points = Number(typeof x === "object" ? (x.pointValue ?? x.points ?? x.point) : x) || 0,
    gain = (Array.isArray(b?.data) ? b.data : [])
      .filter((y) => String(y.date || y.createTime || "").slice(0, 10) === today)
      .reduce((n, y) => n + Number(y.integral || 0), 0);
  return { points, today: gain };
}
async function orders(ctx, u) {
  const d = await ctx.requestJson(`${BASE}/api/other/foton365MyOrders`, {
    method: "POST",
    headers: {
      "user-agent": "web",
      "app-key": "7918d2d1a92a02cbc577adb8d570601e72d3b640",
      "app-token": "58891364f56afa1b6b7dae3e4bbbdfbfde9ef489",
      "content-type": "application/json; charset=utf-8",
      token: "",
    },
    json: {
      memberId: u.memberId,
      userId: u.account,
      userType: "61",
      uid: u.account,
      mobile: u.mobile,
      tel: u.mobile,
      phone: u.mobile,
      brandName: "萨普",
      seriesName: "萨普T",
      token: "ebf76685e48d4e14a9de6fccc76483e3",
      safeEnc: Date.now(),
      businessId: 1,
      pageNum: 1,
      pageSize: 10,
    },
  });
  if (Number(d?.code) !== 200) throw new Error(d?.msg || "订单查询失败");
  return d.data || { items: [], total: 0 };
}
const rt = createAccountRuntime({
  title: "福田e家",
  shortName: "福田",
  prefix: "dd_fukuda",
  defaultEnvName: "FOTON_TOKEN",
  orderPrefix: "FOTON",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const p = parse(line),
        u = await login(ctx, p.user, p.pass);
      rows.push({ account: u.account, token: line.trim(), remark: p.user, extra: { member: u.memberId } });
    }
    return rows;
  },
  async query(ctx, item) {
    const p = parse(item.token),
      u = await login(ctx, p.user, p.pass),
      a = await assets(ctx, u.memberId),
      o = await orders(ctx, u);
    const list = (o.items || [])
      .slice(0, 5)
      .map(
        (x, i) =>
          `${i + 1}. ${(x.productList?.[0]?.name || "未知商品").slice(0, 24)}｜${x.orderStatusName || "未知状态"}｜${String(x.orderCreateTime || "").slice(0, 16)}`,
      );
    return `📱 账号：${p.user}\n🎯 总积分：${a.points}\n📈 今日积分：${a.today}\n📦 订单总数：${o.total ?? list.length}${list.length ? `\n${list.join("\n")}` : ""}`;
  },
  async handle(ctx, content) {
    if (!/订单/.test(content)) return;
    const uid = await ctx.currentUserId(),
      accounts = JSON.parse(await ctx.users.get(uid, "[]"));
    if (!accounts.length) return ctx.sender.reply("❌ 未找到福田账号");
    for (const account of accounts) {
      const p = parse(await ctx.tokens.get(account, "")),
        u = await login(ctx, p.user, p.pass),
        o = await orders(ctx, u);
      await ctx.sender.reply(
        `=====福田订单=====\n${(o.items || []).map((x, i) => `${i + 1}. ${x.productList?.[0]?.name || "未知商品"}｜${x.orderStatusName || "未知状态"}｜${x.orderNumber || ""}`).join("\n") || "暂无订单"}\n==================`,
      );
    }
  },
  async cronCheck(ctx, item) {
    const p = parse(item.token),
      u = await login(ctx, p.user, p.pass),
      a = await assets(ctx, u.memberId);
    return `账号有效，总积分${a.points}，今日+${a.today}`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial: "发送福田登录，输入 手机号#密码；可查询会员积分、今日积分及订单，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`福田e家执行失败：${e?.message || e}`));

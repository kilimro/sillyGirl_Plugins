// [title: 新江北]
// [name: xinJiangBei]
// [desc: 新江北账号密码登录、积分查询、支付宝实名信息、兑吧红包明细、授权及青龙同步。]
// [author: rujingxianghai]
// [version: v1.1.3]
// [rule: raw ^新江北(登录|登陆|查询|管理|红包|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/新江北_v1.1.3_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js","./tmuyunAccountCore.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const tm = require("./tmuyunAccountCore.js");
function parse(x) {
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
async function auth(ctx, x) {
  return tm.login(ctx, { phone: x.phone, password: x.password, tenant: "102", client: "10050" });
}
async function records(ctx, a) {
  const redirect = encodeURIComponent(
      "https://92261.activity-14.m.duiba.com.cn/hdtool/index?id=299402208083641&dbnewopen",
    ),
    d = await ctx.requestJson(
      `https://92261.activity-42.m.duiba.com.cn/customActivity/zjtm/autoLogin?_=${Date.now()}&sessionId=${encodeURIComponent(a.session)}&accountId=${encodeURIComponent(a.account)}&redirectUrl=${redirect}`,
      {
        headers: {
          "user-agent": "Mozilla/5.0 Android WebView;xsb_xinjiangbei;1.7.0;native_app;6.9.0",
          "x-requested-with": "io.pailian.jiangbei",
        },
      },
    );
  if (!d?.success || !d.data) throw new Error("兑吧自动登录失败");
  const u = String(d.data).startsWith("//") ? "https:" + d.data : d.data,
    r = await ctx.request(u, { headers: { "user-agent": "Mozilla/5.0 Android WebView" } }),
    set =
      typeof r.headers.getSetCookie === "function"
        ? r.headers.getSetCookie().join(";")
        : r.headers.get("set-cookie") || "",
    cookie = set
      .split(/,(?=\s*[^;,=]+=[^;,]+)/)
      .map((x) => x.split(";")[0])
      .join("; "),
    z = await ctx.requestJson(`https://92261.activity-14.m.duiba.com.cn/crecord/getrecord?page=1&_=${Date.now()}`, {
      headers: {
        cookie,
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json",
        "user-agent": "Mozilla/5.0 Android WebView",
        referer: "https://92261.activity-14.m.duiba.com.cn/crecord/record?dbnewopen&dpm=92261.3.2.0",
      },
    });
  if (!z?.success) throw new Error(z?.message || "红包明细失败");
  return z.data?.records || z.data?.list || z.records || [];
}
function fmt(rs) {
  let sum = 0,
    n = 0;
  const lines = rs.slice(0, 10).map((x) => {
    const m = String(x.title || "").match(/(?:充值)?([\d.]+)元/),
      a = Number(m?.[1] || 0),
      ok = String(x.statusText || "").includes("成功");
    if (ok) {
      sum += a;
      n++;
    }
    return `${ok ? "🧧" : "❌"} ${a.toFixed(2)}元 ${x.gmtCreate || ""}`;
  });
  return `${lines.join("\n") || "🧧 暂无红包明细"}\n✅ 成功提现：${n}笔\n💰 累计金额：${sum.toFixed(2)}元`;
}
const rt = createAccountRuntime({
  title: "新江北",
  shortName: "新江北",
  prefix: "s_xjb",
  defaultEnvName: "XIN_JIANG_BEI",
  orderPrefix: "XJB",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码#支付宝姓名（姓名可省略），支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const [phone, password, alipay = ""] = line.split("#"),
        x = { phone, password, alipay },
        a = await auth(ctx, x);
      rows.push({ account: a.account, token: JSON.stringify(x), remark: a.detail.nick_name || phone });
    }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      a = await auth(ctx, x),
      rs = await records(ctx, a);
    return `👤 昵称：${a.detail.nick_name || item.remark}\n📱 手机：${a.detail.mobile || x.phone}\n💰 积分：${a.detail.total_integral ?? 0}${x.alipay ? `\n💳 支付宝姓名：${x.alipay}` : ""}\n${fmt(rs)}`;
  },
  async handle(ctx, c) {
    if (!/红包/.test(c)) return;
    const uid = await ctx.currentUserId(),
      as = JSON.parse(await ctx.users.get(uid, "[]"));
    for (const k of as) {
      const a = await auth(ctx, parse(await ctx.tokens.get(k, "{}")));
      await ctx.sender.reply(`=====新江北红包=====\n${fmt(await records(ctx, a))}\n==================`);
    }
  },
  async cronCheck(ctx, item) {
    const a = await auth(ctx, parse(item.token)),
      rs = await records(ctx, a);
    return `账号有效，积分${a.detail.total_integral ?? 0}，红包记录${rs.length}条`;
  },
  envValue(_c, i) {
    const x = parse(i.token);
    return `${x.phone}#${x.password}#${x.alipay || ""}`;
  },
  tutorial: "输入 手机号#密码#支付宝实名姓名；查询积分和兑吧红包明细，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`新江北执行失败：${e?.message || e}`));

// [title: 东方财富]
// [name: dongFangCaiFu]
// [desc: 东方财富账号密码登录、CToken/UToken 资产查询、红包余额流水、授权及青龙同步。]
// [author: rujingxianghai]
// [version: v1.4.0]
// [rule: raw ^东方(登录|登陆|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/东方财富_v1.4_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
function device() {
  return crypto.randomBytes(16).toString("hex");
}
function parse(x) {
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
function loginHeaders(id, gt) {
  const md = Buffer.from(id).toString("base64");
  return {
    accept: "application/json",
    "em-clt-uiid": crypto.randomUUID(),
    "em-clt-auth": "202107280688;qXU2bhqAdsux+eTFLOqWgXwz8GJyfhX/ejnm0eJ9aMc=",
    "qgqp-b-id": gt,
    "em-os": "Android",
    "em-pkg": "com.eastmoney.android.berlin",
    "em-ver": "10.28.1",
    "em-gt": gt,
    "em-md": md,
    "em-chl": "xiaomi22_64",
    "em-gv": "3f4605b67",
    "content-type": "application/json",
    "user-agent": "okhttp/3.12.13",
  };
}
async function login(ctx, account, password) {
  const id = device(),
    gt = "ceab-" + crypto.randomBytes(16).toString("hex").slice(0, 31),
    h = loginHeaders(id, gt),
    d = await ctx.requestJson("https://awebapi2-account.eastmoney.com/core/api/MPassport/LoginMobileV4", {
      method: "POST",
      headers: h,
      json: {
        AppId: "202107280688",
        UniqueId: crypto.randomUUID(),
        ProductType: "DFCFT",
        Version: "10.28.1",
        DeviceType: "Android15",
        DomainName: "EastMoneyApp",
        DeviceModel: "2210132C",
        DeviceAlias: "",
        ScenarioId: "202003257918",
        Account: account,
        Password: crypto.createHash("md5").update(password).digest("hex"),
      },
    });
  if (String(d?.ReturnCode) !== "0") throw new Error(d?.Msg || `登录失败(${d?.ReturnCode || "未知"})`);
  const x = d.Data || {};
  if (!x.UID || !x.CToken || !x.UToken) throw new Error("登录返回Token不完整");
  return {
    UID: String(x.UID),
    CToken: x.CToken,
    UToken: x.UToken,
    "EM-MD": Buffer.from(id).toString("base64"),
    GToken: gt,
    DeviceID: id,
    Alias: x.Alias || account,
    UpdateTime: Math.floor(Date.now() / 1000),
  };
}
function qh(x) {
  return {
    ctoken: x.CToken,
    utoken: x.UToken,
    "em-os": "Android",
    "em-ver": "10.37.1",
    appkey: "EIBnBlYuvK",
    "em-md": x["EM-MD"],
    origin: "https://vipmoney.eastmoney.com",
    "x-requested-with": "com.eastmoney.android.berlin",
    referer: "https://vipmoney.eastmoney.com/",
    "user-agent": "Mozilla/5.0 Android WebView;eastmoney_android",
  };
}
async function query(ctx, x) {
  const h = qh(x),
    [a, b] = await Promise.all([
      ctx.requestJson("https://empointcpf.eastmoney.com/cashredpackets/Cash/balance?v=0723667712619922", {
        headers: h,
      }),
      ctx.requestJson("https://empointcpf.eastmoney.com/cashredpackets/cash/flows?pageIndex=1&pageSize=20", {
        headers: h,
      }),
    ]);
  if (Number(a?.result) !== 1) throw new Error(a?.message || "余额查询失败");
  return { balance: a.data ?? 0, flows: Number(b?.result) === 1 ? b.data || [] : [] };
}
const rt = createAccountRuntime({
  title: "东方财富",
  shortName: "东方",
  prefix: "s_dfcf",
  defaultEnvName: "DONG_FANG_CAI_FU",
  orderPrefix: "DFCF",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const i = line.indexOf("#"),
        x = await login(ctx, line.slice(0, i), line.slice(i + 1));
      rows.push({ account: x.UID, token: JSON.stringify(x), remark: x.Alias });
    }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      d = await query(ctx, x),
      f = d.flows
        .slice(0, 5)
        .map(
          (y) => `${Number(y.FlowType) === 1 ? "💵 +" : "💸 -"}${Number(y.Amount || 0).toFixed(2)} ${y.FlowTime || ""}`,
        );
    return `👤 用户：${x.Alias}\n📱 UID：${x.UID}\n🧧 红包余额：${d.balance}${f.length ? `\n${f.join("\n")}` : ""}`;
  },
  async cronCheck(ctx, item) {
    const d = await query(ctx, parse(item.token));
    return `Token有效，红包余额${d.balance}，流水${d.flows.length}条`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial: "输入东方财富手机号#密码登录；查询红包余额及最近流水，授权后将完整 CToken/UToken/EM-MD 数据同步青龙。",
});
rt.main().catch((e) => s.reply(`东方财富执行失败：${e?.message || e}`));

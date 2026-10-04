// [title: 小快手]
// [name: xiaoKuaiShou]
// [desc: 快手普通版/极速版CK校验、金币现金余额与今日收益查询]
// [author: linzixuan]
// [version: v5.3.0]
// [rule: ^快手(登录|登陆|查询|管理|教程|授权|清理)?$]
// [cron: 40 18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/小快手_v5.2.5_By.linzixuan.py;backup/小快手测试_v5.0_By.linzixuan.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
function cookies(v) {
  const out = {};
  for (const p of String(v).split(";")) {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
}
function parse(v) {
  const p = String(v).split("#");
  if (p.length < 4 || !["1", "2"].includes(p[0])) throw new Error("凭证格式应为 版本#备注#Cookie#Salt，可追加#代理");
  return { version: p[0], name: p[1], cookie: p[2], salt: p[3], proxy: p.slice(4).join("#") };
}
function mask(v) {
  return String(v).length > 8 ? `${String(v).slice(0, 4)}****${String(v).slice(-4)}` : String(v);
}
async function get(ctx, url, cookie, normal = false) {
  return ctx.requestJson(url, {
    headers: {
      "user-agent": normal ? "kwai-android aegon/4.27.0" : "kwai-android aegon/4.29.0",
      cookie,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
  });
}
async function verify(ctx, a) {
  if (a.version === "1") {
    a.cookie = a.cookie.replace(/kpn=KUAISHOU/g, "kpn=NEBULA");
    const r = await get(
      ctx,
      "https://nebula.kuaishou.com/rest/n/nebula/activity/earn/overview/basicInfo?source=bottom_guide_first",
      a.cookie,
    );
    if (Number(r?.result) !== 1 || !r?.data) throw new Error("极速版CK验证失败");
    return { nickname: r.data?.userData?.nickname || a.name, coin: r.data.totalCoin || 0, cash: r.data.allCash || 0 };
  }
  a.cookie = a.cookie.replace(/kpn=NEBULA/g, "kpn=KUAISHOU");
  const r = await get(ctx, "https://encourage.kuaishou.com/rest/wd/encourage/account/basicInfo", a.cookie, true);
  if (Number(r?.result) !== 1 || !r?.data) throw new Error("普通版CK验证失败");
  return {
    nickname: r.data?.userData?.nickname || a.name,
    coin: r.data.coinAmount || 0,
    cash: r.data.cashAmountDisplay || 0,
  };
}
function todayFast(list) {
  const now = new Date(),
    key = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
  return list.reduce(
    (n, x) => (String(x.createTime || "").startsWith(key) && Number(x.amount) > 0 ? n + Number(x.amount) : n),
    0,
  );
}
function todayNormal(list) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return list.reduce(
    (n, x) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Number(x.createTime))) === day &&
      x.direction === "IN" &&
      Number(x.displayAmount) > 0
        ? n + Number(x.displayAmount)
        : n,
    0,
  );
}
async function details(ctx, a) {
  if (a.version === "1") {
    a.cookie = a.cookie.replace(/kpn=KUAISHOU/g, "kpn=NEBULA");
    const r = await get(ctx, "https://nebula.kuaishou.com/rest/n/nebula/account/overview", a.cookie);
    if (Number(r?.result) !== 1 || !r?.data) throw new Error("极速版账户详情查询失败");
    const coin = r.data.coinAccountPage?.data || [],
      cash = r.data.cashAccountPage?.data || [];
    return {
      nickname: a.name,
      coin: r.data.coinBalance || 0,
      cash: r.data.cashBalance || 0,
      totalCash: r.data.accumulativeAmount || 0,
      today: todayFast(coin),
      coinRecords: coin.slice(0, 5),
      cashRecords: cash.slice(0, 3),
    };
  }
  a.cookie = a.cookie.replace(/kpn=NEBULA/g, "kpn=KUAISHOU");
  const [basic, coin, cash] = await Promise.all([
    get(ctx, "https://encourage.kuaishou.com/rest/wd/encourage/account/basicInfo", a.cookie, true),
    get(
      ctx,
      "https://encourage.kuaishou.com/rest/wd/encourage/account/detail?sigCatVer=1&accountType=coin&cursor",
      a.cookie,
      true,
    ),
    get(
      ctx,
      "https://encourage.kuaishou.com/rest/wd/encourage/account/detail?sigCatVer=1&accountType=cash&cursor",
      a.cookie,
      true,
    ),
  ]);
  if (Number(basic?.result) !== 1) throw new Error("普通版账户详情查询失败");
  const coins = coin?.data?.datas || [],
    cashs = cash?.data?.datas || [];
  return {
    nickname: basic.data?.userData?.nickname || a.name,
    coin: basic.data?.coinAmount || 0,
    cash: basic.data?.cashAmountDisplay || 0,
    totalCash: "",
    today: todayNormal(coins),
    coinRecords: coins.slice(0, 5),
    cashRecords: cashs.slice(0, 3),
  };
}
const rt = createAccountRuntime({
  title: "小快手",
  shortName: "快手",
  prefix: "dd_ks",
  defaultEnvName: "ksjsb",
  orderPrefix: "KS",
  requireAuthForQuery: false,
  async login(ctx) {
    const v = await ctx.prompt(ctx.sender, "选择版本：[1]极速版 [2]普通版", 120000);
    if (!["1", "2"].includes(v)) throw new Error("版本选择无效");
    const raw = await ctx.prompt(ctx.sender, "请输入 备注#Cookie#Salt，可在末尾追加#代理；支持多行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const a = parse(`${v}#${line}`),
        p = await verify(ctx, a),
        uid = cookies(a.cookie).userId;
      if (!uid) throw new Error("Cookie缺少userId");
      out.push({ account: `${v}:${uid}`, token: `${v}#${line}`, remark: p.nickname });
    }
    return out;
  },
  async query(ctx, item) {
    const a = parse(item.token),
      d = await details(ctx, a),
      uid = cookies(a.cookie).userId || item.account;
    return `📦 版本：${a.version === "1" ? "极速版" : "普通版"}\n👤 昵称：${d.nickname}\n🆔 UID：${mask(uid)}\n🪙 金币：${d.coin}\n💵 现金：${d.cash}${d.totalCash !== "" ? `\n📊 累计现金：${d.totalCash}` : ""}\n📈 今日金币：${d.today}${d.coinRecords.length ? `\n📜 最近金币：\n${d.coinRecords.map((x) => `${x.title || x.bizDesc || x.desc || "变动"} ${x.amount ?? x.displayAmount ?? ""}`).join("\n")}` : ""}`;
  },
  async cronCheck(ctx, item) {
    const d = await details(ctx, parse(item.token));
    return `账号有效，金币${d.coin}，现金${d.cash}，今日金币${d.today}`;
  },
  envValue(_c, i) {
    const a = parse(i.token);
    return `${a.name}#${a.cookie}#${a.salt}${a.proxy ? `#${a.proxy}` : ""}`;
  },
  tutorial:
    "快手登录先选极速版/普通版，再提交备注#Cookie#Salt（可追加代理）。查询会显示金币、现金、今日收益和最近明细。",
});
rt.main().catch((e) => s.reply(`快手执行失败：${e?.message || e}`));

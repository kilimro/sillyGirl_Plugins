// [title: 老中医助手]
// [name: laoZhongYiZhuShou]
// [desc: 老中医 Authorization/app-sign 批量绑定、账户余额与提现记录查询、授权及面板同步。]
// [author: 8165799]
// [version: v1.1.0]
// [rule: raw ^老中医(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 5 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/老中医助手_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://dt.yuanhukj.com/api/mobile";
function parse(v) {
  const p = String(v || "").split("#");
  return { auth: String(p[0] || "").replace(/^Bearer\s+/i, ""), appSign: p.slice(1).join("#") };
}
function headers(x) {
  return {
    host: "dt.yuanhukj.com",
    connection: "keep-alive",
    authorization: `Bearer ${x.auth}`,
    "app-sign": x.appSign,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
    xweb_xhr: "1",
    "content-type": "application/x-www-form-urlencoded",
    accept: "*/*",
    referer: `https://servicewechat.com/${x.appSign}/2/page-frame.html`,
  };
}
const qs = "source_type=2314&source_from=2321&source_lang=zh_CN&currency_id=86&site_id=";
async function info(ctx, x) {
  const d = await ctx.requestJson(`${BASE}/account/user/overview_my?${qs}`, { headers: headers(x) });
  if (Number(d?.code) !== 0) throw new Error(d?.msg || "Token无效");
  const u = d.data || {},
    phone = String(u.user_id || "");
  if (!phone) throw new Error("未获取用户ID");
  const c = await ctx.requestJson(`${BASE}/pay/index/consumeRecord?${qs}&change_type=0&page=1&rows=2`, {
      headers: headers(x),
    }),
    records = (c?.data?.items || []).map((i) => `${i.record_total}元 (${i.record_time})`);
  return { phone, money: u.user_money ?? 0, frozen: u.user_money_frozen ?? 0, records };
}
const rt = createAccountRuntime({
  title: "老中医助手",
  shortName: "老中医",
  prefix: "dd_lzy",
  defaultEnvName: "sx_qytm",
  orderPrefix: "LZY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：备注#Authorization#app-sign，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.split("#"),
          remark = p.length > 2 ? p.shift() : "",
          x = parse(p.join("#"));
        if (x.auth.length < 20 || !/^wx/.test(x.appSign)) throw new Error("Authorization或app-sign格式错误");
        const d = await info(ctx, x);
        rows.push({
          account: d.phone,
          token: `${x.auth}#${x.appSign}`,
          remark: remark || `老中医_${ctx.mask(d.phone)}`,
        });
      } catch (e) {
        await ctx.sender.reply(`老中医登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const d = await info(ctx, parse(item.token));
    return `📱 用户ID：${ctx.mask(d.phone)}\n💰 可用余额：${d.money}\n🧊 冻结余额：${d.frozen}\n📜 最近提现：\n${d.records.join("\n") || "暂无提现记录"}`;
  },
  async cronCheck(ctx, item) {
    try {
      const d = await info(ctx, parse(item.token));
      return `Token有效，可用余额${d.money}，冻结${d.frozen}`;
    } catch (_) {
      return "老中医Token已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====老中医助手教程=====\n抓包 dt.yuanhukj.com 请求，复制 Authorization 和 app-sign。\n登录格式：备注#Authorization#app-sign；查询余额、冻结金额和最近提现记录。\n授权后同步面板变量 sx_qytm。\n指令：老中医登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`老中医执行失败：${e?.message || e}`));

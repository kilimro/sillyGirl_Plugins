// [title: 伊利QQ星]
// [name: yiLiQqXing]
// [desc: 伊利QQ星 AuthKey 绑定、会员资料/等级/积分查询、授权及青龙同步。]
// [author: 8165799]
// [version: v1.1.0]
// [rule: raw ^伊利QQ星(登录|登陆|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/伊利QQ星_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const APP = "wx650bdff059f63f5b",
  URL = "https://mall.yili.com/MAMAIF/MCSWSIAPI.asmx/Call";
function key(x) {
  let s = String(x || "").trim();
  if (s.includes("#")) s = s.split("#").filter(Boolean).at(-1);
  try {
    const j = JSON.parse(s);
    s = j.auth_key || j.AuthKey || s;
  } catch {}
  return s.match(/(?:AuthKey|auth_key)\s*[:=]\s*"?([0-9a-f-]{32,64})/i)?.[1] || s;
}
async function call(ctx, k, method, params = "") {
  const payload = {
      DeviceCode: APP,
      AuthKey: k || "0".repeat(36),
      Method: method,
      Params: typeof params === "string" ? params : JSON.stringify(params),
    },
    r = await ctx.request(URL, {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 MicroMessenger MiniProgramEnv/Windows",
        "content-type": "application/x-www-form-urlencoded",
        referer: `https://servicewechat.com/${APP}/162/page-frame.html`,
      },
      form: { RequestPack: JSON.stringify(payload) },
    });
  let t = r.text.trim(),
    m = t.match(/<string[^>]*>([\s\S]*?)<\/string>/i);
  if (m)
    t = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  const d = JSON.parse(t);
  if (typeof d.Result === "string")
    try {
      d.Result = JSON.parse(d.Result);
    } catch {}
  return d;
}
async function info(ctx, k) {
  const d = await call(ctx, k, "MemberService.GetMyMemberInfo");
  if (Number(d?.Return) !== 0) throw new Error(`AuthKey无效或已过期：${d?.Return}`);
  const i = d.Result || {},
    p = await call(ctx, k, "PointsService.GetPointsBalance").catch(() => ({})),
    x = Number(p?.Return) === 0 && typeof p.Result === "object" ? p.Result : {};
  return {
    id: String(i.ID || crypto.createHash("md5").update(k).digest("hex").slice(0, 10)),
    name: i.RealName || i.NickName || "伊利QQ星用户",
    level: i.MemberLevelName || "未知",
    points: x.Points ?? i.PointsBalance ?? 0,
  };
}
const rt = createAccountRuntime({
  title: "伊利QQ星",
  shortName: "伊利QQ星",
  prefix: "yiliqqx",
  defaultEnvName: "YILI_QQX_AUTHKEY",
  orderPrefix: "YLQQX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 AuthKey，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean)) {
      const k = key(raw),
        u = await info(ctx, k);
      rows.push({ account: u.id, token: k, remark: u.name });
    }
    return rows;
  },
  async query(ctx, item) {
    const u = await info(ctx, key(item.token));
    return `👤 昵称：${u.name}\n🏅 等级：${u.level}\n💰 积分：${u.points}\n🆔 会员ID：${u.id}`;
  },
  async cronCheck(ctx, item) {
    const u = await info(ctx, key(item.token));
    return `AuthKey有效，等级${u.level}，积分${u.points}`;
  },
  envValue(_c, i) {
    return key(i.token);
  },
  tutorial: "抓包伊利QQ星小程序 RequestPack 中的 AuthKey；绑定后查询会员资料、等级及积分，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`伊利QQ星执行失败：${e?.message || e}`));

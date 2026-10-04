// [title: 店铛铛]
// [name: dianDangDang]
// [desc: 店铛铛手机号密码批量登录、贡献值/兑换值/广告进度和贡献明细查询、授权、青龙同步与账号管理。]
// [author: rujingxianghai]
// [version: v1.3.1]
// [rule: raw ^店铛铛(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 8 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/店铛铛_v1.3_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://gw.jiudageapp.com",
  VERSION = "1.5.6";
function md5(v) {
  return crypto.createHash("md5").update(String(v)).digest("hex");
}
function parseCred(v) {
  const i = String(v).indexOf("#");
  if (i <= 0) throw new Error("格式应为手机号#密码");
  const phone = String(v).slice(0, i),
    password = String(v).slice(i + 1);
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error("手机号格式错误");
  return { phone, password };
}
function headers(token = "") {
  const h = {
    host: "gw.jiudageapp.com",
    version: `v${VERSION}`,
    platform: "Android",
    "user-agent": "okhttp/4.10.0",
    "accept-encoding": "gzip",
    "content-type": "application/json",
  };
  if (token) h.authorization = token;
  return h;
}
async function login(ctx, c) {
  const d = await ctx.requestJson(`${BASE}/api/web/auth/pwdLogin`, {
    method: "POST",
    headers: headers(),
    json: { phone: c.phone, password: md5(c.password) },
  });
  if (Number(d?.code) !== 200 || !d?.result?.token) throw new Error(d?.message || "登录失败");
  const token = d.result.token,
    m = await ctx.requestJson(`${BASE}/api/web/member/getMemberInfo`, {
      method: "POST",
      headers: headers(token),
      json: {},
    });
  if (Number(m?.code) !== 200) throw new Error(m?.message || "获取会员信息失败");
  return { token, member: m.result || {} };
}
async function details(ctx, token) {
  const center = await ctx.requestJson(`${BASE}/api/web/member/getMemberCenterInfo`, {
    method: "POST",
    headers: headers(token),
    json: {},
  });
  if (Number(center?.code) !== 200) throw new Error(center?.message || "会员中心查询失败");
  const rec = await ctx
    .requestJson(`${BASE}/api/web/member/contributDetail/list?pageNum=1&pageSize=5&contributionType=1`, {
      headers: headers(token),
    })
    .catch(() => ({}));
  return { info: center.result || {}, records: (rec?.result?.records || []).slice(0, 3) };
}
const rt = createAccountRuntime({
  title: "店铛铛",
  shortName: "店铛铛",
  prefix: "s_ddd",
  defaultEnvName: "S_DDD",
  orderPrefix: "DDD",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入手机号#密码，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const c = parseCred(line.trim()),
          x = await login(ctx, c);
        rows.push({
          account: c.phone,
          token: JSON.stringify({ phone: c.phone, password: c.password, version: VERSION }),
          remark: x.member.nickname || x.member.name || c.phone,
        });
      } catch (error) {
        await ctx.sender.reply(`店铛铛登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const c = JSON.parse(item.token),
      x = await login(ctx, c),
      d = await details(ctx, x.token),
      i = d.info,
      r = d.records.map((v) => `+${v.contribution ?? 0} ${v.createTime || ""}`).join("\n");
    return `📊 贡献值：${i.contribution ?? 0}\n💎 兑换值：${i.ipValue ?? 0}\n📺 已看广告：${i.watchedVideoCount ?? 0}/${i.videoCount ?? 0}${r ? `\n📋 贡献值明细：\n${r}` : ""}`;
  },
  async envValue(_ctx, item) {
    const c = JSON.parse(item.token);
    return `${c.phone}#${c.password}#${c.version || VERSION}`;
  },
  async cronCheck(ctx, item) {
    try {
      const c = JSON.parse(item.token);
      await login(ctx, c);
      return "";
    } catch (_) {
      return "账号密码登录失败，请更新凭证";
    }
  },
  tutorial:
    "=====店铛铛教程=====\n登录格式：手机号#密码，支持批量\n查询贡献值、兑换值、广告进度和最近贡献明细\n指令：店铛铛登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`店铛铛执行失败：${e?.message || e}`));

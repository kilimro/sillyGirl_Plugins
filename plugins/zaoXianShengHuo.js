// [title: 早纤生活]
// [name: zaoXianShengHuo]
// [desc: 早纤生活账密或Authorization批量登录、贡献值/兑换值与贡献明细查询、授权、青龙同步和账号管理。]
// [author: rujingxianghai]
// [version: v2.3.1]
// [rule: raw ^早纤(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 13 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/早纤生活_v2.3_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const cryptoZ = require("node:crypto");
const { sender: sz } = require("sillygirl");
const { createAccountRuntime: createZ } = require("./mrconliAccountRuntime");
const HOST = "gw.yyzqsh.cn",
  BASE = `http://${HOST}`,
  VER = "1.2.8";
function md5z(v) {
  return cryptoZ.createHash("md5").update(String(v)).digest("hex");
}
function ua() {
  return `GZHealth/${VER} (cn.yyzqsh.android; build:${Math.floor(100 + Math.random() * 101)}; Android ${12 + Math.floor(Math.random() * 4)}.${Math.floor(Math.random() * 2)}.0) okhttp/4.10.`;
}
function hz(token, userAgent) {
  const m = userAgent.match(/GZHealth\/(\d+\.\d+\.\d+)/),
    p = userAgent.match(/(iOS|Android) \d+\.\d+\.\d+/);
  if (!m || !p) throw new Error("UA格式错误");
  return {
    host: HOST,
    platform: p[1],
    version: m[1],
    authorization: token,
    "user-agent": userAgent,
    "content-type": "application/json",
  };
}
async function loginZ(ctx, phone, password) {
  const h = {
      "user-agent": "okhttp/4.10.0",
      connection: "Keep-Alive",
      "accept-encoding": "gzip",
      version: `v${VER}`,
      platform: "Android",
      "content-type": "application/json; charset=UTF-8",
    },
    d = await ctx.requestJson(`${BASE}/api/web/auth/pwdLogin`, {
      method: "POST",
      headers: h,
      json: { phone, password: md5z(password) },
    });
  if (Number(d?.code) !== 200 || !d?.result?.token) throw new Error(d?.message || "登录失败");
  return { token: d.result.token, userAgent: ua() };
}
async function basic(ctx, token, userAgent) {
  const d = await ctx.requestJson(`${BASE}/api/web/member/getMemberInfo`, {
    method: "POST",
    headers: hz(token, userAgent),
    json: {},
  });
  if (Number(d?.code) !== 200) throw new Error(d?.message || "获取会员信息失败");
  return d.result || {};
}
async function detail(ctx, token, userAgent) {
  const h = hz(token, userAgent),
    c = await ctx.requestJson(`${BASE}/api/web/member/getMemberCenterInfo`, { method: "POST", headers: h, json: {} });
  if (Number(c?.code) !== 200) throw new Error(c?.message || "查询失败");
  const r = await ctx
    .requestJson(`https://${HOST}/api/web/member/contributDetail/list?pageNum=1&pageSize=5&contributionType=1`, {
      headers: h,
    })
    .catch(() => ({}));
  return { info: c.result || {}, records: (r?.result?.records || []).slice(0, 3) };
}
function decodeStored(v) {
  return JSON.parse(v);
}
const rz = createZ({
  title: "早纤生活",
  shortName: "早纤",
  prefix: "s_zx",
  defaultEnvName: "S_ZXSH",
  orderPrefix: "ZX",
  requireAuthForQuery: true,
  async login(ctx) {
    const choice = await ctx.prompt(ctx.sender, "[1] 账密登录\n[2] Authorization登录", 60000);
    if (choice === null) return [];
    const input = await ctx.prompt(
      ctx.sender,
      choice === "1" ? "请输入手机号#密码，支持批量" : "请输入Authorization，支持批量",
      120000,
    );
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean))
      try {
        let token, userAgent, phone;
        if (choice === "1") {
          const i = line.indexOf("#");
          if (i <= 0) throw new Error("格式应为手机号#密码");
          phone = line.slice(0, i);
          const x = await loginZ(ctx, phone, line.slice(i + 1));
          token = x.token;
          userAgent = x.userAgent;
        } else {
          token = line.replace(/^Bearer\s+/i, "");
          userAgent = ua();
        }
        const m = await basic(ctx, token, userAgent);
        phone = String(m.phone || phone || "");
        if (!phone) throw new Error("接口未返回手机号");
        rows.push({
          account: phone,
          token: JSON.stringify({
            mode: choice === "1" ? "pwd" : "ck",
            phone,
            password: choice === "1" ? line.slice(line.indexOf("#") + 1) : "",
            token,
            userAgent,
          }),
          remark: m.nickname || m.name || phone,
        });
      } catch (error) {
        await ctx.sender.reply(`早纤登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = decodeStored(item.token);
    if (x.mode === "pwd") {
      const n = await loginZ(ctx, x.phone, x.password);
      x.token = n.token;
      x.userAgent = n.userAgent;
    }
    const d = await detail(ctx, x.token, x.userAgent),
      i = d.info,
      r = d.records.map((v) => `+${v.contribution ?? 0} ${v.createTime || ""}`).join("\n");
    return `📊 贡献值：${i.contribution ?? 0}\n💎 兑换值：${i.ipValue ?? 0}${r ? `\n📋 贡献值明细：\n${r}` : ""}`;
  },
  async envValue(ctx, item) {
    const x = decodeStored(item.token);
    if (x.mode === "pwd") {
      const n = await loginZ(ctx, x.phone, x.password);
      x.token = n.token;
      x.userAgent = n.userAgent;
    }
    return `${x.token}#${x.userAgent.match(/GZHealth\/(\d+\.\d+\.\d+)/)?.[1] || VER}`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = decodeStored(item.token);
      if (x.mode === "pwd") {
        const n = await loginZ(ctx, x.phone, x.password);
        x.token = n.token;
        x.userAgent = n.userAgent;
      }
      await basic(ctx, x.token, x.userAgent);
      return "";
    } catch (_) {
      return "账号凭证检测失效，请更新";
    }
  },
  tutorial:
    "=====早纤生活教程=====\n支持手机号#密码或Authorization批量登录\n查询贡献值、兑换值和最近贡献明细\n指令：早纤登录、查询、管理、授权、清理、教程\n==================",
});
rz.main().catch(async (e) => sz.reply(`早纤生活执行失败：${e?.message || e}`));

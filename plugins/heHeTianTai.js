// [title: 和合天台]
// [name: heHeTianTai]
// [desc: 和合天台账号登录、积分中心、权益钱包与流水查询、授权及面板同步]
// [author: 8165799]
// [version: v2.8.0]
// [rule: ^(和合)(登录|登陆|管理|查询|教程|授权|清理)$|^(登录|登陆|管理|查询)(和合)$]
// [cron: 30 18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/和合_v2.8_By.8165799.py;backup/和合天台_v2.7_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXi
zPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXF
c+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlT
HMlluw4ZYmnOwg+thwIDAQAB
-----END PUBLIC KEY-----`;
function md5(v) {
  return crypto.createHash("md5").update(v).digest("hex");
}
function sha(v) {
  return crypto.createHash("sha256").update(v).digest("hex");
}
function ua(phone) {
  const m = md5(phone),
    h = sha(phone),
    models = [
      ["xiaomi", "22081212C"],
      ["samsung", "SM-G998B"],
      ["huawei", "NOH-AN00"],
      ["oppo", "CPH2207"],
      ["vivo", "V2244A"],
      ["oneplus", "NE2210"],
    ],
    pair = models[Number(phone.at(-1) || 0) % models.length],
    uuid = `00000000-${h.slice(8, 12)}-${h.slice(20, 24)}-ffff-${m.slice(16, 28)}`;
  return `4.5.6;${uuid};${pair[1]};Android;13;${pair[0]};6.8.0`;
}
function parse(v) {
  const p = String(v).trim().split("#");
  if (!/^1[3-9]\d{9}$/.test(p[0]) || !p[1]) throw new Error("格式应为 手机号#密码，可追加#抽奖Q链接");
  return {
    phone: p[0],
    password: p[1],
    q: decodeURIComponent(
      p
        .slice(2)
        .join("#")
        .replace(/^https:\/\/act\.tmlyun\.com\/lottery\/\?q=/, ""),
    ),
  };
}
function headers(path, session, account, userAgent) {
  const id = crypto.randomUUID(),
    t = String(Date.now()),
    signature = sha(`${path.split("?")[0]}&&${session}&&${id}&&${t}&&FR*r!isE5W&&5`);
  return {
    "user-agent": userAgent,
    "x-tenant-id": "5",
    "x-session-id": session,
    "x-request-id": id,
    "x-timestamp": t,
    "x-signature": signature,
    "x-account-id": account || "",
    "cache-control": "no-cache",
  };
}
async function login(ctx, item) {
  const userAgent = ua(item.phone),
    init = await ctx.requestJson("https://vapp.tmuyun.com/api/account/init", {
      method: "POST",
      headers: {
        ...headers("/api/account/init", "", "", userAgent),
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      form: {},
    }),
    seed = init?.data?.session?.id;
  if (!seed) throw new Error(init?.message || "初始化失败");
  const enc = crypto
      .publicEncrypt({ key: KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(item.password))
      .toString("base64"),
    id = crypto.randomUUID(),
    t = String(Date.now()),
    signature = sha(`/web/oauth/credential_auth&&${seed}&&${id}&&${t}&&FR*r!isE5W&&5`),
    auth = await ctx.requestJson("https://passport.tmuyun.com/web/oauth/credential_auth", {
      method: "POST",
      headers: {
        "user-agent": userAgent,
        "x-request-id": id,
        "x-signature": signature,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      form: { client_id: "10", password: enc, phone_number: item.phone },
    }),
    code = auth?.data?.authorization_code?.code;
  if (Number(auth?.code) !== 0 || !code) throw new Error(auth?.message || "账号认证失败");
  const result = await ctx.requestJson("https://vapp.tmuyun.com/api/zbtxz/login", {
      method: "POST",
      headers: {
        ...headers("/api/zbtxz/login", seed, "", userAgent),
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      form: { check_token: "", code, token: "", type: -1, union_id: "" },
    }),
    session = result?.data?.session?.id,
    account = result?.data?.session?.account_id;
  if (Number(result?.code) !== 0 || !session || !account) throw new Error(result?.message || "登录失败");
  return { ...item, userAgent, session, account, nickname: result?.data?.account?.nick_name || item.phone };
}
async function appGet(ctx, a, path) {
  return ctx.requestJson(`https://vapp.tmuyun.com${path}`, {
    headers: headers(path, a.session, a.account, a.userAgent),
  });
}
async function lotteryLogin(ctx, a) {
  if (!a.q) return null;
  const r = await ctx.requestJson("https://act.tmlyun.com/activity-api/lottery/api/auth/userLogin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": crypto.randomUUID(),
      "x-requested-with": "com.zjonline.tiantai",
    },
    json: { q: a.q, accountId: a.account, sessionId: a.session, tenantCode: "xsb_tiantai" },
  });
  if (Number(r?.code) !== 0 || !r?.data?.token) throw new Error(r?.message || "抽奖登录失败");
  return r.data.token;
}
async function wallet(ctx, a) {
  const lotteryToken = await lotteryLogin(ctx, a);
  if (!lotteryToken) return null;
  const jump = await ctx.requestJson(
    "https://act.tmlyun.com/activity-api/lottery/h5/activity/lottery/accountPrizeRecord/jumpEquityWallet",
    { headers: { "user-agent": a.userAgent, authorization: lotteryToken, "x-request-id": crypto.randomUUID() } },
  );
  if (Number(jump?.code) !== 0 || !String(jump?.data || "").includes("u="))
    throw new Error(jump?.message || "获取钱包U值失败");
  const u = decodeURIComponent(String(jump.data).split("u=")[1].split("&")[0]),
    rid = `${(1000 + Math.random() * 8999).toFixed(12)}|${Date.now()}`,
    auth = await ctx.requestJson("https://my.tmlyun.com/equity-api/user/auth/userLogin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": rid, "x-requested-with": "com.zjonline.tiantai" },
      json: { u, accountId: a.account, sessionId: a.session },
    }),
    token = auth?.data?.token;
  if (Number(auth?.code) !== 0 || !token) throw new Error(auth?.message || "钱包登录失败");
  const wh = { authorization: token, "x-request-id": `${(1000 + Math.random() * 8999).toFixed(12)}|${Date.now()}` },
    info = await ctx.requestJson(
      `https://my.tmlyun.com/equity-api/redBag/getWalletInfo?device=${encodeURIComponent(a.userAgent.split(";")[1])}`,
      { headers: { ...wh, "user-agent": a.userAgent } },
    ),
    records = await ctx.requestJson(
      "https://my.tmlyun.com/equity-api/redBag/pageWalletDetail?current=1&pageSize=5&fundsChannelType=0",
      { headers: wh },
    ),
    w = Array.isArray(info?.data) ? info.data[0] || {} : info?.data || {};
  return {
    balance: w.aliPayTotalPrice || 0,
    total: w.totalTransPrice || 0,
    records: (records?.data || []).map(
      (x) => `${x.createdAt || ""}[${x.price || 0}][${Number(x.type) === 0 ? "阅读红包" : x.statusDesc || "未知"}]`,
    ),
  };
}
const rt = createAccountRuntime({
  title: "和合天台",
  shortName: "和合",
  prefix: "dd_hhtt",
  defaultEnvName: "HHTT",
  orderPrefix: "HHTT",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(
      ctx.sender,
      "请输入 手机号#密码；查询权益钱包时追加 #https://act.tmlyun.com/lottery/?q=...，支持多行",
      120000,
    );
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const p = parse(line),
        a = await login(ctx, p);
      out.push({ account: p.phone, token: line, remark: a.nickname });
    }
    return out;
  },
  async query(ctx, item) {
    const a = await login(ctx, parse(item.token)),
      integral = await appGet(ctx, a, "/api/user_mumber/numberCenter?is_new=1"),
      points = integral?.data?.rst?.total_integral || 0,
      w = await wallet(ctx, a);
    return `👤 昵称：${a.nickname}\n💰 积分：${points}${w ? `\n🧧 可提现：${w.balance}\n📊 累计红包：${w.total}\n📜 最近流水：${w.records.length ? `\n${w.records.join("\n")}` : "无"}` : "\n🧧 钱包：未配置抽奖Q链接"}`;
  },
  async cronCheck(ctx, item) {
    const a = await login(ctx, parse(item.token)),
      r = await appGet(ctx, a, "/api/user_mumber/numberCenter?is_new=1");
    return `账号有效，积分${r?.data?.rst?.total_integral || 0}`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial:
    "发送和合登录，输入手机号#密码；如需权益钱包查询，第三段追加带 q= 的抽奖链接。支持查询、管理、授权、清理及青龙/呆呆面板同步。",
});
rt.main().catch((e) => s.reply(`和合执行失败：${e?.message || e}`));

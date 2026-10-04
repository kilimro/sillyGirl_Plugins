// [title: 望潮]
// [name: wangChao]
// [desc: 望潮账密登录、动态签名会话、用户查询、阅读/签到中奖记录及云端同步]
// [author: sky2022,huawei]
// [version: v2.3.0]
// [rule: ^(望潮管理|管理望潮|望潮查询|查询望潮|望潮登录|望潮登陆|登录望潮|登陆望潮|望潮教程|望潮删除|删除望潮|望潮更新青龙|望潮同步|同步望潮|望潮授权|望潮清理)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/望潮_v2.3_By.sky2022.py;backup/望潮云端_v1.0.3_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s, Bucket } = require("sillygirl");
const crypto = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime"),
  VAPP = "https://vapp.taizhou.com.cn",
  UA = "6.0.2;00000000-699e-0680-0000-0000090ca05c;Xiaomi Redmi Note 8 Pro;Android;11;xiaomi;6.10.0",
  PUB = crypto.createPublicKey({
    key: Buffer.from(
      "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXizPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXFc+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlTHMlluw4ZYmnOwg+thwIDAQAB",
      "base64",
    ),
    format: "der",
    type: "spki",
  }),
  SALT = "FR*r!isE5W&&64",
  SIGN_Q = "Kmqh2bf7dyAQl2I770dCKHUVSnXhOYSzhc6XfCKHGY0=",
  LOTTERY_Q = "23dK9z2aWFgpe9ZqxA4ARLby61Zf4Yqt4mcdKX9NlBo=";
function enc(v) {
  return crypto
    .publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(v))
    .toString("base64");
}
function sig(path, session, id, time) {
  return crypto.createHash("sha256").update(`${path}&&${session}&&${id}&&${time}&&${SALT}`).digest("hex");
}
function signedHeaders(path, session) {
  const id = crypto.randomUUID(),
    time = Date.now();
  return {
    "user-agent": UA,
    "x-session-id": session,
    "x-request-id": id,
    "x-timestamp": String(time),
    "x-signature": sig(path, session, id, time),
    "x-tenant-id": "64",
    "cache-control": "no-cache",
  };
}
async function login(ctx, phone, password) {
  const a = await ctx.requestJson("https://passport.tmuyun.com/web/oauth/credential_auth", {
    method: "POST",
    form: { client_id: "10019", password: enc(password), phone_number: phone },
  });
  if (Number(a?.code) !== 0) throw new Error(a?.message || "账号认证失败");
  const code = a.data?.authorization_code?.code;
  if (!code) throw new Error("认证响应缺少authorization_code");
  const init = "66545332bf15a47d5156525d",
    r = await ctx.requestJson(`${VAPP}/api/zbtxz/login`, {
      method: "POST",
      form: { check_token: "", code, token: "", type: "-1", union_id: "" },
      headers: { ...signedHeaders("/api/zbtxz/login", init), "content-type": "application/x-www-form-urlencoded" },
    });
  if (Number(r?.code) !== 0) throw new Error(r?.message || "望潮登录失败");
  const session = r.data?.session?.id;
  if (!session) throw new Error("登录响应缺少session");
  const q = await detail(ctx, session);
  return {
    phone,
    password,
    session,
    accountId: String(q.id),
    name: q.nick_name || phone,
    updatedAt: new Date().toISOString(),
  };
}
async function detail(ctx, session) {
  const r = await ctx.requestJson(`${VAPP}/api/user_mumber/account_detail`, {
    headers: signedHeaders("/api/user_mumber/account_detail", session),
  });
  if (Number(r?.code) !== 0 && !/success/i.test(String(r?.message))) throw new Error(r?.message || "用户信息获取失败");
  return r.data?.rst || {};
}
function sess(v) {
  return typeof v === "string" && v.trim().startsWith("{") ? JSON.parse(v) : { session: String(v || "") };
}
async function call(ctx, url, opt = {}) {
  const r = await ctx.requestJson(url, opt);
  if (Number(r?.code) !== 0 && r?.success !== true) throw new Error(r?.message || `接口失败 code=${r?.code}`);
  return r.data || {};
}
async function prizeRecords(ctx, x) {
  const common = { accountId: x.accountId, sessionId: x.session, tenantCode: "xsb_wangchao" };
  await call(ctx, "https://act.tmlyun.com/activity-api/signin/h5/auth/userLogin", {
    method: "POST",
    json: { ...common, q: SIGN_Q },
  });
  const lottery = await call(ctx, "https://act.tmlyun.com/activity-api/lottery/api/auth/userLogin", {
      method: "POST",
      json: { ...common, q: LOTTERY_Q },
    }),
    token = lottery.token;
  if (!token) return [];
  const r = await call(
    ctx,
    "https://act.tmlyun.com/activity-api/lottery/h5/activity/lottery/accountPrizeRecord/userPrizeRecord?activityId=1889",
    {
      headers: {
        authorization: token,
        "x-token": lottery.xToken || lottery.x_token || "",
        "x-request-id": `${crypto.randomBytes(16).toString("hex")}.${Date.now()}`,
      },
    },
  );
  return Array.isArray(r.activityAccountPrizeVoList) ? r.activityAccountPrizeVoList : [];
}
async function readingRecords(ctx, x) {
  const login = await ctx.requestJson(
      `https://srv-app.taizhou.com.cn/tzrb/user/loginWC?accountId=${encodeURIComponent(x.accountId)}&sessionId=${encodeURIComponent(x.session)}`,
      {
        headers: {
          referer: "https://xmt.taizhou.com.cn/readingLuck-v1/",
          "x-requested-with": "com.shangc.tiennews.taizhou",
          "user-agent": UA,
        },
      },
    ),
    cookie = login?.data?.cookie || login?.cookie || "";
  if (String(login?.message) !== "操作成功" && !cookie) return [];
  const r = await ctx.requestJson(
    "https://srv-app.taizhou.com.cn/tzrb/userAwardRecordUpgrade/pageList?pageSize=100&pageNum=1&activityId=67",
    {
      headers: {
        cookie,
        referer: "https://srv-app.taizhou.com.cn/luckdraw/",
        "x-requested-with": "com.shangc.tiennews.taizhou",
        "user-agent": UA,
      },
    },
  );
  return r?.data?.records || [];
}
function stats(rows) {
  const now = new Date(),
    today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
    month = today.slice(0, 7);
  let day = 0,
    mon = 0;
  for (const v of rows) {
    const time = String(v.createTime || v.prizeTime || v.create_time || v.time || ""),
      name = String(v.prizeName || v.awardName || v.name || "").replace(/Ԫ|¥/g, "元"),
      n = Number((name.match(/\d+(?:\.\d+)?/) || [])[0] || 0);
    if (time.startsWith(month)) mon += n;
    if (time.startsWith(today)) day += n;
  }
  return { day, month: mon };
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    a = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!a.length) throw new Error("未绑定望潮账号");
  return Promise.all(
    a.map(async (account) => ({
      account,
      remark: await ctx.remarks.get(account, account),
      x: sess(await ctx.tokens.get(account, "")),
    })),
  );
}
async function cloudSync(ctx) {
  const cfg = await new Bucket("dd_wc_cloud").getAll(),
    username = cfg.username,
    password = cfg.password,
    projectId = cfg.project_id;
  if (!username || !password || !projectId) throw new Error("请在 dd_wc_cloud 配置 username、password、project_id");
  const base = String(cfg.api_base || "https://cjf.yousang.icu/api/v1").replace(/\/$/, ""),
    l = await ctx.requestJson(`${base}/auth/login`, { method: "POST", json: { username, password } }),
    jwt = l.token || l.data?.token;
  if (!jwt) throw new Error("云端登录失败");
  const k = await ctx.requestJson(`${base}/user/api-key`, { headers: { authorization: `Bearer ${jwt}` } }),
    key = k.api_key || k.data?.api_key;
  if (!key) throw new Error("未取得云端api-key");
  let ok = 0;
  for (const a of await owned(ctx)) {
    await ctx.requestJson(`${base}/projects/${projectId}/accounts`, {
      method: "POST",
      json: { account_data: `${a.x.phone}#${a.x.password}`, remark: `${a.remark}|${a.x.accountId}` },
      headers: { authorization: `Bearer ${key}` },
    });
    ok++;
  }
  return ctx.sender.reply(`望潮云端同步完成：${ok}个账号`);
}
const rt = createAccountRuntime({
  title: "望潮",
  shortName: "望潮",
  prefix: "dd_wc",
  defaultEnvName: "dd_wc",
  orderPrefix: "WC",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入 手机号#密码，支持多账号换行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#"),
        phone = line.slice(0, cut),
        password = line.slice(cut + 1);
      if (!/^1[3-9]\d{9}$/.test(phone) || !password) throw new Error(`${line}格式错误`);
      const x = await login(ctx, phone, password);
      out.push({ account: x.accountId, token: JSON.stringify(x), remark: x.name });
    }
    return out;
  },
  async query(ctx, item) {
    const x = sess(item.token),
      q = await detail(ctx, x.session);
    let rows = [];
    try {
      rows = await prizeRecords(ctx, x);
    } catch (_) {}
    if (!rows.length)
      try {
        rows = await readingRecords(ctx, x);
      } catch (_) {}
    const st = stats(rows);
    return `👤 用户：${q.nick_name || x.name || item.remark}\n📱 手机：${String(x.phone || "").replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}\n💰 今日收益：${st.day.toFixed(2)}元\n💰 本月收益：${st.month.toFixed(2)}元\n🎁 中奖记录：${
      rows.length
        ? rows
            .slice(0, 10)
            .map((v) => `${v.createTime || v.prizeTime || v.time || ""} ${v.prizeName || v.awardName || v.name || ""}`)
            .join("\n")
        : "暂无"
    }`;
  },
  async handle(ctx, c) {
    if (/同步|更新青龙/.test(c)) return cloudSync(ctx);
  },
  async cronCheck(ctx, item) {
    const x = sess(item.token);
    await detail(ctx, x.session);
    return "会话有效";
  },
  envValue(_c, item) {
    const x = sess(item.token);
    return `${x.phone}#${x.password}`;
  },
  tutorial:
    "发送“望潮登录”，按 手机号#密码 提交；插件通过天目云 credential_auth 获取授权码，再以动态 X-SIGNATURE 登录望潮。望潮查询展示今日/本月收益和中奖记录；望潮同步按 dd_wc_cloud 配置上传云端。",
});
rt.main().catch((e) => s.reply(`望潮执行失败：${e?.message || e}`));

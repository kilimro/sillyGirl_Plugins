// [title: 爱海盐]
// [name: aiHaiYan]
// [desc: 爱海盐手机号密码批量登录、天目云会话测活、阅读/签到抽奖当日奖品查询、授权、青龙同步与账号管理。]
// [author: 8165799]
// [version: v1.3.1]
// [rule: raw ^爱海盐(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 6 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/爱海盐_v1.3_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const PUB = `-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXizPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXFc+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlTHMlluw4ZYmnOwg+thwIDAQAB\n-----END PUBLIC KEY-----`;
const PASSPORT = "https://passport.tmuyun.com",
  VAPP = "https://vapp.tmuyun.com",
  H5S = ["https://ya.iyunxh.com/api", "https://yapi.y-h5.iyunxh.com/api"],
  TENANT = "60",
  UA =
    "Mozilla/5.0 (Linux; Android 11; 21091116AC Build/RP1A.200720.011; wv) AppleWebKit/537.36 Version/4.0 Chrome/94.0.4606.85 Mobile Safari/537.36;xsb_aihaiyan;xsb_aihaiyan;3.0.61.0;native_app;6.12.0";
function md5(v) {
  return crypto.createHash("md5").update(String(v)).digest("hex");
}
function rand(n) {
  return crypto
    .randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);
}
function parse(v) {
  const p = String(v).split("#");
  if (p.length >= 3 && /^\d{11}$/.test(p[1])) return { remark: p[0], phone: p[1], password: p.slice(2).join("#") };
  const i = String(v).indexOf("#");
  if (i <= 0 || !/^\d{11}$/.test(String(v).slice(0, i))) throw new Error("格式应为手机号#密码或备注#手机号#密码");
  return { remark: "", phone: String(v).slice(0, i), password: String(v).slice(i + 1) };
}
function signed(state, path) {
  const id = crypto.randomUUID(),
    time = String(Date.now()),
    base = path.split("?")[0],
    sig = crypto
      .createHash("sha256")
      .update(`${base}&&${state.sessionId || ""}&&${id}&&${time}&&FR*r!isE5W&&${TENANT}`)
      .digest("hex");
  return {
    "x-timestamp": time,
    "x-session-id": state.sessionId || "",
    "x-request-id": id,
    "x-signature": sig,
    "x-tenant-id": TENANT,
    "x-account-id": state.accountId || "",
    "cache-control": "no-cache",
    "accept-encoding": "gzip",
    "user-agent": `3.0.61.0;${crypto.randomUUID()};Xiaomi M2011K2C;Android;11;Release;6.12.0`,
  };
}
async function vpost(ctx, state, path, form) {
  return ctx.requestJson(VAPP + path, { method: "POST", headers: signed(state, path), form });
}
function h5sig() {
  const nonce = rand(32),
    time = Date.now();
  return `haiyan;${nonce};${time};${md5(`haiyan${nonce}${time}2803cb8d50798c80b66ecd70da7e5fb1`)}`;
}
function hh(state, authed = true) {
  const h = {
    connection: "keep-alive",
    "access-t-id-in": "69",
    "user-agent": UA,
    "access-api-unique-token": "1",
    "access-api-dt": state.apiDt || String(Date.now()),
    "access-t-id": "69",
    accept: "*/*",
    origin: "https://haiyan.y-h5.iyunxh.com",
    "x-requested-with": "com.hoge.android.app.haiyan",
    referer: "https://haiyan.y-h5.iyunxh.com/",
  };
  if (authed)
    Object.assign(h, {
      "access-user-id": state.accessUserId,
      "access-api-signature": h5sig(),
      "access-wxclient-type": "wx_app",
      "access-token": state.accessToken,
    });
  return h;
}
async function h5(ctx, state, path, options = {}) {
  let last;
  for (const host of H5S)
    try {
      return await ctx.requestJson(host + path, {
        method: options.method || "GET",
        headers: {
          ...hh(state, options.authed !== false),
          ...(options.json ? { "content-type": "application/json" } : {}),
        },
        json: options.json,
      });
    } catch (e) {
      last = e;
    }
  throw last;
}
async function login(ctx, c) {
  const state = { ...c, sessionId: "", accountId: "", apiDt: "", accessToken: "", accessUserId: "0" },
    init = await vpost(ctx, state, "/api/account/init");
  state.sessionId = init?.data?.session?.id;
  if (!state.sessionId) throw new Error("获取session失败");
  const pinit = await ctx.requestJson(`${PASSPORT}/web/init?client_id=10018`, {
      headers: {
        connection: "Keep-Alive",
        "cache-control": "no-cache",
        "x-request-id": crypto.randomUUID(),
        "accept-encoding": "gzip",
        "user-agent": UA,
      },
    }),
    key = pinit?.data?.client?.signature_key;
  if (!key) throw new Error("获取signature_key失败");
  const encrypted = crypto
      .publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(c.password))
      .toString("base64"),
    rid = crypto.randomUUID(),
    signBody = `client_id=10018&password=${encrypted}&phone_number=${c.phone}`,
    sig = crypto
      .createHmac("sha256", key)
      .update(`post%%/web/oauth/credential_auth?${signBody}%%${rid}%%`)
      .digest("hex"),
    auth = await ctx.requestJson(`${PASSPORT}/web/oauth/credential_auth`, {
      method: "POST",
      headers: {
        "x-request-id": rid,
        "x-signature": sig,
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": UA,
      },
      form: { client_id: "10018", password: encrypted, phone_number: c.phone },
    }),
    code = auth?.data?.authorization_code?.code;
  if (!code) throw new Error(auth?.message || "账号或密码错误");
  const logged = await vpost(ctx, state, "/api/zbtxz/login", {
    check_token: "",
    code,
    token: "",
    type: "-1",
    union_id: "",
  });
  state.account = logged?.data?.account || {};
  state.sessionId = logged?.data?.session?.id || state.sessionId;
  state.accountId = String(logged?.data?.session?.account_id || state.account.id || "");
  if (!state.accountId) throw new Error("登录未返回账号信息");
  return state;
}
async function initH5(ctx, state) {
  const dt = await h5(ctx, state, "/aosbase/_auth_dt", { authed: false });
  state.apiDt = String(dt?.data || "").slice(32, 68);
  const payload = {
    app_user_token: state.sessionId,
    appid: "haiyan",
    noncestr: rand(6),
    phone: state.phone,
    portrait_url: state.account.image_url || "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    user_id: state.account.id || state.accountId,
    user_name: state.account.nick_name || "",
    wx_openid: "",
    wx_unionid: "",
  };
  payload.signature = md5(
    Object.entries(payload)
      .map(([k, v]) => `${k}=${encodeURIComponent(v ?? "")}`)
      .join("&") + "&appkey=0be39bb836a0d86aa76761af779aa93e",
  );
  const a = await h5(ctx, state, "/aosbase/_auth_appuserinit", { method: "POST", authed: false, json: payload });
  state.accessToken = a?.data?.access_token;
  state.accessUserId = String(a?.data?.data?.user_id || "0");
  if (!state.accessToken) throw new Error("H5活动登录失败");
}
async function prizes(ctx, state) {
  await initH5(ctx, state);
  const buoy = await ctx.requestJson(`${VAPP}/api/buoy/list`, { headers: signed(state, "/api/buoy/list") }),
    text = JSON.stringify(buoy),
    targets = [];
  for (const [re, type] of [
    [/\/module-study\/home\/home\?hide_back=1&id=([\w]+)/, "study"],
    [/\/module-signin\/home\/home\?hide_back=1&id=([\w]+)/, "sign"],
  ]) {
    const id = text.match(re)?.[1];
    if (!id) continue;
    try {
      const d = await h5(
        ctx,
        state,
        type === "study" ? `/aoslearnfoot/_ac_detail?id=${id}` : `/aossignin/_ac_detail?id=${id}`,
      );
      if (type === "study") {
        let o = d?.data?.other_set || "{}";
        if (typeof o === "string") o = JSON.parse(o);
        if (o?.lottery?.id) targets.push(o.lottery.id);
      } else {
        const x = JSON.stringify(d).match(/\/module-lottery\/home\/home\?hide_back=1&id=([\w]+)/)?.[1];
        if (x) targets.push(x);
      }
    } catch (_) {}
  }
  if (!targets.length) targets.push("d45e103026692d01667e08");
  const today = new Date().toISOString().slice(0, 10),
    out = [];
  for (const id of targets)
    try {
      const d = await h5(ctx, state, `/aoslottery/act_user?offset=0&count=50&activity_id=${id}&module_id=40602`);
      for (const r of Array.isArray(d?.data) ? d.data : []) {
        const time = String(r.created_at || r.createdAt || "");
        if (time && !time.startsWith(today)) continue;
        const title = String(r.title || r.goods_title || (r.value ? `${r.value}积分` : ""));
        if (title) out.push(title);
      }
    } catch (_) {}
  return out;
}
const rt = createAccountRuntime({
  title: "爱海盐",
  shortName: "爱海盐",
  prefix: "aihaiyan",
  defaultEnvName: "AiHaiYan",
  orderPrefix: "AHY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入手机号#密码或备注#手机号#密码，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const c = parse(line.trim()),
          x = await login(ctx, c);
        rows.push({
          account: c.phone,
          token: `${c.phone}#${c.password}`,
          remark: c.remark || x.account.nick_name || c.phone,
        });
      } catch (error) {
        await ctx.sender.reply(`爱海盐登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const state = await login(ctx, parse(item.token));
    let p = [];
    try {
      p = await prizes(ctx, state);
    } catch (_) {}
    return `✅ 当前登录：${state.account.nick_name || `用户_${state.phone.slice(-4)}`}\n🎁 今日奖品：${p.length ? p.join("、") : "无"}`;
  },
  async cronCheck(ctx, item) {
    try {
      await login(ctx, parse(item.token));
      return "";
    } catch (_) {
      return "账号密码登录失效，请更新凭证";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====爱海盐教程=====\n登录格式：手机号#密码或备注#手机号#密码，支持批量\n查询天目云会话状态及阅读/签到抽奖当日奖品\n指令：爱海盐登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`爱海盐执行失败：${e?.message || e}`));

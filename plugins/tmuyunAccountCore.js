// [title: 天目云账户公共模块]
// [name: tmuyunAccountCore]
// [desc: 天目云账号认证、请求和数据解析公共能力]
// [author: sillyGirl]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

const crypto = require("node:crypto");
const KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXizPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXFc+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlTHMlluw4ZYmnOwg+thwIDAQAB
-----END PUBLIC KEY-----`;
async function json(ctx, url, opt = {}) {
  return ctx.requestJson(url, opt);
}
function commonHeaders(path, session, account, tenant, ua) {
  const t = Date.now(),
    id = crypto.randomUUID(),
    sig = crypto
      .createHash("sha256")
      .update(`${path.split("?")[0]}&&${session}&&${id}&&${t}&&FR*r!isE5W&&${tenant}`)
      .digest("hex");
  return {
    "x-session-id": session,
    "x-request-id": id,
    "x-signature": sig,
    "x-timestamp": String(t),
    "x-tenant-id": String(tenant),
    "x-account-id": account || "",
    "cache-control": "no-cache",
    "user-agent": ua,
  };
}
async function login(ctx, { phone, password, tenant, client, version = "1.7.0" }) {
  const uuid = crypto.randomUUID(),
    ua = `ANDROID;11;${client};${version};1.0;null;2304FPN6DC`,
    commonUa = `${version};${uuid};Xiaomi 2304FPN6DC;Android;11;Release;6.12.0`,
    init = await json(ctx, "https://vapp.tmuyun.com/api/account/init", {
      method: "POST",
      headers: commonHeaders("/api/account/init", "", "", tenant, commonUa),
    }),
    seed = init?.data?.session?.id;
  if (!seed) throw new Error(init?.message || "初始化失败");
  const pi = await json(ctx, `https://passport.tmuyun.com/web/init?client_id=${client}`, {
      headers: { "x-request-id": uuid, "user-agent": ua },
    }),
    key = pi?.data?.client?.signature_key;
  if (!key) throw new Error(pi?.message || "signature_key失败");
  const enc = crypto
      .publicEncrypt({ key: KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(password))
      .toString("base64"),
    raw = `client_id=${client}&password=${enc}&phone_number=${phone}`,
    sig = crypto.createHmac("sha256", key).update(`post%%/web/oauth/credential_auth?${raw}%%${uuid}%%`).digest("hex"),
    pa = await json(ctx, "https://passport.tmuyun.com/web/oauth/credential_auth", {
      method: "POST",
      headers: { "x-request-id": uuid, "x-signature": sig, "user-agent": ua },
      form: { client_id: client, password: enc, phone_number: phone },
    }),
    code = pa?.data?.authorization_code?.code;
  if (!code) throw new Error(pa?.message || "账号密码认证失败");
  const ld = await json(ctx, "https://vapp.tmuyun.com/api/zbtxz/login", {
      method: "POST",
      headers: commonHeaders("/api/zbtxz/login", seed, "", tenant, commonUa),
      form: { check_token: "", code, token: "", type: -1, union_id: "" },
    }),
    session = ld?.data?.session?.id,
    account = ld?.data?.session?.account_id;
  if (!session || !account) throw new Error(ld?.message || "登录失败");
  const ad = await json(ctx, "https://vapp.tmuyun.com/api/user_mumber/account_detail", {
      headers: commonHeaders("/api/user_mumber/account_detail", session, account, tenant, commonUa),
    }),
    detail = ad?.data?.rst || {};
  return { session, account, commonUa, detail, login: ld.data?.account || {} };
}
module.exports = { login, commonHeaders };

// [title: 顺丰丰]
// [name: shunFengFeng]
// [desc: 顺丰扫码登录、蜂蜜/积分查询、账号管理及青龙变量同步]
// [author: Lxg-021002]
// [version: v2.1.0]
// [rule: ^顺风登录$|^顺风登陆$|^登陆顺风$|^登录顺风$|^顺风查询$|^查询顺风$|^顺风管理$|^管理顺风$|^顺丰登录$|^顺丰登陆$|^登陆顺丰$|^登录顺丰$|^顺丰查询$|^查询顺丰$|^顺丰管理$|^管理顺丰$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/顺丰丰_v2.0.4_By.Lxg-021002.txt]
// [depe: []]

const crypto = require("node:crypto");
const { container, plugin, sender: s, Bucket, utils } = require("sillygirl");
const users = new Bucket("Yzyxmm_sf_bind"),
  accounts = new Bucket("Yzyxmm_sf_account"),
  auth = new Bucket("Yzyxmm_sf_Vip");
const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  env_name: plugin.Form.string().title("青龙变量名").default("sfsyUrl"),
  qr_service: plugin.Form.string().title("顺丰扫码服务").default("http://yi100.top:1222/wxcode"),
  default_auth_days: plugin.Form.integer().title("新账号默认授权天数，0为长期").min(0).default(0),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(20000),
});
let cfg = {};
const APP = "https://ccsp-egmas.sf-express.com/cx-app-member/member/app";
const MCS = "https://mcs-mimp-web.sf-express.com/mcs-mimp";

async function uid(target = s) {
  return String(await target.getUserId());
}
function list(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const x = JSON.parse(String(raw || "[]").replace(/'/g, '"'));
    return Array.isArray(x) ? x.map(String) : [];
  } catch (_) {
    return [];
  }
}
async function userAccounts(id) {
  return list(await users.get(id, "[]"));
}
async function saveUser(id, rows) {
  return rows.length ? users.set(id, JSON.stringify([...new Set(rows)])) : users.delete(id);
}
function mask(phone) {
  return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}
function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}
function syt(payload, deviceId) {
  const time = Date.now(),
    data = md5(`${payload}&080R3MAC57J2{A19!$3:WO{I<1N$31BI`),
    device = md5(
      `${deviceId}${time}9.65.302NBF+BE4{@P:@X\${Q9BAE>{PAK!D:N*^CNsc${data}705088894ad6ef475bdf4875c9d533b8&2NBF+BE4{@P:@X\${Q9BAE>{PAK!D:N*^`,
    );
  return { token: md5(`${device}&0HQ%H91K&AA{DH$*XV>XR)VKL:QFE{&%`), time };
}
function appHeaders(payload, deviceId) {
  const sign = syt(payload, deviceId);
  return {
    "user-agent": "okhttp/4.9.1",
    "content-type": "application/json",
    jsbundle: "705088894ad6ef475bdf4875c9d533b8",
    clientversion: "9.65.30",
    languagecode: "sc",
    systemversion: "13",
    deviceid: deviceId,
    regioncode: "CN",
    carrier: "unknown",
    screensize: "1080x2400",
    syttoken: sign.token,
    timeinterval: String(sign.time),
    model: "MEIZU 20",
    mediacode: "AndroidML",
  };
}
async function req(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(cfg.timeout_ms),
    headers: { ...(init.headers || {}) },
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!response.ok) throw new Error(data.errorMessage || data.message || `HTTP ${response.status}`);
  return { response, text, data };
}

async function qrLogin() {
  const service = String(cfg.qr_service).replace(/\/$/, "");
  const firstUrl = new URL(service);
  firstUrl.searchParams.set("project", "sf");
  firstUrl.searchParams.set("type", "qrcode");
  const qr = (await req(firstUrl)).data?.data;
  if (!qr?.QRcode || !qr?.QRcodeImg) throw new Error("扫码服务未返回二维码");
  await s.reply(utils.image(qr.QRcodeImg));
  await s.reply("请用微信扫码并确认，60秒内回复Q可取消");
  let code = "";
  for (let i = 0; i < 60 && !code; i += 1) {
    const url = new URL(service);
    url.searchParams.set("project", "sf");
    url.searchParams.set("type", "code");
    url.searchParams.set("QRcode", qr.QRcode);
    try {
      const result = await req(url);
      if (String(result.data?.msg || result.text).includes("成功")) code = result.data?.data?.code || "";
    } catch (_) {}
    if (code) break;
    const child = await s.listen({ timeout: 1000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || ""))) throw new Error("已取消扫码");
  }
  if (!code) throw new Error("扫码超时");
  const deviceId = crypto.randomUUID(),
    payload1 = JSON.stringify({ code });
  const token = (
    await req(`${APP}/weixin/getAccessTokenByCode`, {
      method: "POST",
      headers: appHeaders(payload1, deviceId),
      body: payload1,
    })
  ).data?.obj?.memInfos?.[0];
  if (!token?.userId || !token?.memNo || !token?.mobile) throw new Error("微信授权结果缺少会员信息");
  const payload2 = JSON.stringify({
    mobile: token.mobile,
    userId: token.userId,
    memNo: token.memNo,
    name: "mcs-mimp-web.sf-express.com",
    extra: "",
    needReqTime: "1",
  });
  const sign = (
    await req(`${APP}/user/universalSign`, { method: "POST", headers: appHeaders(payload2, deviceId), body: payload2 })
  ).data?.obj?.sign;
  if (!sign) throw new Error("获取顺丰登录签名失败");
  return {
    phone: String(token.mobile),
    url: `${MCS}/share/app/shareRedirect?sign=${encodeURIComponent(sign)}&source=SFAPP&bizCode=619`,
  };
}

function setCookies(headers) {
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie().join(";")
    : headers.get("set-cookie") || "";
}
async function sessionOf(url) {
  const result = await req(url, { redirect: "manual" }),
    raw = setCookies(result.response.headers);
  const sessionId = raw.match(/sessionId=([^;,]+)/)?.[1],
    mobile = raw.match(/_login_mobile_=([^;,]+)/)?.[1];
  if (!sessionId || result.text.includes("用户手机号校验未通过")) throw new Error("登录链接失效");
  return { sessionId, mobile };
}
async function post(path, sessionId, body = {}) {
  const result = await req(`${MCS}${path}`, {
    method: "POST",
    headers: { cookie: `sessionId=${sessionId}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (result.data?.success === false)
    throw new Error(result.data.errorMessage || result.data.message || "顺丰接口失败");
  return result.data?.obj || {};
}
function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}
async function pointInfo(sessionId) {
  let pageNo = 1,
    earned = 0,
    balance = 0;
  while (pageNo <= 30) {
    const obj = await post("/commonPost/~memberIntegral~memberPoint~queryMemberPointDetail", sessionId, {
      type: "ALL",
      pageNo,
      pageSize: 10,
    });
    const rows = obj.data || [];
    balance = Number(obj.usablePoint || balance);
    for (const x of rows)
      if (String(x.createTm || "").slice(0, 10) === today() && x.opCode === "ADD") earned += Number(x.pointVal || 0);
    if (rows.length < 10 || String(rows.at(-1)?.createTm || "").slice(0, 10) < today()) break;
    pageNo += 1;
  }
  return { earned, balance };
}
async function honeyInfo(sessionId) {
  const index = await post("/commonPost/~memberNonactivity~receiveExchangeIndexService~indexData", sessionId, {});
  let pageNo = 1,
    earned = 0,
    balance = Number(index.usableHoney || 0);
  while (pageNo <= 30) {
    const obj = await post("/commonPost/~memberNonactivity~receiveExchangeIndexService~detail", sessionId, {
        pageNo,
        pageSize: 10,
      }),
      rows = obj.data || [];
    balance = Number(obj.usableHoney || balance);
    for (const x of rows)
      if (String(x.time || "").slice(0, 10) === today() && !String(x.value).startsWith("-"))
        earned += Number(x.value || 0);
    if (rows.length < 10 || String(rows.at(-1)?.time || "").slice(0, 10) < today()) break;
    pageNo += 1;
  }
  return { earned, balance, capacity: Number(index.capacity || 0) };
}
async function assets(phone) {
  const link = await accounts.get(phone, "");
  if (!link) throw new Error("本地无登录链接");
  const { sessionId } = await sessionOf(link),
    [point, honey] = await Promise.all([pointInfo(sessionId), honeyInfo(sessionId)]);
  return { phone, point, honey };
}
function render(x) {
  return [
    `账号：${mask(x.phone)}`,
    `当前蜂蜜：${x.honey.balance}`,
    `今日蜂蜜：${x.honey.earned}`,
    `蜜罐容量：${x.honey.capacity}`,
    `当前积分：${x.point.balance}`,
    `今日积分：${x.point.earned}`,
  ].join("\n");
}

async function syncQingLong(phone, link) {
  const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 }),
    name = String(cfg.env_name || "sfsyUrl"),
    rows = normalizeRows(await ql.getEnvs({ searchValue: name })).filter((x) => x.name === name),
    old = rows.find((x) => String(x.remarks || x.remark || "").includes(phone));
  const env = {
    name,
    value: encodeURIComponent(link),
    remarks: `顺丰:${phone}丨用户:${await uid()}丨手机:${mask(phone)}丨顺丰丰管理`,
  };
  if (old) return ql.updateEnv({ ...env, id: old.id ?? old._id });
  return ql.createEnv(env);
}
function normalizeRows(value) {
  let x = value;
  for (let i = 0; i < 4 && x && !Array.isArray(x); i += 1) x = x.data ?? x.items ?? x.list;
  return Array.isArray(x) ? x : [];
}
async function login() {
  const result = await qrLogin(),
    id = await uid(),
    rows = await userAccounts(id);
  await sessionOf(result.url);
  await accounts.set(result.phone, result.url);
  if (Number(cfg.default_auth_days) > 0) {
    const d = new Date();
    d.setDate(d.getDate() + Number(cfg.default_auth_days));
    await auth.set(result.phone, d.toISOString().slice(0, 10));
  }
  if (!rows.includes(result.phone)) rows.push(result.phone);
  await saveUser(id, rows);
  await syncQingLong(result.phone, result.url);
  return s.reply(`顺丰登录成功：${mask(result.phone)}，已同步青龙`);
}
async function query() {
  const rows = await userAccounts(await uid());
  if (!rows.length) return s.reply("未绑定顺丰账号，请发送“顺丰登录”");
  const out = [];
  for (const phone of rows) {
    try {
      out.push(render(await assets(phone)));
    } catch (error) {
      out.push(`${mask(phone)}：${error.message}`);
    }
  }
  return s.reply(out.join("\n------\n"));
}
async function manage() {
  const id = await uid(),
    rows = await userAccounts(id);
  if (!rows.length) return s.reply("未绑定顺丰账号，请发送“顺丰登录”");
  await s.reply(["请选择要删除的账号，Q退出", ...rows.map((x, i) => `${i + 1}. ${mask(x)}`)].join("\n"));
  const child = await s.listen({ timeout: 120000 });
  if (!child) return s.reply("输入超时");
  const input = String((await child.getMsg()) || "").trim();
  if (/^q$/i.test(input)) return s.reply("已退出");
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > rows.length) return s.reply("账号序号错误");
  const [phone] = rows.splice(n - 1, 1);
  await saveUser(id, rows);
  await accounts.delete(phone);
  await auth.delete(phone);
  const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 }),
    envs = normalizeRows(await ql.getEnvs({ searchValue: cfg.env_name })).filter((x) =>
      String(x.remarks || x.remark || "").includes(phone),
    ),
    ids = envs.map((x) => x.id ?? x._id).filter(Boolean);
  if (ids.length) await ql.deleteEnvs(ids);
  return s.reply(`已删除：${mask(phone)}`);
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Number(cfg.timeout_ms) || 20000;
    const c = String((await s.getMsg()) || "");
    if (/登录|登陆/.test(c)) return login();
    if (/查询/.test(c)) return query();
    if (/管理/.test(c)) return manage();
    return s.resume();
  } catch (error) {
    return s.reply(`顺丰丰处理失败：${String(error?.message || error).slice(0, 300)}`);
  }
}
main();

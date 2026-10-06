// [title: 京东旧版公共模块]
// [name: jdLegacyCore]
// [desc: 京东 Cookie、青龙环境变量、请求与账号解析公共能力]
// [author: sillyGirl]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://fc-ccimage.baidu.com/0/pic/-1452396718_1569556084_-7398448.jpg]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

"use strict";

function unwrap(value) {
  let data = value;
  for (let index = 0; index < 5 && data && !Array.isArray(data); index += 1)
    data = data.data ?? data.value ?? data.items ?? data.list;
  return Array.isArray(data) ? data : [];
}

function envId(value) {
  return value?.id ?? value?._id;
}
function ptPin(cookie) {
  return String(cookie || "").match(/(?:^|;\s*)pt_pin=([^;]+)/i)?.[1] || "";
}
function ptKey(cookie) {
  return String(cookie || "").match(/(?:^|;\s*)pt_key=([^;]+)/i)?.[1] || "";
}
function wskeyPin(value) {
  return String(value || "").match(/(?:^|;\s*)pin=([^;]+)/i)?.[1] || "";
}
function decode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_) {
    return String(value || "");
  }
}
function normalizeCookie(value) {
  const raw = String(value || "").replace(/[\r\n]+/g, " ");
  const key = ptKey(raw),
    pin = ptPin(raw);
  return key && pin ? `pt_key=${key};pt_pin=${pin};` : "";
}
function parseCookies(value) {
  const source = Array.isArray(value) ? value.join("\n") : String(value || "");
  const rows = [];
  for (const match of source.matchAll(/pt_key=[^;\s]+;?\s*pt_pin=[^;\s]+;?/gi)) {
    const cookie = normalizeCookie(match[0]);
    if (cookie && !rows.some((item) => ptPin(item) === ptPin(cookie))) rows.push(cookie);
  }
  return rows;
}
function parseIds(value, fallback = []) {
  const ids = String(value || "")
    .split(/[,，;；\s]+/)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? [...new Set(ids)] : fallback;
}
function errorText(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeout || 20000));
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      redirect: options.redirect || "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch (_) {}
    return {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      text,
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, options = {}) {
  const response = await request(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 180)}`);
  return response.data;
}

async function qlEnvs(ql, name = "JD_COOKIE") {
  return unwrap(await ql.getEnvs({ searchValue: name })).filter((item) => item?.name === name);
}

async function activeCookies(ql, name = "JD_COOKIE") {
  return (await qlEnvs(ql, name)).filter((item) => !item.status && normalizeCookie(item.value));
}

async function upsertEnv(ql, env, currentRows) {
  const rows = currentRows || (await qlEnvs(ql, env.name));
  const pin = ptPin(env.value);
  const old = rows.find((item) => ptPin(item.value) === pin);
  if (old) {
    await ql.updateEnv({
      name: env.name,
      value: env.value,
      remarks: env.remarks || old.remarks || old.remark || decode(pin),
      id: envId(old),
    });
    if (old.status && typeof ql.enableEnvs === "function") await ql.enableEnvs([envId(old)]);
    return { action: "updated", old };
  }
  await ql.createEnv(env);
  return { action: "created" };
}

async function validateCookie(cookie) {
  const response = await request("https://plogin.m.jd.com/cgi-bin/ml/islogin", {
    headers: { Cookie: cookie, Referer: "https://m.jd.com/", "User-Agent": mobileUa() },
  });
  const data = response.data;
  return response.ok && (data?.islogin === "1" || data?.islogin === 1 || data?.isLogin === true);
}

function mobileUa() {
  return "jdapp;iPhone;12.1.4;17.0;network/wifi;model/iPhone15,2;appBuild/168998;supportApplePay/1;hasUPPay/0;pushNoticeIsOpen/1;lang/zh_CN";
}

function cookieHeaders(cookie, extra = {}) {
  return {
    Cookie: cookie,
    Referer: "https://m.jd.com/",
    "User-Agent": mobileUa(),
    Accept: "application/json,text/plain,*/*",
    ...extra,
  };
}

module.exports = {
  unwrap,
  envId,
  ptPin,
  ptKey,
  wskeyPin,
  decode,
  normalizeCookie,
  parseCookies,
  parseIds,
  errorText,
  request,
  requestJson,
  qlEnvs,
  activeCookies,
  upsertEnv,
  validateCookie,
  mobileUa,
  cookieHeaders,
};

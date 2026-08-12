// [title: 京东CODE登录]
// [name: jdCodeLogin]
// [desc: 通过 SmallCat OAuth 获取京东 PT Cookie，并同步 JD_COOKIE 到青龙或呆呆]
// [author: smallfawn]
// [version: v1.1.3]
// [rule: ^\s*(京东登录|京东同步|京东CODE登录|[Jj][Dd]登录|[Jj][Dd]同步)\s*$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 10]
// [class: 工具]
// [icon: https://api.iconify.design/lucide:bot.svg]
// [origin: 自定义]
// [depe: []]

const http = require("http");
const https = require("https");
const { sender: s, console, plugin, user, container, utils } = require("sillygirl");

const SCRIPT_VERSION = "v1.1.3";
const JD_PT_LOGIN_URL =
  "https://plogin.m.jd.com/user/login.action?appid=300&returnurl=https%3A%2F%2Fm.jd.com%2F&source=wq_passport";
const JD_COOKIE_ENV_NAME = "JD_COOKIE";

const DEFAULTS = {
  smallcat_id: 1,
  account_mode: "authorized",
  manual_openids: "",
  accounts_json: "",
  sync_panel: "qinglong",
  qinglong_id: 1,
  daidai_id: 1,
  ql_cookie_env_name: JD_COOKIE_ENV_NAME,
  request_timeout: 30,
};

const pluginConfig = new plugin.Form({
  smallcat_id: plugin.Form.integer()
    .title("smallcat 编号")
    .description("后台 smallcat 页面里的编号，从 1 开始")
    .widget("smallcat-panel")
    .default(1),
  account_mode: plugin.Form.string()
    .title("openid 获取模式")
    .description("普通用户授权：只读取已授权本插件的账号；手动填写：按下方 openid 读取，留空读取 SmallCat 全部账号")
    .options(["authorized", "manual"])
    .default("authorized"),
  manual_openids: plugin.Form.string()
    .title("手动 openid")
    .description("仅手动填写模式生效；多个用逗号、空格或换行分隔；留空读取全部账号")
    .widget("textarea")
    .default("").visibleWhen("account_mode", "==", "manual"),
  accounts_json: plugin.Form.string()
    .title("手动账号 JSON")
    .description(
      '仅手动填写模式生效且优先于手动 openid；留空从 SmallCat 读取；示例：[{"name":"京东账号1","openid":"openid"}]',
    )
    .widget("textarea")
    .default("").visibleWhen("account_mode", "==", "manual"),
  sync_panel: plugin.Form.select([
    { label: "同步青龙", value: "qinglong" },
    { label: "同步呆呆", value: "daidai" },
  ])
    .title("同步目标")
    .description("青龙/呆呆容器编号会根据后台容器列表动态渲染")
    .default("qinglong"),
  qinglong_id: plugin.Form.integer()
    .title("青龙面板编号")
    .description("后台青龙容器页面里的编号，从 1 开始")
    .widget("qinglong-panel")
    .default(1).visibleWhen("sync_panel", "==", "qinglong"),
  daidai_id: plugin.Form.integer()
    .title("呆呆面板编号")
    .description("后台呆呆容器页面里的编号，从 1 开始")
    .widget("daidai-panel")
    .default(1).visibleWhen("sync_panel", "==", "daidai"),
  ql_cookie_env_name: plugin.Form.string().title("环境变量名").default(JD_COOKIE_ENV_NAME),
  request_timeout: plugin.Form.integer().title("请求超时秒数").min(5).max(90).default(30),
});

async function main() {
  if (!(await s.isAdmin())) {
    await s.reply("仅管理员可用");
    return;
  }

  const cfg = normalizeConfig(await pluginConfig.get());

  try {
    validateConfig(cfg);
    await s.reply(`京东Code登录已触发，正在读取 smallcat #${cfg.smallcat_id} 用户列表...`);

    const smallcat = new container.SmallCat({ id: cfg.smallcat_id });
    const accounts = await loadAccounts(cfg, smallcat);
    const panel =
      cfg.sync_panel === "daidai"
        ? new container.DaiDai({ id: cfg.daidai_id })
        : new container.QingLong({ id: cfg.qinglong_id });

    await s.reply(
      [
        "京东 PT Cookie 登录开始",
        `脚本版本：${SCRIPT_VERSION}`,
        `账号：${accounts.length}`,
        `smallcat 编号：${cfg.smallcat_id}`,
        `同步目标：${cfg.sync_panel === "daidai" ? "呆呆 #" + cfg.daidai_id : "青龙 #" + cfg.qinglong_id}`,
      ].join("\n"),
    );

    let success = 0;
    const failures = [];
    for (const account of accounts) {
      try {
        console.log(`京东 PT 登录开始：${account.name} openid=${account.openid}`);
        const cookie = await jdPtCookieLogin(cfg, smallcat, account);
        if (!normalizePtCookie(cookie)) throw new Error("登录结果缺少 pt_key/pt_pin");
        const action = await syncPanel(cfg, panel, account, cookie);
        success += 1;
        await s.reply(
          `${account.name}：${action === "update" ? "已更新" : "已创建"}${cfg.sync_panel === "daidai" ? "呆呆" : "青龙"}变量`,
        );
      } catch (err) {
        const message = userErrorMessage(err);
        failures.push(`${account.name}：${message}`);
        await s.reply(`${account.name}：失败\n${message}`);
      }
      await utils.sleep(1000);
    }

    const summary = [`完成：成功 ${success}，失败 ${accounts.length - success}`];
    if (failures.length) summary.push(failures.join("\n"));
    await s.reply(summary.join("\n"));
  } catch (err) {
    await s.reply(`京东Code登录失败：${userErrorMessage(err)}`);
  }
}

function normalizeConfig(raw) {
  const cfg = Object.assign({}, DEFAULTS, raw || {});
  cfg.smallcat_id = Number(env("SMALLCAT_ID", cfg.smallcat_id) || 1);
  cfg.account_mode = cfg.account_mode === "manual" ? "manual" : "authorized";
  cfg.manual_openids = String(cfg.manual_openids || "").trim();
  cfg.accounts_json = env("JD_ACCOUNTS_JSON", cfg.accounts_json);
  cfg.sync_panel = cfg.sync_panel === "daidai" ? "daidai" : "qinglong";
  cfg.ql_cookie_env_name = env("QL_COOKIE_ENV_NAME", cfg.ql_cookie_env_name);
  cfg.qinglong_id = Number(cfg.qinglong_id || 0);
  cfg.daidai_id = Number(cfg.daidai_id || 0);
  cfg.request_timeout = Math.max(5, Math.min(Number(cfg.request_timeout || 30), 90));
  return cfg;
}

function env(name, fallback) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : String(fallback || "").trim();
}

function validateConfig(cfg) {
  if (!Number.isInteger(cfg.smallcat_id) || cfg.smallcat_id < 1) throw new Error("smallcat 编号必须从 1 开始");
  if (cfg.sync_panel === "qinglong" && (!Number.isInteger(cfg.qinglong_id) || cfg.qinglong_id < 1))
    throw new Error("青龙面板编号必须从 1 开始");
  if (cfg.sync_panel === "daidai" && (!Number.isInteger(cfg.daidai_id) || cfg.daidai_id < 1))
    throw new Error("呆呆面板编号必须从 1 开始");
}

async function loadAccounts(cfg, smallcat) {
  if (cfg.account_mode === "manual" && cfg.accounts_json) {
    let values;
    try {
      values = JSON.parse(cfg.accounts_json);
    } catch (err) {
      throw new Error(`账号 JSON 不是有效 JSON：${err.message}`);
    }
    return normalizeAccounts(values, "账号 JSON");
  }

  if (typeof smallcat.request !== "function") throw new Error("当前 SillyGirl 版本缺少 SmallCat.request");
  const wanted =
    cfg.account_mode === "manual" ? new Set(splitOpenids(cfg.manual_openids)) : await authorizedOpenidSet();
  const payload = await smallcat.request("GET", "/api/accounts");
  let values = payload && (payload.value ?? payload.data);
  if (values && typeof values === "object" && !Array.isArray(values)) {
    values = values.data || values.list || values.items;
  }
  let accounts = normalizeAccounts(values, "smallcat 用户列表");
  if (wanted.size) accounts = accounts.filter((item) => wanted.has(item.openid));
  if (!accounts.length)
    throw new Error(
      cfg.account_mode === "manual"
        ? "手动 openid 在 SmallCat 全部账号中没有匹配项"
        : "没有普通用户授权的 SmallCat 账号",
    );
  return accounts;
}

async function authorizedOpenidSet() {
  const users = await user.getUserList();
  const allowed = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    if (!user || user.disabled || !user.authorized) continue;
    for (const openid of (user.bindings && user.bindings.smallcat_openids) || []) {
      const value = String(openid || "").trim();
      if (value) allowed.add(value);
    }
  }
  if (!allowed.size) throw new Error("没有普通用户授权的 SmallCat 账号");
  return allowed;
}

function splitOpenids(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[,，;；\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeAccounts(values, sourceName) {
  const accounts = [];
  for (const [index, item] of (Array.isArray(values) ? values : []).entries()) {
    if (!item || typeof item !== "object") continue;
    const openid = String(item.openid || item.openId || "").trim();
    if (!openid) continue;
    accounts.push({
      name: String(item.name || item.nickname || item.alias || `京东账号${index + 1}`).trim(),
      openid,
      remark: String(item.remark || "").trim(),
    });
  }
  if (!accounts.length) throw new Error(`${sourceName} 中没有有效 openid`);
  return accounts;
}

async function jdPtCookieLogin(cfg, smallcat, account) {
  const jar = new SimpleCookieJar();

  const first = await requestText(cfg, "GET", JD_PT_LOGIN_URL, {
    headers: Object.assign({}, jdPtHeaders(), {
      Referer: "https://m.jd.com/",
      "Sec-Fetch-Site": "same-site",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
      Priority: "u=0, i",
    }),
    jar,
  });
  const location = headerValue(first.headers, "location");
  if (!location || first.status < 300 || first.status >= 400) {
    throw new Error(`JD login.action 未返回 Location：HTTP ${first.status}`);
  }

  const oauthUrl = new URL(location, JD_PT_LOGIN_URL);
  const appid = oauthUrl.searchParams.get("appid") || "";
  const redirectUri = oauthUrl.searchParams.get("redirect_uri") || "";
  const scope = oauthUrl.searchParams.get("scope") || "snsapi_userinfo";
  const state = oauthUrl.searchParams.get("state") || "STATE";
  if (!appid || !redirectUri) {
    throw new Error(`JD login.action Location 缺少 appid/redirect_uri：${redactUrl(location)}`);
  }

  if (typeof smallcat.oauth !== "function") {
    throw new Error("当前 SillyGirl 版本不支持 SmallCat.oauth，请先更新主程序");
  }
  const oauthPayload = await smallcat.oauth({
    openid: account.openid,
    appid,
    redirect_uri: redirectUri,
    scope,
    state,
  });
  const oauthResult = unwrapServicePayload(oauthPayload);
  const code = nestedString(oauthResult, ["code"]);
  if (!code) {
    throw new Error(
      `smallcat /wx/oauth 未返回 code；返回字段=${Object.keys(oauthResult || {}).join(",")}; message=${responseMessage(oauthResult) || "-"}`,
    );
  }

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  const callbackUrl = callback.toString();

  const callbackRes = await requestTextFollowRedirects(
    cfg,
    "GET",
    callbackUrl,
    {
      headers: Object.assign({}, jdPtHeaders(), {
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        Priority: "u=0, i",
      }),
      jar,
    },
    8,
  );

  const cookie = normalizePtCookie(jar) || cookieFromHeaders(callbackRes.headers) || normalizePtCookie(callbackRes.raw);
  if (cookie) return cookie;

  const finalUrl = finalJdUrl(callbackRes);
  throw userActionError(
    finalUrl,
    [
      "JD wxlogincenter 未返回 pt_key/pt_pin",
      `login_status=${first.status}`,
      `callback_status=${callbackRes.status}`,
      `login_location=${redactUrl(location)}`,
      `callback=${redactUrl(callbackUrl)}`,
      `callback_location=${redactUrl(headerValue(callbackRes.headers, "location") || "") || "无"}`,
      `跳转链=${formatRedirectHops(callbackRes.hops) || "-"}`,
      `Cookie字段=${jar.names().join(",") || "无"}`,
      `页面=${htmlTitleOrPreview(callbackRes.raw) || "-"}`,
    ].join("；"),
  );
}

function jdPtHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541939) XWEB/19841 Flue",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/wxpic,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Upgrade-Insecure-Requests": "1",
  };
}

async function syncPanel(cfg, panel, account, cookie) {
  const pureCookie = normalizePtCookie(cookie);
  if (!pureCookie) throw new Error("待同步结果缺少 pt_key/pt_pin");

  const remark =
    account.remark || normalizePin(cookiePin(pureCookie)) || `JD_COOKIE自动更新-${account.name}-${account.openid}`;
  const envs = await panelEnvs(cfg, panel);
  const existing = findExistingEnv(envs, pureCookie, remark);
  if (existing) {
    const id = envId(existing);
    if (id == null || id === "") throw new Error(`已有${cfg.sync_panel === "daidai" ? "呆呆" : "青龙"}变量缺少 id/_id`);
    await panel.updateEnv({ id, name: cfg.ql_cookie_env_name, value: pureCookie, remarks: remark });
    await enablePanelEnv(cfg, panel, id);
    return "update";
  }

  await panel.createEnv({ name: cfg.ql_cookie_env_name, value: pureCookie, remarks: remark });
  return "create";
}

async function panelEnvs(cfg, panel) {
  const data =
    cfg.sync_panel === "daidai"
      ? await panel.getEnvs(cfg.ql_cookie_env_name)
      : await panel.getEnvs({ searchValue: cfg.ql_cookie_env_name });
  return envItems({ data }).filter((item) => item.name === cfg.ql_cookie_env_name);
}

function envItems(payload) {
  if (!payload || typeof payload !== "object") return [];
  const data = payload.data;
  if (Array.isArray(data)) return data.filter((item) => item && typeof item === "object");
  if (data && typeof data === "object") {
    for (const key of ["data", "list", "items", "envs", "records"]) {
      if (Array.isArray(data[key])) return data[key].filter((item) => item && typeof item === "object");
    }
    if (["name", "value", "id", "_id"].some((key) => Object.prototype.hasOwnProperty.call(data, key))) return [data];
  }
  return [];
}

function envId(item) {
  return item.id != null ? item.id : item._id;
}

async function enablePanelEnv(cfg, panel, id) {
  try {
    if (cfg.sync_panel === "daidai") await panel.enableEnv(id);
    else await panel.enableEnvs([id]);
  } catch (_) {}
}

function findExistingEnv(envs, cookie, remark) {
  const targetPin = normalizePin(cookiePin(cookie));
  const targetVariants = pinVariants(targetPin);
  for (const item of envs) {
    const oldCookie = normalizePtCookie(item.value || "");
    const oldPin = normalizePin(cookiePin(oldCookie));
    const oldRemark = String(item.remarks || item.remark || "").trim();
    if (oldPin && intersects(pinVariants(oldPin), targetVariants)) return item;
    if (oldRemark && intersects(pinVariants(oldRemark), targetVariants)) return item;
    if (oldRemark === remark || oldCookie === normalizePtCookie(cookie)) return item;
  }
  return null;
}

function intersects(a, b) {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function requestText(cfg, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const headers = Object.assign({}, options.headers || {});
    let body = null;

    if (options.data != null) {
      body = options.jsonBody === false ? options.data : JSON.stringify(options.data);
      if (typeof body === "string") body = Buffer.from(body);
      if (options.jsonBody !== false) headers["Content-Type"] = headers["Content-Type"] || "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    if (options.jar) {
      const cookie = options.jar.cookieHeader(parsed);
      if (cookie) headers.Cookie = cookie;
    }

    const req = client.request(parsed, { method: method.toUpperCase(), headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (options.jar) options.jar.addFromHeaders(res.headers, parsed);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers || {},
          raw,
        });
      });
    });
    req.setTimeout(cfg.request_timeout * 1000, () =>
      req.destroy(new Error(`请求超时 ${method.toUpperCase()} ${redactUrl(url)}`)),
    );
    req.on("error", (err) =>
      reject(new Error(`请求失败 ${method.toUpperCase()} ${redactUrl(url)}：${err.message || err}`)),
    );
    if (body) req.write(body);
    req.end();
  });
}

async function requestTextFollowRedirects(cfg, method, url, options = {}, maxRedirects = 8) {
  let current = url;
  let currentMethod = method;
  const hops = [];

  for (let index = 0; index <= maxRedirects; index++) {
    const res = await requestText(cfg, currentMethod, current, options);
    const location = headerValue(res.headers, "location");
    hops.push({
      status: res.status,
      url: current,
      location: location ? new URL(location, current).toString() : "",
      cookies: options.jar ? options.jar.names() : [],
    });

    const cookie = normalizePtCookie(options.jar) || cookieFromHeaders(res.headers) || normalizePtCookie(res.raw);
    if (cookie || res.status < 300 || res.status >= 400 || !location) {
      res.hops = hops;
      return res;
    }

    const next = new URL(location, current).toString();
    if (!isAllowedJdRedirect(next)) {
      res.hops = hops;
      throw new Error(`JD 跳转超出允许域名：${redactUrl(next)}；跳转链=${formatRedirectHops(hops)}`);
    }
    current = next;
    currentMethod = "GET";
  }

  throw new Error(`JD 跳转次数过多；跳转链=${formatRedirectHops(hops)}`);
}

function isAllowedJdRedirect(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (host === "jd.com" || host.endsWith(".jd.com") || host === "3.cn" || host.endsWith(".3.cn"))
    );
  } catch (_) {
    return false;
  }
}

function formatRedirectHops(hops) {
  return (Array.isArray(hops) ? hops : [])
    .map((hop, index) => {
      const location = hop.location ? ` -> ${redactUrl(hop.location)}` : "";
      const cookies = hop.cookies && hop.cookies.length ? ` cookies=${hop.cookies.join(",")}` : "";
      return `#${index + 1} ${hop.status} ${redactUrl(hop.url)}${location}${cookies}`;
    })
    .join(" | ");
}

function finalJdUrl(res) {
  const hops = Array.isArray(res && res.hops) ? res.hops : [];
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index] || {};
    const value = hop.location || hop.url || "";
    if (isAllowedJdRedirect(value)) return displayJdUrl(value);
  }
  const location = headerValue((res && res.headers) || {}, "location");
  if (isAllowedJdRedirect(location)) return displayJdUrl(location);
  return "";
}

function userActionError(url, debugMessage) {
  const err = new Error(debugMessage);
  err.userMessage = jdActionMessage(url);
  return err;
}

function parseJsonish(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  } catch (_) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const value = JSON.parse(text.slice(start, end + 1));
        return value && typeof value === "object" && !Array.isArray(value) ? value : { value };
      } catch (_) {}
    }
  }
  return {};
}

function unwrapServicePayload(payload) {
  if (!payload || typeof payload !== "object") return { value: payload };
  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    if (payload.status === false) throw new Error(responseMessage(payload) || "smallcat 接口业务状态失败");
    if (Object.prototype.hasOwnProperty.call(payload, "data")) return unwrapServiceData(payload.data);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "code") && Object.prototype.hasOwnProperty.call(payload, "data")) {
    const code = String(payload.code);
    if (!["0", "200", "201"].includes(code)) throw new Error(responseMessage(payload) || `接口业务状态异常：${code}`);
    return unwrapServiceData(payload.data);
  }
  return payload;
}

function unwrapServiceData(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  if (typeof data === "string" && /^[\s]*[[{]/.test(data)) {
    const decoded = parseJsonish(data);
    if (decoded) return decoded;
  }
  return { value: data };
}

function nestedValue(payload, keys) {
  const wanted = new Set(keys);
  const lower = new Set(keys.map((key) => String(key).toLowerCase()));
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload)) {
      for (const value of payload) {
        const found = nestedValue(value, keys);
        if (found != null && found !== "") return found;
      }
      return null;
    }
    for (const [key, value] of Object.entries(payload)) {
      if ((wanted.has(key) || lower.has(String(key).toLowerCase())) && value != null && value !== "") return value;
    }
    for (const value of Object.values(payload)) {
      const found = nestedValue(value, keys);
      if (found != null && found !== "") return found;
    }
  } else if (typeof payload === "string") {
    const text = payload.trim();
    if (/^[[{]/.test(text)) {
      try {
        return nestedValue(JSON.parse(text), keys);
      } catch (_) {}
    }
  }
  return null;
}

function nestedString(payload, keys) {
  const value = nestedValue(payload, keys);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function responseMessage(payload) {
  const value = nestedValue(payload, ["errmsg", "errMsg", "message", "msg", "error", "retMsg", "retmsg"]);
  if (value && typeof value === "object") return JSON.stringify(value).slice(0, 300);
  return String(value || "")
    .trim()
    .slice(0, 300);
}

function normalizePtCookie(cookie) {
  if (cookie instanceof SimpleCookieJar) {
    const ptKey = cookie.get("pt_key");
    const ptPin = cookie.get("pt_pin");
    return ptKey && ptPin ? `pt_key=${ptKey};pt_pin=${ptPin};` : "";
  }
  const text = String(cookie || "");
  const key = text.match(/(?:^|[;?,\s])pt_key=([^;?,\s]+)/);
  const pin = text.match(/(?:^|[;?,\s])pt_pin=([^;?,\s]+)/);
  return key && pin ? `pt_key=${key[1]};pt_pin=${pin[1]};` : "";
}

function cookieFromHeaders(headers) {
  const setCookies = allHeaderValues(headers, "set-cookie");
  for (const value of setCookies) {
    const cookie = normalizePtCookie(value);
    if (cookie) return cookie;
  }
  return "";
}

function cookiePin(cookie) {
  const pure = normalizePtCookie(cookie);
  const match = pure.match(/(?:^|[;,\s])pt_pin=([^;,\s]+)/);
  return match ? match[1] : "";
}

function normalizePin(pin) {
  const raw = String(pin || "").trim();
  if (!raw) return "";
  try {
    return encodeURIComponent(decodeURIComponent(raw));
  } catch (_) {
    return raw;
  }
}

function pinVariants(pin) {
  const raw = String(pin || "").trim();
  const values = new Set();
  if (!raw) return values;
  values.add(raw);
  try {
    values.add(decodeURIComponent(raw));
  } catch (_) {}
  try {
    values.add(encodeURIComponent(raw));
    values.add(encodeURIComponent(decodeURIComponent(raw)));
  } catch (_) {}
  return new Set([...values].filter(Boolean));
}

function htmlTitleOrPreview(raw) {
  const text = htmlUnescape(String(raw || ""));
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title && title[1]) return safePreview(title[1].replace(/\s+/g, " ").trim(), 120);
  return safePreview(
    text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    160,
  );
}

function htmlUnescape(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function safePreview(value, limit) {
  return redactSecretText(String(value || "")).slice(0, limit || 160);
}

function redactSecretText(text) {
  return String(text || "")
    .replace(/(pt_key=)[^;,\s]+/gi, "$1***")
    .replace(/([A-Za-z0-9_-]{32,})/g, (value) => `${value.slice(0, 4)}...${value.slice(-4)}`);
}

function redactUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_) {
    return String(value || "");
  }
}

function headerValue(headers, name) {
  const values = allHeaderValues(headers, name);
  return values.length ? values[0] : "";
}

function allHeaderValues(headers, name) {
  const target = String(name).toLowerCase();
  const values = [];
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() !== target) continue;
    if (Array.isArray(value)) values.push(...value.map(String));
    else if (value != null) values.push(String(value));
  }
  return values;
}

class SimpleCookieJar {
  constructor() {
    this.values = [];
  }

  addFromHeaders(headers, requestUrl) {
    for (const line of allHeaderValues(headers, "set-cookie")) {
      const parts = String(line || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      const first = parts.shift() || "";
      const index = first.indexOf("=");
      if (index <= 0) continue;
      const name = first.slice(0, index).trim();
      const value = first.slice(index + 1).trim();
      if (!name) continue;

      const attrs = {};
      for (const part of parts) {
        const attrIndex = part.indexOf("=");
        const key = (attrIndex >= 0 ? part.slice(0, attrIndex) : part).trim().toLowerCase();
        const attrValue = attrIndex >= 0 ? part.slice(attrIndex + 1).trim() : "";
        attrs[key] = attrValue;
      }

      const host = requestUrl && requestUrl.hostname ? requestUrl.hostname.toLowerCase() : "";
      const domain = normalizeCookieDomain(attrs.domain || host);
      const path = attrs.path || "/";
      const expired = value === "" || isExpiredCookie(attrs.expires);
      this.delete(name, domain, path);
      if (!expired) this.values.push({ name, value, domain, path });
    }
  }

  get(name) {
    const found = this.values.find((item) => item.name === name && item.value);
    return found ? found.value : "";
  }

  names() {
    return [...new Set(this.values.filter((item) => item.value).map((item) => item.name))].sort();
  }

  delete(name, domain, path) {
    this.values = this.values.filter((item) => !(item.name === name && item.domain === domain && item.path === path));
  }

  cookieHeader(requestUrl) {
    const url = requestUrl instanceof URL ? requestUrl : new URL(String(requestUrl || "https://jd.com/"));
    const host = url.hostname.toLowerCase();
    const path = url.pathname || "/";
    return this.values
      .filter((item) => item.value && domainMatches(host, item.domain) && path.startsWith(item.path || "/"))
      .map((item) => `${item.name}=${item.value}`)
      .join("; ");
  }
}

function normalizeCookieDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
}

function domainMatches(host, domain) {
  const normalized = normalizeCookieDomain(domain);
  return host === normalized || host.endsWith("." + normalized);
}

function isExpiredCookie(expires) {
  if (!expires) return false;
  const time = Date.parse(expires);
  return Number.isFinite(time) && time <= Date.now();
}

function errorMessage(err) {
  return err && err.message ? String(err.message) : String(err || "");
}

function userErrorMessage(err) {
  if (err && err.userMessage) return String(err.userMessage);
  const message = errorMessage(err);
  if (isJdDebugFailure(message)) {
    return jdActionMessage(lastJdUrlFromText(message));
  }
  return message;
}

function jdActionMessage(url) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) {
    return "未获取到京东 Cookie，京东登录需要继续处理，但本次没有返回可打开链接，请稍后重试。";
  }
  const action = /\/joinlogin\/bind(?:$|[/?#])/.test(cleanUrl) ? "完成微信绑定" : "完成京东登录处理";
  return `未获取到京东 Cookie，请打开以下链接${action}后重试：\n${cleanUrl}`;
}

function isJdDebugFailure(message) {
  return /pt_key|pt_pin|wxlogincenter|login_status|callback_status|login_location|callback_location|跳转链|Cookie字段|页面=/.test(
    String(message || ""),
  );
}

function lastJdUrlFromText(message) {
  const matches = String(message || "").match(/https:\/\/[A-Za-z0-9.-]*(?:jd\.com|3\.cn)[^\s；|]+/g) || [];
  for (let index = matches.length - 1; index >= 0; index--) {
    const value = matches[index].replace(/[),，。]+$/g, "");
    if (isAllowedJdRedirect(value)) return displayJdUrl(value);
  }
  return "";
}

function displayJdUrl(value) {
  try {
    return new URL(value).toString();
  } catch (_) {
    return String(value || "").trim();
  }
}

if (globalThis.__JD_CODE_LOGIN_TEST__) {
  module.exports = { normalizeConfig, loadAccounts, normalizeAccounts, splitOpenids };
} else {
  main().catch(async (err) => {
    try {
      await s.reply(`京东Code登录异常：${userErrorMessage(err)}`);
    } catch (_) {
      console.error("京东Code登录异常", err);
    }
  });
}

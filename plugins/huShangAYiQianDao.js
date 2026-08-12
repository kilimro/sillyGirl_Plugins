// [title: 沪上阿姨签到]
// [name: huShangAYiQianDao]
// [desc: 基于 SmallCat 微信账号完成沪上阿姨会员登录和小满活动每日签到]
// [author: sillyGirl]
// [version: v1.2.1]
// [rule: ^\s*(沪上阿姨|沪上签到|[Hh][Uu][Ss][Hh][Ee][Nn][Gg])\s*(查询|强制|dry-run|force)?\s*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 10]
// [class: 工具]
// [icon: https://api.iconify.design/lucide:bot.svg]
// [origin: backup/沪上阿姨_v1.0.2_By.mrconli.py]
// [depe: []]

"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const zlib = require("node:zlib");
const { sender: s, console, plugin, container, user } = require("sillygirl");

const TOKEN_SECRET_B64 = "SjdoOCZeQmdzNSNibio3aG4lIT1raDMwOCpidjIhc14=";
const SIGN_SECRET_B64 = "dWgzJEhnJl5ISzg3NiVnYnhWRzdmJCVwPTBNfj5zMXg=";
const TOKEN_SECRET = Buffer.from(TOKEN_SECRET_B64, "base64").toString("utf8");
const SIGN_SECRET = Buffer.from(SIGN_SECRET_B64, "base64").toString("utf8");
const QMAI_APP_ID = "wxd92a2d29f8022f40";
const QMAI_STORE_ID = "201424";
const SIGN_PRIZE_FUNCTION_ID = 100540000;
const DEFAULT_OA_OPENID = "null";
const DEFAULT_CHANNEL_CODE = "scrm_uubct8r8ote4anz";
const DEFAULT_FLOW_SCENE = 1179;
const ACTIVITY_ENTRY_URL = String(
  process.env.HUSHENG_ACTIVITY_ENTRY_URL ||
    "https://p7955695914055-hsay.bx-index.meta-huanxuan.com/xm/activity/place/7955695914055/54-95107-06erzhqq6e/v1-hdzyhsay",
);
const QMAI_BASE_URL = String(process.env.HUSHENG_QMAI_BASE_URL || "https://webapi.qmai.cn").replace(/\/+$/, "");
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 " +
  "MicroMessenger/8.0.75(0x18004b37) NetType/WIFI Language/zh_CN " +
  "miniProgram/wxd92a2d29f8022f40";
const NANOID_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

const DEFAULTS = {
  smallcat_id: 1,
  account_mode: "authorized",
  manual_openids: "",
  account_selector: "",
  dry_run: false,
  force: false,
  date: "",
  user_agent: DEFAULT_USER_AGENT,
  channel_code: DEFAULT_CHANNEL_CODE,
  flow_scene: DEFAULT_FLOW_SCENE,
  oa_openid: DEFAULT_OA_OPENID,
  proxy_url: "",
  request_timeout: 20,
  debug: false,
};

const pluginConfig = new plugin.Form({
  smallcat_id: plugin.Form.integer()
    .title("smallcat 编号")
    .description("后台 smallcat 页面里的编号，从 1 开始")
    .widget("smallcat-panel")
    .min(1)
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
  account_selector: plugin.Form.string()
    .title("执行账号")
    .description("留空取首个可用账号；可填序号、openid、昵称；填“全部”执行全部可用账号")
    .default(""),
  dry_run: plugin.Form.boolean().title("仅查询").description("只查询状态，不提交签到").default(false),
  force: plugin.Form.boolean().title("强制签到").description("已签到时仍提交一次").default(false),
  date: plugin.Form.string().title("签到日期").description("留空使用当天，格式 YYYY-MM-DD").default(""),
  user_agent: plugin.Form.string().title("User-Agent").default(DEFAULT_USER_AGENT),
  channel_code: plugin.Form.string().title("注册渠道").default(DEFAULT_CHANNEL_CODE),
  flow_scene: plugin.Form.integer().title("flowScene").default(DEFAULT_FLOW_SCENE),
  oa_openid: plugin.Form.string().title("公众号 openid").description("通常保持 null").default(DEFAULT_OA_OPENID),
  proxy_url: plugin.Form.string()
    .title("业务请求代理")
    .description("留空使用 SmallCat 账号 proxyUrl；支持 http/https 代理")
    .default(""),
  request_timeout: plugin.Form.integer().title("请求超时秒数").min(5).max(90).default(20),
  debug: plugin.Form.boolean().title("调试日志").default(false),
});
class NotMemberError extends Error {}
class PhoneAlreadyBoundError extends Error {
  constructor(message) {
    super(message);
    this.maskedPhone = phoneMask(message);
  }
}

function md5Hex(text) {
  return crypto.createHash("md5").update(String(text), "utf8").digest("hex");
}

function nowMs() {
  return String(Date.now());
}

function randomNonce(size, randomBytes) {
  const length = size === undefined ? 32 : size;
  const bytes = randomBytes || crypto.randomBytes(length);
  let output = "";
  for (let index = 0; index < length; index++) output += NANOID_ALPHABET[bytes[index] % NANOID_ALPHABET.length];
  return output;
}

function phoneMask(value) {
  const text = String(value || "").trim();
  let match = text.match(/(1\d{2})\d{4}(\d{4})/);
  if (match) return match[1] + "****" + match[2];
  match = text.match(/(1\d{2})\*{3,4}(\d{4})/);
  return match ? match[1] + "****" + match[2] : "";
}

function maskText(value, keep) {
  const text = String(value || "");
  const count = keep === undefined ? 4 : keep;
  if (!text) return "";
  if (text.length <= count * 2) return "*".repeat(text.length);
  return text.slice(0, count) + "***" + text.slice(-count);
}

function formatMobile(value) {
  return maskText(String(value || "")) || "未绑定";
}

function jsStringifyValue(value) {
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  return String(value);
}

function calcXmSign(params, options) {
  const dropNull = Boolean(options && options.dropNull);
  const values = [];
  for (const key of Object.keys(params || {}).sort()) {
    const value = params[key];
    if (dropNull && (value === null || value === "null")) continue;
    values.push(jsStringifyValue(value));
  }
  return md5Hex(values.join("") + SIGN_SECRET);
}

function appendQuery(rawUrl, params) {
  if (!params || !Object.keys(params).length) return rawUrl;
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.append(key, String(value));
  }
  return url.href;
}

function todayText(date) {
  const value = date || new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function qmaiHeaders(userAgent, token) {
  return {
    "Qm-From": "wechat",
    "Qm-From-Type": "catering",
    "Qm-User-Token": String(token || ""),
    "store-id": QMAI_STORE_ID,
    "User-Agent": userAgent,
    Referer: "https://servicewechat.com/" + QMAI_APP_ID + "/459/page-frame.html",
    "Content-Type": "application/json",
  };
}

class HttpSession {
  constructor(proxyUrl, timeout) {
    this.proxyUrl = String(proxyUrl || "").trim();
    this.timeout = timeout;
  }

  async request(method, rawUrl, options, redirects) {
    const opts = options || {};
    const count = redirects || 0;
    if (count > 8) throw new Error("HTTP 重定向次数过多");
    const url = new URL(rawUrl);
    const headers = Object.assign(
      { Accept: "application/json,text/plain,*/*", "Accept-Encoding": "gzip, deflate, br" },
      opts.headers || {},
    );
    let body = opts.body;
    if (Object.prototype.hasOwnProperty.call(opts, "json")) {
      body = JSON.stringify(opts.json);
      if (!hasHeader(headers, "content-type")) headers["Content-Type"] = "application/json";
    }
    if (body !== undefined && body !== null) {
      body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      if (!hasHeader(headers, "content-length")) headers["Content-Length"] = body.length;
    }
    const response = await requestOnce(
      url,
      String(method || "GET").toUpperCase(),
      headers,
      body,
      this.timeout,
      this.proxyUrl,
    );
    response.url = url.href;
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      const next = new URL(response.headers.location, url).href;
      const originalMethod = String(method || "GET").toUpperCase();
      const toGet = response.status === 303 || ([301, 302].includes(response.status) && originalMethod === "POST");
      return this.request(
        toGet ? "GET" : originalMethod,
        next,
        toGet ? { headers: stripBodyHeaders(headers) } : opts,
        count + 1,
      );
    }
    return response;
  }

  async json(method, rawUrl, options) {
    const response = await this.request(method, rawUrl, options);
    try {
      return JSON.parse(response.text);
    } catch (_) {
      throw new Error("响应不是 JSON：HTTP " + response.status + " " + response.text.slice(0, 300));
    }
  }

  async finalUrl(rawUrl, headers) {
    return (await this.request("GET", rawUrl, { headers: headers || {} })).url;
  }
}

async function requestOnce(url, method, headers, body, timeout, proxyUrl) {
  const proxy = proxyUrl ? new URL(proxyUrl) : null;
  if (proxy && !["http:", "https:"].includes(proxy.protocol)) throw new Error("不支持的代理协议：" + proxy.protocol);
  if (proxy && url.protocol === "http:") {
    const proxyHeaders = Object.assign({}, headers, { Host: url.host });
    addProxyAuth(proxyHeaders, proxy);
    return performRequest(
      proxy.protocol === "https:" ? https : http,
      {
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
        method: method,
        path: url.href,
        headers: proxyHeaders,
        rejectUnauthorized: false,
      },
      body,
      timeout,
    );
  }
  if (proxy && url.protocol === "https:") {
    const socket = await connectTunnel(proxy, url, timeout);
    return performRequest(
      https,
      {
        hostname: url.hostname,
        port: url.port || 443,
        method: method,
        path: url.pathname + url.search,
        headers: headers,
        rejectUnauthorized: false,
        agent: false,
        createConnection: function createConnection() {
          return socket;
        },
      },
      body,
      timeout,
    );
  }
  const module = url.protocol === "https:" ? https : http;
  return performRequest(
    module,
    {
      hostname: url.hostname,
      port: url.port || undefined,
      method: method,
      path: url.pathname + url.search,
      headers: headers,
      rejectUnauthorized: false,
    },
    body,
    timeout,
  );
}

function connectTunnel(proxy, target, timeout) {
  return new Promise(function executor(resolve, reject) {
    const headers = { Host: target.hostname + ":" + (target.port || 443) };
    addProxyAuth(headers, proxy);
    const module = proxy.protocol === "https:" ? https : http;
    const req = module.request({
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: target.hostname + ":" + (target.port || 443),
      headers: headers,
      rejectUnauthorized: false,
    });
    req.setTimeout(timeout, function onTimeout() {
      req.destroy(new Error("代理 CONNECT 超时"));
    });
    req.once("error", reject);
    req.once("connect", function onConnect(response, socket, head) {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error("代理 CONNECT 状态 " + response.statusCode));
        return;
      }
      if (head && head.length) socket.unshift(head);
      const secure = tls.connect({ socket: socket, servername: target.hostname, rejectUnauthorized: false });
      secure.setTimeout(timeout, function tlsTimeout() {
        secure.destroy(new Error("TLS 超时"));
      });
      secure.once("secureConnect", function ready() {
        resolve(secure);
      });
      secure.once("error", reject);
    });
    req.end();
  });
}

function performRequest(module, requestOptions, body, timeout) {
  return new Promise(function executor(resolve, reject) {
    const req = module.request(requestOptions, function onResponse(response) {
      const chunks = [];
      response.on("data", function onData(chunk) {
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", function onEnd() {
        try {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            text: decompress(Buffer.concat(chunks), response.headers["content-encoding"]).toString("utf8"),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(timeout, function onTimeout() {
      req.destroy(new Error("HTTP 请求超时 " + timeout + "ms"));
    });
    req.on("error", reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

function decompress(buffer, encoding) {
  const value = String(encoding || "").toLowerCase();
  if (value.includes("gzip")) return zlib.gunzipSync(buffer);
  if (value.includes("deflate")) return zlib.inflateSync(buffer);
  if (value.includes("br")) return zlib.brotliDecompressSync(buffer);
  return buffer;
}

function addProxyAuth(headers, proxy) {
  if (proxy.username || proxy.password) {
    const login = decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password);
    headers["Proxy-Authorization"] = "Basic " + Buffer.from(login).toString("base64");
  }
}

function stripBodyHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!["content-length", "content-type"].includes(key.toLowerCase())) output[key] = value;
  }
  return output;
}

function hasHeader(headers, name) {
  const expected = String(name).toLowerCase();
  return Object.keys(headers).some(function match(key) {
    return key.toLowerCase() === expected;
  });
}

class HsayClient {
  constructor(activityUrl, userAgent, proxyUrl, timeout) {
    this.activityUrl = activityUrl;
    const parsed = new URL(activityUrl);
    this.li = parsed.searchParams.get("li") || "";
    if (!this.li) throw new Error("activity_url 缺少 li 参数");
    this.origin = parsed.origin;
    this.userAgent = userAgent || DEFAULT_USER_AGENT;
    this.http = new HttpSession(proxyUrl, timeout);
  }

  async headers(method, options) {
    const opts = options || {};
    const params = opts.params || {};
    const body = opts.body || {};
    const nonce = randomNonce();
    const timestamp = nowMs();
    const signParams = Object.assign({}, params, body, { nonceStr: nonce, xmTimestamp: timestamp });
    if (String(method).toUpperCase() === "GET") delete signParams.functionId;
    const source = Object.keys(body).length ? body : params;
    const headers = {
      "User-Agent": this.userAgent,
      Referer: this.activityUrl,
      functionId: String(opts.functionId || source.functionId || 0),
      nonceStr: nonce,
      xmTimestamp: timestamp,
    };
    if (opts.needToken) {
      const token = await this.getUserToken(nonce, timestamp);
      headers.xmToken = token;
      signParams.xmToken = token;
    }
    headers.xmSign = calcXmSign(signParams);
    if (String(method).toUpperCase() === "POST") {
      headers.Origin = this.origin;
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  async api(method, path, options) {
    const opts = options || {};
    const headers = await this.headers(method, opts);
    const requestOptions = { headers: headers };
    if (Object.prototype.hasOwnProperty.call(opts, "body")) requestOptions.json = opts.body;
    const data = await this.http.json(method, appendQuery(this.origin + path, opts.params), requestOptions);
    const code = data && typeof data === "object" ? String(data.code === undefined ? "" : data.code) : "";
    if (code && code !== "0")
      throw new Error("接口返回失败 code=" + code + "：" + (data.desc || data.message || safeJson(data, 300)));
    return data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "data") ? data.data : data;
  }

  async getUserToken(parentNonce, parentTimestamp) {
    const tokenSign = md5Hex(this.li + parentNonce + parentTimestamp + TOKEN_SECRET);
    const data = await this.api("GET", "/xm/token/getUserToken", {
      params: { timestamp: parentTimestamp, nonceStr: parentNonce, tokenSign: tokenSign },
    });
    if (typeof data !== "string" || !data.includes("@")) throw new Error("获取 xmToken 失败：" + safeJson(data, 300));
    return data;
  }

  async getSignConfig(dateText) {
    const data = await this.api("GET", "/sign/getConfig", { params: { curDate: dateText } });
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("签到配置异常：" + safeJson(data, 300));
    return data;
  }

  async getPrizeList(functionId) {
    const data = await this.api("GET", "/activity/function/getPrizeList", {
      params: { functionId: functionId || SIGN_PRIZE_FUNCTION_ID, filterThank: 1 },
    });
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("奖品列表异常：" + safeJson(data, 300));
    return data;
  }

  async sign(dateText) {
    const data = await this.api("POST", "/sign/action", { body: { patchDate: dateText }, needToken: true });
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("签到响应异常：" + safeJson(data, 300));
    return data;
  }

  async prepareActivity() {
    const steps = [
      ["GET", "/activity/function/getThemeConfig"],
      ["GET", "/activity/getGlobalConfig", { params: { key: "xmLogoSwitch" } }],
      ["POST", "/behavior/log", { body: { behaviorId: 1011000 } }],
      ["POST", "/activity/function/task/handleTask"],
      ["GET", "/activity/function/getConfig"],
      ["GET", "/message/notice"],
      ["GET", "/activity/function/getUserAccount"],
      ["GET", "/activity/getThresholdConfig"],
    ];
    for (const step of steps) await this.api(step[0], step[1], step[2]);
  }
}

function pickPrize(signResult) {
  const action = (signResult && signResult.actionResult) || {};
  const pop = action.actionPop || {};
  if (pop.title || pop.subTitle) return ((pop.title || "") + " " + (pop.subTitle || "")).trim();
  const rewards = (action.actionAward && action.actionAward.rewardList) || [];
  if (rewards.length && rewards[0] && typeof rewards[0] === "object") {
    return String(rewards[0].prizeName || rewards[0].name || safeJson(rewards[0]));
  }
  return "无奖品信息";
}

function findTodayMcConf(config, dateText) {
  const list = config && config.dateInfoList;
  if (!Array.isArray(list)) return {};
  let fallback = {};
  for (const item of list) {
    if (!item || typeof item !== "object" || !item.mcConf || typeof item.mcConf !== "object") continue;
    if (String(item.curDate || "") === dateText) return item.mcConf;
    const start = String(item.mcConf.startDate || "");
    const end = String(item.mcConf.endDate || "");
    if (start && end && start <= dateText && dateText <= end) fallback = item.mcConf;
  }
  return fallback;
}

function extractPrizeTitles(prizeData, options) {
  const opts = options || {};
  const limit = opts.limit === undefined ? 6 : opts.limit;
  const scene = opts.prizeSceneType === undefined || opts.prizeSceneType === null ? "" : String(opts.prizeSceneType);
  const configs = prizeData && prizeData.functionPrizeConfig;
  if (!Array.isArray(configs)) return [];
  const titles = [];
  const seen = new Set();
  for (const config of configs) {
    if (!config || !Array.isArray(config.prizeList)) continue;
    for (const prize of config.prizeList) {
      if (!prize || typeof prize !== "object") continue;
      if (scene && String(prize.prizeSceneType || "") !== scene) continue;
      const title = String(prize.prizeTitle || prize.prizeName || prize.name || "").trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
      if (titles.length >= limit) return titles;
    }
  }
  return titles;
}

function formatTodaySignDetail(config, prizeData, dateText) {
  const mcConf = findTodayMcConf(config, dateText);
  const title = String(mcConf.title || "").trim();
  const prizes = extractPrizeTitles(prizeData, { prizeSceneType: mcConf.prizeSceneType });
  if (title && prizes.length) return "今日签到信息：" + title + "；可见奖励池：" + prizes.join("、");
  if (title) return "今日签到信息：" + title;
  if (prizes.length) return "今日签到信息：可见奖励池：" + prizes.join("、");
  return "";
}

class HushengRunner {
  constructor(smallcat, account, cfg) {
    this.smallcat = smallcat;
    this.openid = account.openid;
    this.userAgent = cfg.user_agent;
    this.timeout = cfg.request_timeout * 1000;
    this.channelCode = cfg.channel_code;
    this.flowScene = cfg.flow_scene;
    this.oaOpenid = cfg.oa_openid;
    this.proxyUrl = cfg.proxy_url || account.proxyUrl || "";
    this.debug = cfg.debug;
    this.http = new HttpSession(this.proxyUrl, this.timeout);
    this.lines = [];
  }

  log(message, level) {
    const line = "[" + (level || "INFO") + "] " + message;
    this.lines.push(line);
    if (this.debug) console.log(line);
  }

  async getWxCode() {
    const payload = unwrapSmallCat(await this.smallcat.getCode({ openid: this.openid, appid: QMAI_APP_ID }));
    const code = findDeepValue(payload, ["code", "wxcode", "wx_code", "logincode"], /^[0-9a-zA-Z_-]{8,4096}$/);
    if (!code) throw new Error("SmallCat wx.login 取码失败：" + (responseMessage(payload) || safeJson(payload, 240)));
    return code;
  }

  async getPhoneCode() {
    if (typeof this.smallcat.getPhoneNumber !== "function")
      return { code: "", error: "SmallCat.getPhoneNumber 接口缺失" };
    let raw;
    try {
      raw = await this.smallcat.getPhoneNumber({ openid: this.openid, appid: QMAI_APP_ID });
      const payload = unwrapSmallCat(raw);
      const code = findDeepValue(payload, ["phonecode", "phone_code", "code"], /^[0-9a-zA-Z_-]{8,1024}$/);
      return code ? { code: code } : { code: "", error: formatPhoneFailure(raw, payload) };
    } catch (error) {
      return { code: "", error: formatPhoneFailure(raw, error) };
    }
  }

  async qmaiRequest(method, path, token, body, params) {
    const options = { headers: qmaiHeaders(this.userAgent, token) };
    if (body !== undefined) options.json = body;
    const payload = await this.http.json(method, appendQuery(QMAI_BASE_URL + path, params), options);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("qmai 响应异常：" + safeJson(payload, 300));
    if (String(payload.code) !== "0") {
      if (String(payload.code) === "10012")
        throw new PhoneAlreadyBoundError(String(payload.message || "手机号已经被绑定"));
      throw new Error("qmai 接口失败 code=" + payload.code + "：" + (payload.message || safeJson(payload, 300)));
    }
    return payload;
  }

  async qmaiMiniLogin(wxCode) {
    const payload = await this.qmaiRequest("POST", "/web/account-center/oauth/mini-app-login", "", {
      code: wxCode,
      eVersion: "1.0",
      appid: QMAI_APP_ID,
    });
    const data = payload.data || {};
    if (!data.user || !data.user.id) throw new Error("qmai 登录响应缺少会员 id：" + safeJson(payload, 300));
    return data;
  }

  async qmaiExitLogin(token) {
    try {
      await this.qmaiRequest("POST", "/web/account-center/oauth/exitLogin", token, { appid: QMAI_APP_ID });
    } catch (error) {
      if (errorText(error).includes("20000") || errorText(error).includes("用户不存在")) return;
      throw error;
    }
  }

  async qmaiBindMobile(phoneCode, token) {
    const payload = await this.qmaiRequest("POST", "/web/account-center/oauth/bind-mobile", token, {
      code: phoneCode,
      reg_activity_source: 0,
      is_update_mobile: 0,
      channel_code: this.channelCode,
      flowScene: this.flowScene,
      eVersion: "1.0",
      appid: QMAI_APP_ID,
    });
    const loginToken = (payload.data && payload.data.loginToken) || {};
    if (!loginToken.user || !loginToken.user.id) throw new Error("绑定手机号后缺少会员 id：" + safeJson(payload, 300));
    return loginToken;
  }

  async getActivityAuthPage(customerId) {
    const entry = appendQuery(ACTIVITY_ENTRY_URL, { platform: 3, openId: customerId });
    const finalUrl = await this.http.finalUrl(entry, { "User-Agent": this.userAgent });
    if (finalUrl.includes("not_member")) throw new NotMemberError("该微信号不是沪上阿姨会员或未绑定手机号");
    if (!finalUrl.includes("xm_open_auth2.html")) throw new Error("活动入口未返回授权页：" + finalUrl);
    return finalUrl;
  }

  async refreshActivityUrlByAuthRedirect(authPageUrl) {
    const parsed = new URL(authPageUrl);
    let redirectUrl = parsed.searchParams.get("redirect") || "";
    if (!redirectUrl) throw new Error("授权页中没有 redirect 参数");
    try {
      redirectUrl = decodeURIComponent(redirectUrl);
    } catch (_) {}
    redirectUrl += "&oaOpenId=" + encodeURIComponent(String(this.oaOpenid || "null")) + "&nickName=null&avatar=null";
    const finalUrl = await this.http.finalUrl(redirectUrl, {
      "User-Agent": this.userAgent,
      Referer: "https://yl-auth.meta-xuantan.com/",
    });
    if (!finalUrl.includes("saas_marketing_signin.html") || !finalUrl.includes("li=")) {
      throw new Error("未拿到活动页 li，最终 URL：" + finalUrl);
    }
    return finalUrl;
  }

  async runSignFlow(activityUrl, dateText, dryRun, force) {
    const client = new HsayClient(activityUrl, this.userAgent, this.proxyUrl, this.timeout);
    const summary = { date: dateText, li: maskText(client.li) };
    const config = await client.getSignConfig(dateText);
    const status = Number(config.curSignStatus || 0);
    const signedDays = config.signedDays;
    summary.signedDays = signedDays;
    this.log(dateText + " 当前签到状态：" + (status === 1 ? "已签到" : "未签到") + "，本月已签 " + signedDays + " 天");
    if (dryRun || (status === 1 && !force)) {
      try {
        const detail = formatTodaySignDetail(config, await client.getPrizeList(), dateText);
        if (detail) {
          this.log(detail);
          summary.detail = detail;
        }
      } catch (error) {
        this.log("今日签到信息获取失败：" + errorText(error), "WARNING");
      }
    }
    if (dryRun) {
      this.log("dry-run：只查询状态，未提交签到。");
      summary.result = "dry-run";
      return summary;
    }
    if (status === 1 && !force) {
      this.log("今日已签到，本月已签 " + signedDays + " 天，跳过提交。", "SUCCESS");
      summary.result = "已签到";
      return summary;
    }
    this.log("执行活动初始化，刷新签到前置状态");
    await client.prepareActivity();
    const result = await client.sign(dateText);
    const prize = pickPrize(result);
    this.log("签到成功：" + prize, "SUCCESS");
    summary.prize = prize;
    const latest = await client.getSignConfig(dateText);
    const latestStatus = Number(latest.curSignStatus || 0);
    summary.signedDays = latest.signedDays;
    this.log("复查签到状态：" + (latestStatus === 1 ? "已签到" : "未签到"));
    summary.result = latestStatus === 1 ? "签到成功" : "已提交但复查未签到";
    return summary;
  }

  async run(accountLabel, cfg) {
    let label = accountLabel;
    try {
      const code = await this.getWxCode();
      this.log(label + "：wx.login code 获取成功", "SUCCESS");
      let loginData = await this.qmaiMiniLogin(code);
      let user = loginData.user || {};
      let customerId = String(user.id || "");
      let mobile = String(user.mobile || "");
      label = accountLabel || maskText(customerId);
      this.log(label + "：qmai 登录成功，会员 id=" + maskText(customerId) + " 手机=" + formatMobile(mobile), "SUCCESS");
      if (!mobile && !cfg.dry_run) {
        this.log(label + "：当前会员未绑定手机号，尝试授权绑定", "WARNING");
        let token = String(loginData.token || "");
        if (token) await this.qmaiExitLogin(token);
        const freshCode = await this.getWxCode();
        loginData = await this.qmaiMiniLogin(freshCode);
        user = loginData.user || {};
        customerId = String(user.id || "");
        mobile = String(user.mobile || "");
        if (!mobile) {
          token = String(loginData.token || "");
          const phone = await this.getPhoneCode();
          if (phone.code && token) {
            try {
              loginData = await this.qmaiBindMobile(phone.code, token);
              user = loginData.user || {};
              customerId = String(user.id || "");
              mobile = String(user.mobile || "");
              this.log(label + "：绑定成功，手机=" + formatMobile(mobile), "SUCCESS");
            } catch (error) {
              if (!(error instanceof PhoneAlreadyBoundError)) throw error;
              this.log(
                label +
                  "：手机号 " +
                  (error.maskedPhone || "已绑定") +
                  " 已绑定在其它 qmai 会员，改用当前会员继续尝试签到",
                "WARNING",
              );
            }
          } else {
            this.log(
              label + "：未取得手机号授权 code（" + (phone.error || "响应字段为空") + "），尝试直接以当前会员继续",
              "WARNING",
            );
          }
        }
      }
      if (!customerId) throw new Error("qmai 登录后缺少会员 id");
      const authPageUrl = await this.getActivityAuthPage(customerId);
      this.log(label + "：活动入口已返回授权页，使用授权回跳刷新活动 li");
      const activityUrl = await this.refreshActivityUrlByAuthRedirect(authPageUrl);
      const sign = await this.runSignFlow(activityUrl, cfg.date, cfg.dry_run, cfg.force);
      return { success: true, account: label, sign: sign, viaProxy: Boolean(this.proxyUrl) };
    } catch (error) {
      const message = errorText(error);
      this.log(label + "：签到异常：" + message, error instanceof NotMemberError ? "WARNING" : "ERROR");
      return { success: false, account: label, error: message };
    }
  }
}

function normalizeConfig(raw) {
  const source = raw || {};
  const cfg = Object.assign({}, DEFAULTS, source);
  cfg.smallcat_id = positiveInt(cfg.smallcat_id, 1);
  cfg.account_mode = cfg.account_mode === "manual" ? "manual" : "authorized";
  cfg.manual_openids = String(cfg.manual_openids || "").trim();
  cfg.account_selector = String(cfg.account_selector || "").trim();
  cfg.dry_run = yes(cfg.dry_run);
  cfg.force = yes(cfg.force);
  cfg.date = String(cfg.date || "").trim() || todayText();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.date)) throw new Error("签到日期格式应为 YYYY-MM-DD");
  cfg.user_agent = String(cfg.user_agent || "").trim() || DEFAULT_USER_AGENT;
  cfg.channel_code = String(cfg.channel_code || "").trim() || DEFAULT_CHANNEL_CODE;
  cfg.flow_scene = positiveInt(cfg.flow_scene, DEFAULT_FLOW_SCENE);
  cfg.oa_openid = String(cfg.oa_openid || "").trim() || DEFAULT_OA_OPENID;
  cfg.proxy_url = String(cfg.proxy_url || "").trim();
  cfg.request_timeout = Math.max(5, Math.min(positiveInt(cfg.request_timeout, 20), 90));
  cfg.debug = yes(cfg.debug);
  return cfg;
}

function parseCommand(content) {
  const match = String(content || "").match(/^\s*(沪上阿姨|沪上签到|husheng)\s*(查询|强制|dry-run|force)?\s*$/i);
  if (!match) throw new Error("命令格式：沪上阿姨 [查询|强制]");
  const action = String(match[2] || "").toLowerCase();
  return {
    dryRun: action === "查询" || action === "dry-run",
    force: action === "强制" || action === "force",
  };
}

function normalizeAccounts(payload) {
  let items = Array.isArray(payload)
    ? payload
    : payload && (payload.items || payload.list || payload.accounts || payload.value);
  if (!Array.isArray(items) && items && typeof items === "object") items = items.items || items.list || items.data;
  return (Array.isArray(items) ? items : [])
    .filter(function valid(item) {
      return item && typeof item === "object";
    })
    .map(function clean(item) {
      return Object.assign({}, item, {
        openid: String(item.openid || item.openId || item.userKey || "").trim(),
        disabled: yes(item.disabled),
        proxyUrl: String(item.proxyUrl || item.proxy_url || "").trim(),
      });
    })
    .filter(function hasOpenid(item) {
      return item.openid;
    });
}

async function loadSmallcatAccounts(smallcat, cfg) {
  if (typeof smallcat.request !== "function") throw new Error("当前 SillyGirl 版本缺少 SmallCat.request");
  const wanted =
    cfg.account_mode === "manual" ? new Set(splitOpenids(cfg.manual_openids)) : await authorizedOpenidSet();
  const accounts = normalizeAccounts(unwrapSmallCat(await smallcat.request("GET", "/api/accounts")));
  return wanted.size
    ? accounts.filter(function allowed(item) {
        return wanted.has(item.openid);
      })
    : accounts;
}

async function authorizedOpenidSet() {
  if (!user || typeof user.getUserList !== "function") throw new Error("当前 SillyGirl 版本缺少 user.getUserList");
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
  return Array.from(
    new Set(
      String(value || "")
        .split(/[,，;；\s]+/)
        .map(function trim(item) {
          return item.trim();
        })
        .filter(Boolean),
    ),
  );
}

function selectAccounts(users, selector) {
  const enabled = users.filter(function active(item) {
    return !item.disabled;
  });
  if (!enabled.length) throw new Error("SmallCat 用户列表没有可用账号");
  const text = String(selector || "").trim();
  if (!text) return [enabled[0]];
  if (/^(all|全部|所有)$/i.test(text)) return enabled;
  if (/^\d+$/.test(text)) {
    const item = enabled[Number(text) - 1];
    if (!item) throw new Error("SmallCat 可用账号序号 " + text + " 不存在");
    return [item];
  }
  const lower = text.toLowerCase();
  const item = enabled.find(function find(user) {
    return [user.openid, user.displayName, user.nickname, user.name, user.remark].some(function same(value) {
      return (
        String(value || "")
          .trim()
          .toLowerCase() === lower
      );
    });
  });
  if (!item) throw new Error("SmallCat 未找到账号：" + text);
  return [item];
}

function accountName(account) {
  return String(account.displayName || account.nickname || account.name || account.remark || account.openid || "账号");
}

function unwrapSmallCat(payload) {
  if (!payload || typeof payload !== "object") return decodeJsonStrings(payload);
  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    if (payload.status === false) throw new Error(responseMessage(payload) || "SmallCat 接口失败");
    if (Object.prototype.hasOwnProperty.call(payload, "data")) return decodeJsonStrings(payload.data);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "code") && Object.prototype.hasOwnProperty.call(payload, "data")) {
    if (!["0", "200", "201"].includes(String(payload.code)))
      throw new Error(responseMessage(payload) || "SmallCat 状态码 " + payload.code);
    return decodeJsonStrings(payload.data);
  }
  return decodeJsonStrings(payload);
}

function decodeJsonStrings(value, depth) {
  const level = depth || 0;
  if (level > 6 || typeof value !== "string") return value;
  const text = value.trim();
  if (!/^[[{]/.test(text)) return value;
  try {
    return decodeJsonStrings(JSON.parse(text), level + 1);
  } catch (_) {
    return value;
  }
}

function findDeepValue(node, keyPatterns, valuePattern, depth) {
  const level = depth || 0;
  if (level > 12 || node === null || node === undefined) return "";
  if (typeof node === "string") {
    const decoded = decodeJsonStrings(node);
    return decoded !== node ? findDeepValue(decoded, keyPatterns, valuePattern, level + 1) : "";
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDeepValue(item, keyPatterns, valuePattern, level + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof node !== "object") return "";
  const expected = keyPatterns.map(function lower(key) {
    return String(key).toLowerCase();
  });
  for (const [key, value] of Object.entries(node)) {
    if (!expected.includes(key.toLowerCase()) || value === null || typeof value === "object") continue;
    const text = String(value).trim();
    if (!valuePattern || valuePattern.test(text)) return text;
  }
  for (const value of Object.values(node)) {
    const found = findDeepValue(value, keyPatterns, valuePattern, level + 1);
    if (found) return found;
  }
  return "";
}

function responseMessage(payload) {
  if (!payload || typeof payload !== "object") return String(payload || "");
  const decodedData = decodeJsonStrings(payload.data);
  const nested = decodedData && typeof decodedData === "object" ? responseMessage(decodedData) : "";
  let direct = "";
  for (const key of ["message", "msg", "errmsg", "error", "errMsg"]) {
    if (!payload[key]) continue;
    direct = typeof payload[key] === "string" ? payload[key] : safeJson(payload[key], 300);
    break;
  }
  if (direct && nested && direct !== nested) return direct + "：" + nested;
  return direct || nested;
}

function formatPhoneFailure(raw, detail) {
  const rawDecoded = decodeJsonTree(raw);
  const detailDecoded = detail instanceof Error ? detail.message : decodeJsonTree(detail);
  const needAuth = hasDeepFlag(rawDecoded, "need_auth") || hasDeepFlag(detailDecoded, "need_auth");
  const messages = [];
  if (needAuth) messages.push("need_auth=true（微信要求用户确认手机号授权，本次没有返回临时 code）");
  const message = detail instanceof Error ? errorText(detail) : responseMessage(detailDecoded);
  const outerMessage = responseMessage(rawDecoded);
  if (message) messages.push(message);
  if (outerMessage && !messages.includes(outerMessage)) messages.push(outerMessage);
  const rawText = safeJson(rawDecoded, 800);
  if (rawText && rawText !== "undefined") messages.push("SmallCat原始响应=" + rawText);
  return messages.join("；") || "SmallCat 响应缺少手机号临时 code";
}

function decodeJsonTree(value, depth) {
  const level = depth || 0;
  if (level > 8 || value === null || value === undefined) return value;
  const decoded = decodeJsonStrings(value);
  if (decoded !== value) return decodeJsonTree(decoded, level + 1);
  if (Array.isArray(value))
    return value.map(function decode(item) {
      return decodeJsonTree(item, level + 1);
    });
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = decodeJsonTree(item, level + 1);
    return output;
  }
  return value;
}

function hasDeepFlag(value, expectedKey, depth) {
  const level = depth || 0;
  if (level > 12 || value === null || value === undefined) return false;
  const decoded = decodeJsonStrings(value);
  if (decoded !== value) return hasDeepFlag(decoded, expectedKey, level + 1);
  if (Array.isArray(value))
    return value.some(function check(item) {
      return hasDeepFlag(item, expectedKey, level + 1);
    });
  if (typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === String(expectedKey).toLowerCase() && yes(item)) return true;
    if (hasDeepFlag(item, expectedKey, level + 1)) return true;
  }
  return false;
}

function formatAccountOutput(result, lines) {
  const summary =
    result && result.success
      ? "结果：成功 | " +
        result.sign.date +
        " | " +
        result.sign.result +
        " | 本月已签 " +
        result.sign.signedDays +
        " 天"
      : "结果：失败 | " + ((result && result.error) || "未知错误");
  return lines.concat([summary]).join("\n");
}

function safeJson(value, max) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (_) {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return max !== undefined && text.length > max ? text.slice(0, max) : text;
}

function yes(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function errorText(error) {
  return error && error.message ? String(error.message) : String(error);
}

async function main() {
  const cfg = normalizeConfig(await pluginConfig.get());
  try {
    const input = parseCommand(String((await s.getMsg()) || ""));
    if (input.dryRun) cfg.dry_run = true;
    if (input.force) cfg.force = true;
    const smallcat = new container.SmallCat({ id: cfg.smallcat_id });
    const accounts = selectAccounts(await loadSmallcatAccounts(smallcat, cfg), cfg.account_selector);
    await s.reply("沪上阿姨签到开始：SmallCat #" + cfg.smallcat_id + "，账号 " + accounts.length + " 个");
    const outputs = [];
    for (const account of accounts) {
      const runner = new HushengRunner(smallcat, account, cfg);
      const result = await runner.run(accountName(account), cfg);
      outputs.push(formatAccountOutput(result, runner.lines));
    }
    await s.reply(outputs.join("\n\n"));
  } catch (error) {
    await s.reply("沪上阿姨签到执行失败：" + errorText(error));
  }
}

main().catch(async function fatal(error) {
  try {
    await s.reply("沪上阿姨签到异常：" + errorText(error));
  } catch (_) {
    console.error("沪上阿姨签到异常", error);
  }
});

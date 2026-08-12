// [title: 中国移动10086签到]
// [name: chinaMobileToken]
// [language: nodejs]
// [class: 工具]
// [author: SillyGirl]
// [version: v1.0.1]
// [public: true]
// [status: true]
// [admin: false]
// [uses_smallcat: true]
// [rule: raw ^(中国移动签到|移动签到|10086签到|中国移动token|移动token|10086token)$]
// [rule: raw ^(中国移动签到|移动签到|10086签到)\s+(\S+)$]
// [icon: https://api.iconify.design/lucide:key-round.svg]
// [desc: 通过 smallcat OAuth 获取中国移动 10086 微信授权 Cookie 并完成每日签到。两种模式：授权模式（自动签到 smallcat 面板内全部账号）；手动模式（在插件配置填写 OpenID 列表，留空则同样读取 smallcat 面板内全部账号）。]

const { Bucket, container, plugin, sender, user } = require("sillygirl");

const DEFAULT_APPID = "wx43a850f87498127d";
const DEFAULT_SCOPE = "snsapi_base";
// 注意：redirect_uri 直接用「无 token 的活动页入口」（变体 B），不要带写死的 sid/token。
// 带写死 sid 的 bindAccount/new 链接会因 sid 过期导致 qwhdsso/redirect 校验失败、
// 拿不到 QWHD_SESSION_TOKEN，最终签到报「需要去登录」。活动页加载时由服务端重新签发会话。
const DEFAULT_REDIRECT_URI =
  "https://wx.10086.cn/qwhdhub/qwhdmark/1021122301?ys=JHQD9999999999&touch_id=15-02-10001-7353-01";
// 无 token 的活动页（签到 Referer 用，不依赖每日变化的 sid）
const DEFAULT_ACTIVITY_URL =
  "https://wx.10086.cn/qwhdhub/qwhdmark/1021122301?ys=JHQD9999999999&touch_id=15-02-10001-7353-01#/";
const WECHAT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541939) XWEB/19841 Flue";

const MARK_URL = "https://wx.10086.cn/qwhdhub/api/mark/do/mark";

const configForm = new plugin.Form({
  // 运行模式用通用条件隐藏：字段名任意，规则由 .visibleWhen("mode","==","手动模式") 声明在 schema 里，
  // 前端读 ui:visibleWhen 自动联动，不再依赖前端写死的 account_mode 特例。
  mode: plugin.Form.select([
    { label: "授权模式", value: "授权模式" },
    { label: "手动模式", value: "手动模式" },
  ])
    .title("运行模式")
    .default("授权模式"),

  panel_id: plugin.Form.integer()
    .title("smallcat 编号")
    .description("后台 smallcat 面板编号，从 1 开始；本项在后台以下拉形式选择")
    .widget("smallcat-panel")
    .default(1)
    .min(1),

  appid: plugin.Form.string().title("AppID").default(DEFAULT_APPID).required(),
  scope: plugin.Form.string().title("Scope").default(DEFAULT_SCOPE).required(),
  redirect_uri: plugin.Form.string()
    .title("活动页地址（第一段 OAuth 入口）")
    .description(
      "必须填「无 token 的活动页入口」（默认值即可）。插件会用它发起第一段 OAuth 并自动提取当日 SSO sid，无需任何手写 sid。请勿改成 bindAccount/new 链接。",
    )
    .default(DEFAULT_REDIRECT_URI)
    .required(),
  state: plugin.Form.string().title("State").default(""),

  activity_url: plugin.Form.string().title("签到活动页").default(DEFAULT_ACTIVITY_URL).required(),

  // 手动模式专属：留空则读取 smallcat 面板内全部账号。
  // 用 .visibleWhen("mode","==","手动模式") 声明：仅当模式为「手动模式」时才显示。
  manual_openids: plugin.Form.string()
    .title("手动模式 OpenID 列表（仅手动模式）")
    .description(
      "仅「手动模式」生效；每行/逗号/空格分隔一个 OpenID。留空则读取 smallcat 面板内全部账号。授权模式下忽略本项。",
    )
    .widget("textarea")
    .visibleWhen("mode", "==", "手动模式")
    .default(""),
  // 手动模式逃逸入口：直接提供已签权的 Cookie（含 QWHD_SESSION_TOKEN），跳过 OAuth。
  // 同样用 .visibleWhen 声明仅在「手动模式」显示。
  manual_cookie: plugin.Form.string()
    .title("手动模式 Cookie（逃逸）")
    .description(
      "可选。手动模式下填写：直接提供已签权的 Cookie（含 QWHD_SESSION_TOKEN），跳过 OAuth。留空则按 OpenID 自动获取。",
    )
    .visibleWhen("mode", "==", "手动模式")
    .default(""),

  base_cookie: plugin.Form.string()
    .title("基础 Cookie")
    .description("可选。只填写你自己的 Cookie；不填则只使用服务端 Set-Cookie。")
    .default(""),
  user_agent: plugin.Form.string().title("User-Agent").default(WECHAT_UA),
  timeout_sec: plugin.Form.integer().title("请求超时秒数").default(30).min(5).max(120),
  save_cookie: plugin.Form.boolean().title("保存 Cookie").default(true),
});

const store = new Bucket("china_mobile_token");

function text(value) {
  return String(value ?? "").trim();
}

function pickData(value) {
  if (value && typeof value === "object" && "data" in value) {
    return value.data;
  }
  return value;
}

function firstString(value, keys) {
  if (!value || typeof value !== "object") {
    return "";
  }
  for (const key of keys) {
    const current = value[key];
    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
  }
  return "";
}

function extractFullURL(payload) {
  const data = pickData(payload);
  const direct = firstString(data, ["full_url", "fullUrl", "url", "redirect_url"]);
  if (direct) {
    return direct;
  }
  const nested = pickData(data);
  return firstString(nested, ["full_url", "fullUrl", "url", "redirect_url"]);
}

function collectOpenIDs(value, out = []) {
  if (!value) {
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectOpenIDs(item, out);
    }
    return out;
  }
  if (typeof value !== "object") {
    return out;
  }
  const openid = firstString(value, ["openid", "open_id", "wxOpenid", "userKey"]);
  if (openid) {
    out.push(openid);
  }
  for (const key of ["data", "items", "accounts", "list", "users", "records"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectOpenIDs(value[key], out);
    }
  }
  return out;
}

function uniq(values) {
  return [...new Set((values || []).map(text).filter(Boolean))];
}

async function openidsFromBoundUsers() {
  const rows = await user.getUserList({ withRecords: true }).catch(() => []);
  const openids = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const bindings = row && row.bindings;
    collectOpenIDs(bindings && bindings.smallcat_openids, openids);
    collectOpenIDs(row && row.smallcat_openids, openids);
  }
  return uniq(openids);
}

async function openidsFromSmallcat(smallcat) {
  try {
    if (typeof smallcat.userList !== "function") return [];
    const list = await smallcat.userList();
    return uniq(collectOpenIDs(list));
  } catch (e) {
    return [];
  }
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs);
    }),
  ]);
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function seedCookies(base) {
  const m = new Map();
  for (const p of String(base || "").split(";")) {
    const t = p.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) m.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return m;
}

// 跟随重定向累加 Cookie。
// opts.stopAtAuthorize=true：遇到微信 authorize 地址即停下并返回（不真正进入微信，避免卡在 200 页面），
//   同时把沿途 Set-Cookie 累加进 cookieMap（供第二阶段复用）。
// opts.cookieMap：可传入已积累的 Cookie（第二阶段复用第一阶段的 Cookie）。
async function followWithCookies(startURL, config, opts = {}) {
  const cookieMap = opts.cookieMap || seedCookies(config.base_cookie);
  const stopAtAuthorize = !!opts.stopAtAuthorize;
  const maxHops = opts.maxHops || 15;
  let current = startURL;
  let httpStatus = 0;
  let authorizeURL = null;
  for (let hop = 0; hop <= maxHops; hop++) {
    const cookieHeader = [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const host = new URL(current).host;
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Host: host,
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": text(config.user_agent) || WECHAT_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Cookie: cookieHeader,
      },
    });
    httpStatus = response.status;
    for (const line of responseSetCookies(response)) {
      const pair = String(line).split(";")[0].trim();
      const idx = pair.indexOf("=");
      if (idx > 0) {
        cookieMap.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
    const loc = response.headers.get("location");
    if (stopAtAuthorize && loc && loc.includes("open.weixin.qq.com/connect/oauth2/authorize")) {
      authorizeURL = loc;
      break;
    }
    if (response.status >= 300 && response.status < 400) {
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }
    await response.text().catch(() => "");
    break;
  }
  return { cookieMap, authorizeURL, httpStatus };
}

// 经 smallcat 两段式 OAuth 换取会话 Cookie（核心修复：自动获取当日有效 SSO sid，无需手写过期 sid）
// 流程：
//   ① smallcat.oauth(redirect_uri=活动页) → 活动页?code=A → 跟随到 bindAccount → 微信 authorize 地址
//      （该 authorize 地址的 redirect_uri 里已包含 bindAccount 现场签发的当日 sid）
//   ② 解析出该 bindAccount 回跳地址，再 smallcat.oauth 一次 → bindAccount?code=B → qwhdsso/redirect?sid=当日&wmhToken
//      → 活动页 → 服务端签发 QWHD_SESSION_TOKEN
// 注意：第一阶段 redirect_uri 必须是「活动页」（而非 bindAccount），否则无法触发 sid 签发。
async function acquireCookie(openid, config, timeoutMs) {
  const smallcat = new container.SmallCat({ id: config.panel_id || 1 });
  const activity = text(config.redirect_uri) || DEFAULT_REDIRECT_URI;
  const oauthArgs = {
    appid: text(config.appid) || DEFAULT_APPID,
    scope: text(config.scope) || DEFAULT_SCOPE,
    openid,
    state: text(config.state),
  };

  // —— 第一段：活动页 → 捕获微信 authorize 地址（内含当日 sid）——
  const oauth1 = await withTimeout(
    smallcat.oauth({ ...oauthArgs, redirect_uri: activity }),
    timeoutMs,
    "smallcat OAuth(1) ",
  );
  const full1 = extractFullURL(oauth1);
  if (!full1) {
    throw new Error("smallcat OAuth 未返回 full_url: " + JSON.stringify(oauth1).slice(0, 200));
  }
  const stage1 = await withTimeout(
    followWithCookies(full1, config, { stopAtAuthorize: true, maxHops: 20 }),
    timeoutMs,
    "中国移动请求(1) ",
  );
  const authorizeURL = stage1.authorizeURL;
  if (!authorizeURL) {
    throw new Error("未捕获到微信授权地址（无法获取当日 SSO sid），请确认 smallcat 面板账号状态正常");
  }
  let bindRedirect = "";
  try {
    bindRedirect = new URL(authorizeURL).searchParams.get("redirect_uri") || "";
  } catch (e) {
    bindRedirect = "";
  }
  if (!bindRedirect) {
    throw new Error("未能从微信授权地址解析出 bindAccount 回跳地址");
  }

  // —— 第二段：用带当日 sid 的 bindAccount 回跳地址再 OAuth 一次，完成 SSO ——
  const oauth2 = await withTimeout(
    smallcat.oauth({ ...oauthArgs, redirect_uri: bindRedirect }),
    timeoutMs,
    "smallcat OAuth(2) ",
  );
  const full2 = extractFullURL(oauth2);
  if (!full2) {
    throw new Error("smallcat OAuth(2) 未返回 full_url: " + JSON.stringify(oauth2).slice(0, 200));
  }
  const stage2 = await withTimeout(
    followWithCookies(full2, config, { cookieMap: stage1.cookieMap, maxHops: 20 }),
    timeoutMs,
    "中国移动请求(2) ",
  );
  const cookie = [...stage2.cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  // 签到只认 QWHD_SESSION_TOKEN，缺失即等于「未登录」。提前报错，避免白打一次签到接口。
  if (!/QWHD_SESSION_TOKEN=/.test(cookie)) {
    throw new Error(
      `未获取到 QWHD_SESSION_TOKEN（HTTP ${stage2.httpStatus}）。两段式 OAuth 失败，请检查 smallcat 账号与 appid 是否匹配该公众号。`,
    );
  }
  return cookie;
}

// 签到：POST /qwhdhub/api/mark/do/mark，鉴权只认 Cookie（QWHD_SESSION_TOKEN）
async function doSign(cookie, config, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(MARK_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        Host: "wx.10086.cn",
        "login-check": "1",
        "Content-Type": "application/json",
        "User-Agent": text(config.user_agent) || WECHAT_UA,
        Accept: "application/json, text/plain, */*",
        Referer: text(config.activity_url) || DEFAULT_ACTIVITY_URL,
        Cookie: cookie,
      },
      body: "{}",
      signal: ctrl.signal,
    });
    const body = await resp.text().catch(() => "");
    let json = {};
    try {
      json = JSON.parse(body);
    } catch (e) {
      /* ignore */
    }
    return { status: resp.status, raw: json, text: body };
  } finally {
    clearTimeout(t);
  }
}

function interpretSignResult(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, label: "未知返回" };
  }
  const code = raw.code ?? raw.status;
  const msg = text(raw.msg);
  const success = raw.success === true;
  const isDone =
    /TODAY_MARKED|今天已签到|已签到|重复签到|already/i.test(msg) ||
    code === "TODAY_MARKED" ||
    raw.status === "TODAY_MARKED";
  if (success || code === 0 || code === "0" || isDone || /成功/.test(msg)) {
    return { ok: true, label: isDone ? "已完成(今日已签到)" : msg || "签到成功" };
  }
  return { ok: false, label: msg || "未知结果 code=" + String(code) };
}

function maskOpenid(o) {
  o = text(o);
  return o.length > 6 ? o.slice(0, 6) + "***" : o;
}

function parseOpenids(raw) {
  return String(raw || "")
    .split(/[\s,;，；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  if (sender.isAdmin && !(await sender.isAdmin())) {
    await sender.reply("无权限：请使用傻妞管理员/master 账号执行签到");
    return;
  }

  const config = await configForm.get();
  const timeoutMs = Math.max(5, Math.min(Number(config.timeout_sec) || 30, 120)) * 1000;

  // 命令后追加的 openid 优先（规则：^(...)\s+(\S+)$）
  const explicit = sender.param ? await sender.param(2) : "";
  let targets = [];
  if (text(explicit)) {
    targets = [text(explicit)];
  } else if (text(config.mode) === "手动模式") {
    const manual = parseOpenids(config.manual_openids);
    if (manual.length) targets = manual;
  }
  if (!targets.length) {
    const smallcat = new container.SmallCat({ id: config.panel_id || 1 });
    const list = await openidsFromSmallcat(smallcat);
    if (list.length) targets = list;
  }
  if (!targets.length) {
    const bound = await openidsFromBoundUsers();
    if (bound.length) targets = bound;
  }
  if (!targets.length) {
    return sender.reply(
      "❌ 未找到任何 OpenID。请确认：\n" +
        "• 手动模式：在插件配置填写「手动模式 OpenID 列表」，或确保 smallcat 面板内有已绑定账号\n" +
        "• 授权模式：确保 smallcat 面板内有已授权账号\n" +
        "（当前 smallcat 面板编号：" +
        (config.panel_id || 1) +
        "）",
    );
  }

  await sender.reply(
    `📱 中国移动10086签到（模式：${text(config.mode) === "手动模式" ? "手动模式" : "授权模式"} / 共 ${targets.length} 个账号）`,
  );

  const results = [];
  const manualCookie = text(config.manual_cookie);
  for (const openid of targets) {
    try {
      let cookie = manualCookie;
      if (!cookie) {
        cookie = await acquireCookie(openid, config, timeoutMs);
      }
      if (!cookie) throw new Error("未获取到 Cookie");
      const sign = await doSign(cookie, config, timeoutMs);
      const interp = interpretSignResult(sign.raw);
      if (interp.ok && config.save_cookie !== false) {
        await store.set(openid, {
          openid,
          cookie,
          updated_at: Date.now(),
        });
      }
      results.push(`• ${maskOpenid(openid)}：${interp.ok ? "✅" : "❌"} ${interp.label}`);
    } catch (e) {
      results.push(`• ${maskOpenid(openid)}：❌ ${e.message}`);
    }
  }

  const okCount = results.filter((r) => r.includes("✅")).length;
  await sender.reply(["—— 共 " + targets.length + " 个，成功 " + okCount + " 个", ...results].join("\n"));
}

main().catch((error) => sender.reply(`❌ 签到失败：${error.message}`));

// [title: 天翼云盘签到]
// [name: tianYiYunPanQianDao]
// [desc: 天翼云盘账号密码登录、每日签到及三项抽奖任务]
// [author: hdbjlizhe]
// [version: v1.0.0]
// [rule: ^天翼云盘(教程|登录|登陆|查询|运行|一键运行|管理|授权|清理)$]
// [cron: 0 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/天翼云盘签到_v1.0.0_By.hdbjlizhe.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { createPublicKey, publicEncrypt, constants } = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const LOGIN_GATE =
  "https://m.cloud.189.cn/udb/udb_login.jsp?pageId=1&pageKey=default&clientType=wap&redirectURL=https://m.cloud.189.cn/zhuanti/2021/shakeLottery/index.html";
const LOGIN_SUBMIT = "https://open.e.189.cn/api/logbox/oauth2/loginSubmit.do";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 5.1.1; SM-G930K Build/NRD90M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.136 Mobile Safari/537.36 Ecloud/8.6.3 Android/22 clientId/355325117317828 clientModel/SM-G930K imsi/460071114317824 clientChannelId/qq proVersion/1.0.6";

class CookieSession {
  constructor(ctx) {
    this.ctx = ctx;
    this.jar = new Map();
    this.extraHeaders = {};
  }
  cookie() {
    return [...this.jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  absorb(headers) {
    let rows = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    if (!rows.length && headers.get("set-cookie")) rows = headers.get("set-cookie").split(/,(?=\s*[^;,=]+=[^;,]*)/);
    for (const row of rows) {
      const first = String(row).split(";", 1)[0],
        cut = first.indexOf("=");
      if (cut > 0) this.jar.set(first.slice(0, cut).trim(), first.slice(cut + 1).trim());
    }
  }
  async request(url, options = {}, redirects = 0) {
    if (redirects > 8) throw new Error("登录重定向次数过多");
    const headers = {
      "user-agent": options.userAgent || "Mozilla/5.0",
      ...this.extraHeaders,
      ...(options.headers || {}),
    };
    const cookie = this.cookie();
    if (cookie) headers.cookie = cookie;
    let body = options.body;
    if (options.form) {
      body = new URLSearchParams(options.form).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), options.timeout || this.ctx.config.timeout || 15000);
    let response;
    try {
      response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
        dispatcher: this.ctx.config.dispatcher || undefined,
      });
    } finally {
      clearTimeout(timer);
    }
    this.absorb(response.headers);
    if (response.status >= 300 && response.status < 400 && response.headers.get("location"))
      return this.request(
        new URL(response.headers.get("location"), url).href,
        { headers: options.headers, userAgent: options.userAgent },
        redirects + 1,
      );
    const text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return { text, url: response.url, status: response.status };
  }
  async json(url, options) {
    const response = await this.request(url, options);
    try {
      return JSON.parse(response.text);
    } catch (_) {
      throw new Error(`接口返回非JSON：${response.text.slice(0, 160)}`);
    }
  }
}

function html(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
function capture(text, pattern, label) {
  const found = String(text).match(pattern);
  if (!found?.[1]) throw new Error(`登录页缺少${label}`);
  return html(found[1]);
}
function rsaHex(publicKeyBody, value) {
  const body = String(publicKeyBody).replace(/-----[^-]+-----|\s+/g, "");
  const pem = `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
  return publicEncrypt(
    { key: createPublicKey(pem), padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(String(value)),
  ).toString("hex");
}

async function login(ctx, username, password) {
  const session = new CookieSession(ctx);
  const gate = await session.request(LOGIN_GATE);
  const loginUrl = capture(gate.text, /(https?:\/\/[^\s'"<>]+)/i, "统一登录地址");
  const first = await session.request(loginUrl);
  const tabUrl = capture(first.text, /<a\s+id=["']j-tab-login-link["'][^>]*href=["']([^"']+)/i, "账号登录地址");
  const page = await session.request(new URL(tabUrl, loginUrl).href);
  const captchaToken = capture(page.text, /captchaToken['"]?\s+value=['"]([^'"]+)/i, "captchaToken");
  const lt = capture(page.text, /\blt\s*=\s*["']([^"']+)/i, "lt");
  const returnUrl = capture(page.text, /\breturnUrl\s*=\s*["']([^"']+)/i, "returnUrl");
  const paramId = capture(page.text, /\bparamId\s*=\s*["']([^"']+)/i, "paramId");
  const rsaKey = capture(page.text, /j_rsaKey["']?\s+value=["']([^"']+)/i, "RSA公钥");
  session.extraHeaders.lt = lt;
  const result = await session.json(LOGIN_SUBMIT, {
    method: "POST",
    headers: { referer: "https://open.e.189.cn/" },
    form: {
      appKey: "cloud",
      accountType: "01",
      userName: `{RSA}${rsaHex(rsaKey, username)}`,
      password: `{RSA}${rsaHex(rsaKey, password)}`,
      validateCode: "",
      captchaToken,
      returnUrl,
      mailSuffix: "@189.cn",
      paramId,
    },
  });
  if (!result.toUrl) throw new Error(result.msg || `登录失败 result=${result.result}`);
  await session.request(result.toUrl);
  if (!session.cookie()) throw new Error("登录完成但未取得会话Cookie");
  return { username, password, cookie: session.cookie(), updatedAt: new Date().toISOString() };
}

function restore(ctx, token) {
  let data;
  try {
    data = JSON.parse(token);
  } catch (_) {
    data = { cookie: String(token || "") };
  }
  const session = new CookieSession(ctx);
  for (const part of String(data.cookie || "").split(/;\s*/)) {
    const cut = part.indexOf("=");
    if (cut > 0) session.jar.set(part.slice(0, cut), part.slice(cut + 1));
  }
  return { data, session };
}
function taskHeaders() {
  return {
    "user-agent": MOBILE_UA,
    referer: "https://m.cloud.189.cn/zhuanti/2016/sign/index.jsp?albumBackupOpened=1",
    "accept-encoding": "gzip, deflate",
  };
}
async function signAndDraw(ctx, token) {
  let { data, session } = restore(ctx, token);
  const requestSign = async () => {
    const result = await session.json(
      `https://api.cloud.189.cn/mkt/userSign.action?rand=${Date.now()}&clientType=TELEANDROID&version=8.6.3&model=SM-G930K`,
      { headers: taskHeaders() },
    );
    if (result.isSign === undefined && result.netdiskBonus === undefined)
      throw new Error(result.errorMsg || result.message || "登录状态失效");
    return result;
  };
  let signed;
  try {
    signed = await requestSign();
  } catch (error) {
    if (!data.username || !data.password) throw error;
    data = await login(ctx, data.username, data.password);
    ({ session } = restore(ctx, JSON.stringify(data)));
    signed = await requestSign();
  }
  const lines = [
    `${String(signed.isSign) === "false" ? "签到成功" : "今日已签到"}，获得${signed.netdiskBonus ?? 0}M空间`,
  ];
  const tasks = ["TASK_SIGNIN", "TASK_SIGNIN_PHOTOS", "TASK_2022_FLDFS_KJ"];
  for (let index = 0; index < tasks.length; index++) {
    try {
      const result = await session.json(
        `https://m.cloud.189.cn/v2/drawPrizeMarketDetails.action?taskId=${tasks[index]}&activityId=ACT_SIGNIN`,
        { headers: taskHeaders() },
      );
      lines.push(
        result.errorCode
          ? `抽奖${index + 1}：${result.errorMsg || result.errorCode}`
          : `抽奖${index + 1}：${result.description || "完成"}`,
      );
    } catch (error) {
      lines.push(`抽奖${index + 1}：${error.message}`);
    }
  }
  data.cookie = session.cookie();
  data.updatedAt = new Date().toISOString();
  return { data, lines };
}

const runtime = createAccountRuntime({
  title: "天翼云盘签到",
  shortName: "天翼云盘",
  prefix: "TY_CLOUD",
  defaultEnvName: "tianyi_cloud",
  orderPrefix: "TYC",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入账号#密码，多账号换行", 120000);
    if (raw === null) return [];
    const rows = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#");
      if (cut < 1 || cut === line.length - 1) throw new Error("格式应为 账号#密码");
      const username = line.slice(0, cut).trim(),
        data = await login(ctx, username, line.slice(cut + 1));
      rows.push({
        account: username,
        token: JSON.stringify(data),
        remark: username.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2"),
      });
    }
    return rows;
  },
  async query(ctx, item) {
    const result = await signAndDraw(ctx, item.token);
    await ctx.tokens.set(item.account, JSON.stringify(result.data));
    return result.lines.join("\n");
  },
  async handle(ctx, content) {
    if (!/运行/.test(content)) return;
    const userId = await ctx.currentUserId(),
      accounts = JSON.parse((await ctx.users.get(userId, "[]")) || "[]"),
      output = [];
    for (const account of accounts) {
      try {
        const result = await signAndDraw(ctx, await ctx.tokens.get(account, ""));
        await ctx.tokens.set(account, JSON.stringify(result.data));
        output.push(`${await ctx.remarks.get(account, account)}：${result.lines.join("；")}`);
      } catch (error) {
        output.push(`${account}：${error.message}`);
      }
    }
    return ctx.sender.reply(output.length ? output.join("\n") : "未绑定天翼云盘账号");
  },
  async cronCheck(ctx, item) {
    const result = await signAndDraw(ctx, item.token);
    await ctx.tokens.set(item.account, JSON.stringify(result.data));
    return result.lines.join("；");
  },
  envValue(_ctx, item) {
    const data = JSON.parse(item.token);
    return `${data.username}#${data.password}`;
  },
  tutorial: "发送“天翼云盘登录”，按账号#密码录入；发送“天翼云盘查询”或“天翼云盘运行”执行签到及三项抽奖。",
});

runtime.main().catch((error) => s.reply(`天翼云盘执行失败：${error?.message || error}`));

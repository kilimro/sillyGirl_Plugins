// [title: 爱坤助手]
// [name: aiKunZhuShou]
// [desc: 爱坤账号登录校验、多账号管理、签到、剩余流量查询和管理员一键签到。]
// [author: ahhhahh]
// [version: v2.3.4]
// [rule: raw ^(爱坤|ik)登录$]
// [rule: raw ^(爱坤|ik)签到$]
// [rule: raw ^(爱坤|ik)查询$]
// [rule: raw ^(爱坤|ik)管理$]
// [rule: raw ^(爱坤|ik)一键签到$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/爱坤助手_v2.3.3_By.ahhhahh.py]
// [depe: []]

const { sender: s, Bucket, plugin, console } = require("sillygirl");

const accountsStore = new Bucket("ahhh_ikuu_accounts");
const Config = new plugin.Form({
  api_base: plugin.Form.string().title("爱坤站点地址").default("https://ikuuu.de"),
  origin: plugin.Form.string().title("请求 Origin").default("https://ikuuu.art"),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(20000),
});

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";
let runtime = { apiBase: "https://ikuuu.de", origin: "https://ikuuu.art", timeout: 20000 };

class CookieSession {
  constructor() {
    this.cookies = new Map();
  }

  async request(path, options = {}) {
    const headers = Object.assign({ "user-agent": USER_AGENT, origin: runtime.origin }, options.headers || {});
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtime.timeout);
    try {
      const response = await fetch(new URL(path, runtime.apiBase), {
        method: options.method || "GET",
        headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      });
      this.captureCookies(response.headers);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location)
          return this.request(new URL(location, response.url).toString(), { method: "GET", headers: options.headers });
      }
      const text = await response.text();
      return { status: response.status, text, headers: response.headers };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`请求超时（${runtime.timeout}ms）`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  captureCookies(headers) {
    let values = [];
    if (typeof headers.getSetCookie === "function") values = headers.getSetCookie();
    if (!values.length) values = splitSetCookie(headers.get("set-cookie") || "");
    for (const line of values) {
      const pair = String(line).split(";", 1)[0];
      const cut = pair.indexOf("=");
      if (cut > 0) this.cookies.set(pair.slice(0, cut).trim(), pair.slice(cut + 1).trim());
    }
  }
}

async function main() {
  const cfg = (await Config.get()) || {};
  runtime = {
    apiBase: normalizeBase(cfg.api_base || "https://ikuuu.de"),
    origin: normalizeBase(cfg.origin || "https://ikuuu.art"),
    timeout: clampInt(cfg.timeout_ms, 3000, 120000, 20000),
  };
  const content = String((await s.getMsg()) || "").trim();
  if (/^(爱坤|ik)登录$/i.test(content)) return handleLogin();
  if (/^(爱坤|ik)签到$/i.test(content)) return handleCheckin(false);
  if (/^(爱坤|ik)查询$/i.test(content)) return handleQuery();
  if (/^(爱坤|ik)管理$/i.test(content)) return handleManage();
  if (/^(爱坤|ik)一键签到$/i.test(content)) return handleOneKeySignin();
  return s.reply("不支持的指令：爱坤登录 / 爱坤签到 / 爱坤查询 / 爱坤管理");
}

async function handleLogin() {
  const email = await prompt("🔐 请输入邮箱（格式：xxx@xxx.com），输入Q取消~");
  if (email === null) return s.reply("✅ 已取消操作啦~");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return s.reply("❌ 邮箱格式错误");
  const password = await prompt("🔑 请输入密码，输入Q取消~", false);
  if (password === null) return s.reply("✅ 已取消操作啦~");
  const result = await loginWithAccount({ email, password });
  if (!result.ok) return s.reply(`❌ 账号或密码错误：${result.message}`);
  const accounts = await loadAccounts(await userKey());
  if (accounts.some((account) => account.email === email)) return s.reply(`⚠️ 账号 ${maskEmail(email)} 已经存在咯~`);
  accounts.push({ email, password });
  await saveAccounts(await userKey(), accounts);
  return s.reply(`🎉 账号 ${maskEmail(email)} 验证成功并已保存~`);
}

async function handleCheckin(allAccounts) {
  const accounts = await loadAccounts(await userKey());
  if (!accounts.length) return s.reply("❌ 请先添加账号哦~");
  let selected = accounts;
  if (!allAccounts) {
    const answer = await prompt(`🎁 请选择要签到的账号序号（0.签到所有账号）：\n${accountMenu(accounts)}`);
    if (answer === null) return s.reply("✅ 已取消操作啦~");
    const index = strictIndex(answer, accounts.length, true);
    if (index === null) return s.reply("❌ 输入格式错误或账号编号无效~");
    selected = index === 0 ? accounts : [accounts[index - 1]];
  } else {
    await s.reply("🚀 开始批量签到所有账号...");
  }
  const results = [];
  for (const account of selected) results.push(await signOne(account));
  if (selected.length === 1) return s.reply(results[0].text);
  const success = results.filter((item) => item.ok).length;
  return s.reply(
    `📊 全部账号签到结果汇总：\n${results.map((item) => item.text).join("\n")}\n💡 成功: ${success}/${results.length}`,
  );
}

async function handleQuery() {
  const accounts = await loadAccounts(await userKey());
  if (!accounts.length) return s.reply("❌ 请先添加账号哦~");
  const answer = await prompt(`📊 请选择要查询的账号序号（0.查询所有账号）：\n${accountMenu(accounts)}`);
  if (answer === null) return s.reply("✅ 已取消操作啦~");
  const index = strictIndex(answer, accounts.length, true);
  if (index === null) return s.reply("❌ 输入格式错误或账号编号无效~");
  const selected = index === 0 ? accounts : [accounts[index - 1]];
  if (selected.length > 1) await s.reply("🔍 开始查询所有账号流量...");
  const results = [];
  for (const account of selected) results.push(await queryOne(account));
  if (selected.length === 1) return s.reply(results[0]);
  return s.reply(`📊 所有账号流量查询结果：\n${results.join("\n")}`);
}

async function handleManage() {
  const key = await userKey();
  let accounts = await loadAccounts(key);
  const choice = await prompt("🔧 账号管理中心 🔧\n0. 查看所有账号 📋\n1. 添加账号 ➕\n2. 删除账号 ➖\nq. 取消操作 ❌");
  if (choice === null) return s.reply("✅ 已取消操作啦~");
  if (choice === "0") return s.reply(`${accountMenu(accounts)}\nℹ️ 共 ${accounts.length} 个账号`);
  if (choice === "1") return handleLogin();
  if (choice !== "2") return s.reply("❌ 无效的操作选择~");
  if (!accounts.length) return s.reply("❌ 没有可删除的账号哦~");
  const answer = await prompt(`${accountMenu(accounts)}\n🗑️ 请输入要删除的账号编号（输入q取消）`);
  if (answer === null) return s.reply("✅ 已取消操作啦~");
  const index = strictIndex(answer, accounts.length, false);
  if (index === null) return s.reply("❌ 输入格式错误或账号编号无效~");
  const [deleted] = accounts.splice(index - 1, 1);
  await saveAccounts(key, accounts);
  return s.reply(
    `🗑️ 账号 ${maskEmail(deleted.email)} 已删除~${accounts.length ? "" : "\n💡 您的账号列表已清空，数据桶已自动删除"}`,
  );
}

async function handleOneKeySignin() {
  if (!(await s.isAdmin())) return s.reply("你没有权限执行此操作哦~❌");
  await s.reply("开始执行一键签到啦~🚀");
  const all = await accountsStore.getAll();
  const records = normalizeBucketEntries(all);
  const results = [];
  for (const [, raw] of records) {
    for (const account of parseAccounts(raw)) results.push(await signOne(account, false));
  }
  if (!results.length) return s.reply("一键签到完成：没有已保存账号");
  return s.reply(`一键签到完成，结果如下：\n${results.map((item) => item.text).join("\n")}`);
}

async function signOne(account, masked = true) {
  const login = await loginWithAccount(account);
  const label = masked ? maskEmail(account.email) : account.email;
  if (!login.ok) return { ok: false, text: `❌ ${label}: 登录失败 - ${login.message}` };
  try {
    const response = await login.session.request("/user/checkin", { method: "POST" });
    const data = parseJson(response.text, "签到接口返回非 JSON");
    const message = String(data.msg || "签到失败");
    return { ok: response.status >= 200 && response.status < 400, text: `✅ ${label}: ${message}` };
  } catch (error) {
    return { ok: false, text: `❌ ${label}: 签到失败 - ${errorText(error)}` };
  }
}

async function queryOne(account) {
  const label = maskEmail(account.email);
  const login = await loginWithAccount(account);
  if (!login.ok) return `❌ ${label}: 登录失败 - ${login.message}`;
  try {
    const response = await login.session.request("/user", {
      headers: { referer: new URL("/auth/login", runtime.apiBase).toString() },
    });
    const match = response.text.match(/var\s+originBody\s*=\s*["']([^"']+)["']/i);
    if (!match) return `❌ ${label}: 未找到Base64编码数据`;
    const decoded = decodeBase64(match[1]);
    const flow = extractFlow(decoded);
    return `💡 ${label}: ${flow}`;
  } catch (error) {
    return `❌ ${label}: 查询失败 - ${errorText(error)}`;
  }
}

async function loginWithAccount(account) {
  const session = new CookieSession();
  try {
    const body = new URLSearchParams({ email: account.email, passwd: account.password }).toString();
    const response = await session.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body,
    });
    const data = parseJson(response.text, "登录接口返回非 JSON");
    const message = String(data.msg || "登录失败");
    return { ok: response.status >= 200 && response.status < 400 && message.includes("登录成功"), message, session };
  } catch (error) {
    return { ok: false, message: `登录异常: ${errorText(error)}`, session: null };
  }
}

async function prompt(message, trim = true) {
  await s.reply(message);
  const child = await s.listen({ timeout: 60000 });
  if (!child) return null;
  const value = String((await child.getMsg()) || "");
  const normalized = trim ? value.trim() : value;
  return !normalized || /^q$/i.test(normalized.trim()) ? null : normalized;
}

async function userKey() {
  return String((await s.getUserId()) || "");
}
async function loadAccounts(key) {
  return parseAccounts(await accountsStore.get(key, "[]"));
}
async function saveAccounts(key, accounts) {
  if (!accounts.length) return accountsStore.delete(key);
  return accountsStore.set(key, JSON.stringify(accounts));
}
function parseAccounts(raw) {
  try {
    const rows = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    return Array.isArray(rows)
      ? rows.filter((item) => item && typeof item.email === "string" && typeof item.password === "string")
      : [];
  } catch (_) {
    return [];
  }
}
function accountMenu(accounts) {
  if (!accounts.length) return "📭 当前没有存储任何账号，请先添加哦~";
  return `📋 已保存账号列表：\n${accounts.map((account, index) => `  ${index + 1}. ${maskEmail(account.email)}`).join("\n")}`;
}
function maskEmail(email) {
  const value = String(email || "");
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}
function strictIndex(value, length, allowZero) {
  if (!/^\d+$/.test(String(value).trim())) return null;
  const index = Number(value);
  return (allowZero && index === 0) || (index >= 1 && index <= length) ? index : null;
}
function decodeBase64(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
}
function extractFlow(html) {
  const candidates = [
    /<span[^>]*class=["'][^"']*counter[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /<span[^>]*>([^<]*\d+(?:\.\d+)?\s*(?:GB|MB|TB)[^<]*)<\/span>/i,
  ];
  for (const regex of candidates) {
    const match = String(html).match(regex);
    if (!match) continue;
    const text = stripHtml(match[1]).trim();
    const number = text.match(/\d+(?:\.\d+)?/);
    return number && !/[GMT]B/i.test(text) ? `${number[0]} GB` : text;
  }
  return "解码成功，但未找到流量信息";
}
function stripHtml(value) {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}
function parseJson(text, errorMessage) {
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(errorMessage);
  }
}
function splitSetCookie(value) {
  return value ? String(value).split(/,(?=\s*[^;,\s]+=)/) : [];
}
function normalizeBucketEntries(value) {
  if (!value) return [];
  if (Array.isArray(value))
    return value
      .map((item) => (Array.isArray(item) ? item : [item.key ?? item.name, item.value]))
      .filter(([key]) => key !== undefined);
  return Object.entries(value);
}
function normalizeBase(value) {
  const url = new URL(String(value).trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("站点地址只支持 http/https");
  return url.toString().replace(/\/$/, "");
}
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function errorText(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main().catch(async (error) => {
  console.log(`爱坤助手执行失败：${error?.stack || error}`);
  await s.reply(`爱坤助手执行失败：${errorText(error)}`);
});

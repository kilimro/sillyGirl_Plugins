// [title: 【插件】-顺易充兑换]
// [name: chaJianShunYiChongDuiHuan]
// [desc: 顺易充积分、商城库存查询、批量兑换及账号授权维护]
// [author: huawei]
// [version: v1.1.1]
// [rule: ^顺易充(时间|删除|修正|总结|库存|库存兑换|代理|代理配置|代理查询)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 60]
// [class: 任务]
// [icon: https://i.mji.rip/2025/07/11/5132e8c191f16ac574c0328105061ec4.jpeg]
// [origin: backup/【插件】-顺易充兑换_v1.1.0_By.huawei.py]
// [depe: ["undici"]]

const { sender: s, Bucket, plugin } = require("sillygirl");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}
const BASE = "https://app.wodeev.com",
  users = new Bucket("G_SYC.user"),
  tokens = new Bucket("G_SYC.token"),
  remarks = new Bucket("G_SYC.remark"),
  auth = new Bucket("G_SYC.auth"),
  legacyUsers = new Bucket("G_SYC_user"),
  legacyTokens = new Bucket("G_SYC_token"),
  agent = new Bucket("G_SYC_AGENT");
const form = new plugin.Form({
  is_proxy: plugin.Form.boolean().title("启用代理").default(false),
  proxy_api: plugin.Form.string().title("代理池API").default("").visibleWhen("is_proxy", "==", true),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
function list(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw || "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch (_) {
    return [];
  }
}
async function uid() {
  return String((await s.getUserId()) || "");
}
async function prompt(text, timeout = 60000) {
  await s.reply(text);
  const child = await s.listen({ timeout });
  return child ? String((await child.getMsg()) || "").trim() : null;
}
async function userAccounts(userId) {
  let rows = list(await users.get(userId, "[]"));
  if (!rows.length) rows = list(await legacyUsers.get(userId, "[]"));
  return rows;
}
async function rawToken(phone) {
  const raw = String((await tokens.get(phone, "")) || (await legacyTokens.get(phone, "")) || "");
  try {
    return String(JSON.parse(raw).token || raw);
  } catch (_) {
    return raw.replace(/^Bearer\s+/i, "");
  }
}
function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    "user-agent": "Mozilla/5.0 (Linux; Android 14; Redmi K20 Pro Build/UKQ1.240624.001; wv) AppleWebKit/537.36",
    accept: "application/json, text/plain, */*",
    origin: "https://www.wodeev.com",
    referer: "https://www.wodeev.com/",
    lang: "1",
    loginchannel: "01",
    "client-version": "5.5.2",
  };
}
async function dispatcher() {
  if (!cfg.is_proxy || !cfg.proxy_api || !ProxyAgent) return;
  const r = await fetch(cfg.proxy_api, { signal: AbortSignal.timeout(cfg.timeout_ms) }),
    v = (await r.text()).trim();
  if (!v || v.includes("白名单")) throw new Error(v || "代理池返回为空");
  return new ProxyAgent(/^https?:\/\//.test(v) ? v : `http://${v}`);
}
async function api(path, { method = "GET", token, query, json } = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const h = headers(token),
    controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), cfg.timeout_ms);
  let d;
  try {
    d = await dispatcher();
    const response = await fetch(url, {
        method,
        headers: json ? { ...h, "content-type": "application/json;charset=UTF-8" } : h,
        body: json ? JSON.stringify(json) : undefined,
        signal: controller.signal,
        dispatcher: d,
      }),
      text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    let result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error(`接口返回非JSON：${text.slice(0, 160)}`);
    }
    if (Number(result.ret) !== 200) throw new Error(result.msg || `接口失败 ret=${result.ret}`);
    return result;
  } finally {
    clearTimeout(timer);
    if (d?.close) await d.close().catch(() => {});
  }
}
async function rank(token) {
  const r = await api("/bil-front/v2.0/accounts/myScoreRank", { token, query: { scoreType: "02" } }),
    x = r.data || {};
  return { score: x.myScores || 0, available: Number(x.myAvailableScores) || 0, rank: x.myRank || "未知" };
}
async function mall(token) {
  const r = await api("/bil-front/v2.0/accounts/scoreMall", { token, query: { pageNum: 1, totalNum: 99 } });
  return Array.isArray(r.goodsList) ? r.goodsList : Array.isArray(r.data?.goodsList) ? r.data.goodsList : [];
}
function goodName(g) {
  return (
    String(g.goodsName || "")
      .replace(/顺易充|服务费/g, "")
      .trim() ||
    g.goodsNo ||
    "未命名商品"
  );
}
async function pickAccount(userId) {
  const rows = await userAccounts(userId);
  if (!rows.length) throw new Error("你还没有绑定账号");
  if (rows.length === 1) return rows[0];
  const value = await prompt(
      [
        "请选择账号",
        ...(await Promise.all(
          rows.map(async (x, i) => `[${i + 1}] ${await remarks.get(x, x.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2"))}`),
        )),
      ].join("\n"),
    ),
    n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > rows.length) throw new Error("账号选择无效");
  return rows[n - 1];
}
async function stock() {
  const phone = await pickAccount(await uid()),
    token = await rawToken(phone);
  if (!token) throw new Error("账号无Token，请重新登录");
  const [q, goods] = await Promise.all([rank(token), mall(token)]);
  return s.reply(
    [
      `可用积分:${q.available}，总积分:${q.score}，排名:${q.rank}`,
      ...goods.map(
        (g) => `${goodName(g)}｜${g.price || 0}分｜库存${g.remainNum || 0}${g.planNum ? `/${g.planNum}` : ""}`,
      ),
    ].join("\n"),
  );
}
async function exchange() {
  const phone = await pickAccount(await uid()),
    token = await rawToken(phone);
  if (!token) throw new Error("账号无Token，请重新登录");
  const [q, goods] = await Promise.all([rank(token), mall(token)]);
  if (!goods.length) throw new Error("商城商品为空");
  const pick = Number(
      await prompt(
        [
          `可用积分:${q.available}，请选择商品`,
          ...goods.map((g, i) => `[${i + 1}] ${goodName(g)}｜${g.price || 0}分｜库存${g.remainNum || 0}`),
        ].join("\n"),
      ),
    ),
    g = goods[pick - 1];
  if (!g) throw new Error("商品选择无效");
  const price = Number(g.price) || 0,
    remain = Number(g.remainNum) || 0,
    max = Math.min(remain, price > 0 ? Math.floor(q.available / price) : remain),
    count = Number(await prompt(`请输入兑换数量(1-${max})`));
  if (!Number.isInteger(count) || count < 1 || count > max) throw new Error("兑换数量无效");
  if (String(await prompt(`${goodName(g)} × ${count}，共${price * count}积分；回复Y确认`)).toUpperCase() !== "Y")
    return s.reply("已取消");
  let ok = 0,
    fail = 0,
    last = "";
  for (let i = 0; i < count; i++) {
    try {
      const r = await api("/bil-front/v2.0/exchange", { method: "POST", token, json: { productNo: g.goodsNo } });
      ok++;
      last = r.msg || "兑换成功";
    } catch (error) {
      fail++;
      last = error.message;
    }
  }
  return s.reply(`${goodName(g)}兑换完成：成功${ok}，失败${fail}${last ? `\n${last}` : ""}`);
}
async function summary() {
  if (!(await s.isAdmin())) throw new Error("此功能仅限管理员");
  let userCount = 0,
    total = 0,
    authorized = 0;
  for (const userId of new Set([...(await users.keys()), ...(await legacyUsers.keys())])) {
    userCount++;
    for (const phone of await userAccounts(userId)) {
      total++;
      if (await auth.get(phone, "")) authorized++;
    }
  }
  return s.reply(`顺易充账号统计：用户${userCount}，账号${total}，已授权${authorized}`);
}
async function adjust() {
  if (!(await s.isAdmin())) throw new Error("此功能仅限管理员");
  const days = Number(await prompt("请输入授权调整天数，如30或-10"));
  if (!Number.isInteger(days) || Math.abs(days) > 3650) throw new Error("天数范围为-3650到3650");
  let changed = 0;
  for (const phone of await tokens.keys()) {
    const raw = String((await auth.get(phone, "")) || ""),
      base = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date();
    base.setDate(base.getDate() + days);
    await auth.set(phone, base.toISOString().slice(0, 10));
    changed++;
  }
  return s.reply(`已调整${changed}个账号授权${days >= 0 ? "+" : ""}${days}天`);
}
async function repair() {
  if (!(await s.isAdmin())) throw new Error("此功能仅限管理员");
  let fixed = 0;
  const now = new Date();
  for (const phone of await auth.keys()) {
    const raw = String((await auth.get(phone, "")) || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue;
    const d = new Date(`${raw}T00:00:00`);
    if (d.getFullYear() < now.getFullYear()) {
      d.setFullYear(now.getFullYear());
      await auth.set(phone, d.toISOString().slice(0, 10));
      fixed++;
    }
  }
  return s.reply(`授权年份修正完成：${fixed}个`);
}
async function remove() {
  if (!(await s.isAdmin())) throw new Error("此功能仅限管理员");
  const userId = await prompt("请输入要删除的用户ID");
  if (!userId) return;
  const rows = await userAccounts(userId);
  for (const phone of rows) {
    await tokens.delete(phone);
    await legacyTokens.delete(phone);
    await remarks.delete(phone);
    await auth.delete(phone);
  }
  await users.delete(userId);
  await legacyUsers.delete(userId);
  return s.reply(`已删除用户${userId}的${rows.length}个账号`);
}
async function agentCommand(content) {
  if (content === "顺易充代理配置") {
    if (!(await s.isAdmin())) throw new Error("此功能仅限管理员");
    const value = await prompt("请输入代理配置JSON或代理池URL");
    await agent.set("config", value || "");
    return s.reply("代理配置已保存");
  }
  if (content === "顺易充代理查询") return s.reply(`代理配置：${await agent.get("config", "未配置")}`);
  const rows = await userAccounts(await uid());
  await agent.set(await uid(), JSON.stringify(rows));
  return s.reply(`已同步${rows.length}个顺易充账号到代理记录`);
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    const c = String((await s.getMsg()) || "").trim();
    if (c === "顺易充库存") return stock();
    if (c === "顺易充库存兑换") return exchange();
    if (c === "顺易充总结") return summary();
    if (c === "顺易充时间") return adjust();
    if (c === "顺易充修正") return repair();
    if (c === "顺易充删除") return remove();
    if (/^顺易充代理/.test(c)) return agentCommand(c);
    return s.resume();
  } catch (error) {
    return s.reply(`顺易充兑换执行失败：${error?.message || error}`);
  }
}
main();

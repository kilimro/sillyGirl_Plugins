// [title: 小米刷步助手]
// [name: xiaoMiShuaBuZhuShou]
// [desc: Zepp Life 多账号登录、即时刷步、定时刷步与账号解绑]
// [author: 1934103887]
// [version: v5.1.0]
// [rule: ^刷步$|^刷步登录$|^定时刷步$|^一键刷步$|^刷步定时$|^取消定时$|^登录刷步$|^登陆刷步$|^刷步登陆$|^刷步解绑$|^提交步数$|^添加账号$|^查看账号$|^删除账号$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/小米刷步助手_v5.0_By.1934103887.py;backup/步数_v1.0_By.1668485780.py]
// [depe: ["./xiaomiStepsCore.js","undici"]]

const { sender: s, Bucket, plugin } = require("sillygirl");
const zepp = require("./xiaomiStepsCore.js");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}

const accountsStore = new Bucket("Joh_Shuabu_account");
const legacyAccountsStore = new Bucket("dd_zepp_account");
const scheduleStore = new Bucket("Joh_Shuabu");
const form = new plugin.Form({
  proxy_mode: plugin.Form.string().title("代理模式：0关闭/1固定/2代理API").default("0"),
  proxy_url: plugin.Form.string().title("固定代理地址").default(""),
  proxy_api: plugin.Form.string().title("代理池API").default(""),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};

async function prompt(text, timeout = 120000) {
  await s.reply(text);
  const child = await s.listen({ timeout });
  if (!child) return null;
  const value = String((await child.getMsg()) || "").trim();
  return /^q$/i.test(value) ? null : value;
}

function parseAccounts(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(String(raw));
    if (Array.isArray(value))
      return value
        .filter((x) => x && x.mobile && x.password)
        .map((x) => ({ mobile: String(x.mobile), password: String(x.password) }));
  } catch (_) {}
  return String(raw)
    .split("&")
    .map((row) => {
      const cut = row.indexOf("#");
      return cut > 0 ? { mobile: row.slice(0, cut), password: row.slice(cut + 1) } : null;
    })
    .filter(Boolean);
}

function parseSchedule(raw) {
  try {
    const rows = JSON.parse(String(raw || "[]"));
    return Array.isArray(rows) ? rows.filter((x) => x && x.mobile && x.password && validStep(x.step)) : [];
  } catch (_) {
    return [];
  }
}

async function saveAccounts(userId, rows) {
  if (!rows.length) {
    await accountsStore.delete(userId);
    return legacyAccountsStore.delete(userId);
  }
  await accountsStore.set(userId, JSON.stringify(rows));
  return legacyAccountsStore.set(userId, rows.map((x) => `${x.mobile}#${x.password}`).join("|"));
}

async function loadAccounts(id) {
  const current = parseAccounts(await accountsStore.get(id, ""));
  const legacy = parseAccounts(String(await legacyAccountsStore.get(id, "")).replace(/\|/g, "&"));
  const merged = [...current];
  for (const row of legacy) if (!merged.some((x) => x.mobile === row.mobile)) merged.push(row);
  return merged;
}

function validStep(value) {
  const step = Number(value);
  return Number.isInteger(step) && step > 0 && step <= 98800;
}

function maskMobile(value) {
  return String(value).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function normalizeProxy(value) {
  const proxy = String(value || "")
    .trim()
    .split(/\s+/)[0];
  if (!proxy) throw new Error("代理地址为空");
  return /^[a-z]+:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}

async function acquireDispatcher() {
  const mode = String(cfg.proxy_mode || "0");
  if (mode === "0" || !mode) return undefined;
  if (!ProxyAgent) throw new Error("缺少 undici 依赖，代理模式不可用");
  let proxy;
  if (mode === "1") proxy = cfg.proxy_url;
  else if (mode === "2") {
    if (!cfg.proxy_api) throw new Error("未配置代理池API");
    const response = await fetch(cfg.proxy_api, { signal: AbortSignal.timeout(cfg.timeout_ms) });
    if (!response.ok) throw new Error(`代理池 HTTP ${response.status}`);
    proxy = await response.text();
  } else throw new Error("代理模式仅支持 0、1、2");
  return new ProxyAgent(normalizeProxy(proxy));
}

async function userId() {
  return String(await s.getUserId());
}

async function selectAccounts(rows, title = "请选择账号，多选用逗号隔开") {
  if (!rows.length) {
    await s.reply("未查询到账号，请发“刷步登录”");
    return [];
  }
  const menu = ["【0】全部", ...rows.map((row, index) => `【${index + 1}】${maskMobile(row.mobile)}`)].join("\n");
  const input = await prompt(`${title}：\n${menu}`);
  if (input === null) {
    await s.reply("已取消操作或输入超时");
    return [];
  }
  const indices =
    input === "0"
      ? rows.map((_, index) => index)
      : [
          ...new Set(
            input
              .split(/[,，]/)
              .map((x) => Number(x.trim()) - 1)
              .filter((x) => Number.isInteger(x) && x >= 0 && x < rows.length),
          ),
        ];
  if (!indices.length) {
    await s.reply("未选择有效的账号");
    return [];
  }
  return indices.map((index) => ({ index, row: rows[index] }));
}

async function loginAccount() {
  const mobile = await prompt("请输入 Zepp Life 注册账号（手机号或邮箱），Q取消：");
  if (!mobile) return s.reply("已取消操作或输入超时");
  const password = await prompt("请输入密码（请勿使用#号），Q取消：");
  if (!password) return s.reply("已取消操作或输入超时");
  if (password.includes("#")) return s.reply("密码中不能包含#号");
  let verified = false,
    lastError = "登录失败";
  for (let retry = 1; retry <= 6 && !verified; retry += 1) {
    let dispatcher;
    try {
      dispatcher = await acquireDispatcher();
      const result = await zepp.login(mobile, password, { dispatcher, timeout: cfg.timeout_ms });
      verified = Boolean(result.loginToken && result.userId);
      if (!verified) lastError = result.message || "账号或密码错误";
    } catch (error) {
      lastError = error.message;
    } finally {
      if (dispatcher?.close) await dispatcher.close().catch(() => {});
    }
  }
  if (!verified) return s.reply(`账号绑定失败：${lastError}\n需使用 Zepp Life 注册账号`);
  const id = await userId(),
    rows = await loadAccounts(id);
  const index = rows.findIndex((row) => row.mobile === mobile);
  if (index >= 0) rows[index] = { mobile, password };
  else rows.push({ mobile, password });
  await saveAccounts(id, rows);
  return s.reply(index >= 0 ? "账号密码更新成功！" : "账号登录成功！");
}

async function brushRows(rows, step, verbose = true) {
  let success = 0;
  for (const row of rows) {
    const result = await zepp.brush(row.mobile, row.password, step, {
      dispatcherFactory: acquireDispatcher,
      timeout: cfg.timeout_ms,
      retries: 6,
    });
    if (result.ok) success += 1;
    else if (verbose) await s.reply(`账号 ${maskMobile(row.mobile)} 刷步失败：${result.message}`);
  }
  return success;
}

async function brushSteps() {
  const rows = await loadAccounts(await userId());
  const selected = await selectAccounts(rows, "请选择要刷步的账号");
  if (!selected.length) return;
  const input = await prompt("请输入需要的步数（1-98800），Q取消：");
  if (!validStep(input)) return s.reply("步数格式错误，范围必须是 1-98800");
  await s.reply("正在进行刷步，请稍后...");
  const success = await brushRows(
    selected.map((x) => x.row),
    Number(input),
  );
  return s.reply(
    `刷步完成，步数：${input}\n成功：${success}/${selected.length} 个账号\n若微信步数未同步，请检查 Zepp Life 的微信/设备绑定`,
  );
}

async function scheduleSteps() {
  const id = await userId(),
    rows = await loadAccounts(id);
  const selected = await selectAccounts(rows, "请选择要定时刷步的账号");
  if (!selected.length) return;
  const input = await prompt("请输入定时刷步的步数（1-98800），Q取消：");
  if (!validStep(input)) return s.reply("步数格式错误，范围必须是 1-98800");
  const scheduled = selected.map(({ row }) => ({ ...row, step: Number(input) }));
  await scheduleStore.set(id, JSON.stringify(scheduled));
  return s.reply(`定时设置成功：${scheduled.length} 个账号，步数 ${input}\n停止任务发“取消定时”`);
}

async function cancelSchedule() {
  const id = await userId(),
    rows = parseSchedule(await scheduleStore.get(id, ""));
  if (!rows.length) return s.reply("未找到定时刷步任务");
  const selected = await selectAccounts(rows, "请选择要取消定时的账号");
  if (!selected.length) return;
  const removed = new Set(selected.map((x) => x.index));
  const remain = rows.filter((_, index) => !removed.has(index));
  if (remain.length) await scheduleStore.set(id, JSON.stringify(remain));
  else await scheduleStore.delete(id);
  return s.reply(
    remain.length ? `已取消 ${removed.size} 个账号的定时任务，剩余 ${remain.length} 个` : "已取消所有定时刷步任务",
  );
}

async function unbindAccounts() {
  const id = await userId(),
    rows = await loadAccounts(id);
  if (!rows.length) return s.reply("未查询到已绑定的账号");
  const selected = await selectAccounts(rows, "请选择要解绑的账号");
  if (!selected.length) return;
  const removed = new Set(selected.map((x) => x.index));
  const remain = rows.filter((_, index) => !removed.has(index));
  await saveAccounts(id, remain);
  const schedules = parseSchedule(await scheduleStore.get(id, ""));
  const phones = new Set(selected.map((x) => x.row.mobile));
  const scheduleRemain = schedules.filter((x) => !phones.has(x.mobile));
  if (scheduleRemain.length) await scheduleStore.set(id, JSON.stringify(scheduleRemain));
  else await scheduleStore.delete(id);
  return s.reply(remain.length ? `账号解绑成功，剩余 ${remain.length} 个` : "所有账号已解绑");
}

async function viewAccounts() {
  const rows = await loadAccounts(await userId());
  if (!rows.length) return s.reply("您还没有绑定任何账号\n请发送“添加账号”或“刷步登录”");
  return s.reply(
    [
      "=====账号列表=====",
      ...rows.map((row, i) => `${i + 1}. ${maskMobile(row.mobile)}\n   密码：${"*".repeat(row.password.length)}`),
      `共有 ${rows.length} 个账号`,
    ].join("\n"),
  );
}

async function addAccount() {
  const mobile = await prompt("请输入 Zepp Life 注册账号（手机号或邮箱），Q取消：");
  if (!mobile) return s.reply("已取消操作或输入超时");
  const password = await prompt("请输入密码，Q取消：");
  if (!password) return s.reply("已取消操作或输入超时");
  if (password.includes("#") || password.includes("|")) return s.reply("密码中不能包含#或|号");
  const id = await userId(),
    rows = await loadAccounts(id);
  if (rows.some((x) => x.mobile === mobile)) return s.reply(`该账号已存在：${maskMobile(mobile)}`);
  rows.push({ mobile, password });
  await saveAccounts(id, rows);
  return s.reply(`账号添加成功：${maskMobile(mobile)}\n密码：${"*".repeat(password.length)}`);
}

async function deleteAccount() {
  const id = await userId(),
    rows = await loadAccounts(id);
  const selected = await selectAccounts(rows, "请选择要删除的账号");
  if (!selected.length) return;
  const removed = new Set(selected.map((x) => x.index)),
    remain = rows.filter((_, i) => !removed.has(i));
  await saveAccounts(id, remain);
  return s.reply(`已删除 ${removed.size} 个账号，剩余 ${remain.length} 个`);
}

async function oneKeyBrush() {
  if (!(await s.isAdmin())) return s.reply("只有管理员可以执行此命令");
  const all = await scheduleStore.getAll(),
    entries = Object.entries(all || {});
  let accounts = 0,
    success = 0,
    users = 0;
  for (const [, value] of entries) {
    const rows = parseSchedule(value);
    if (!rows.length) continue;
    users += 1;
    accounts += rows.length;
    for (const row of rows) success += await brushRows([row], Number(row.step), false);
  }
  const text = accounts ? `一键刷步完成：${users} 个用户，成功 ${success}/${accounts} 个账号` : "未找到定时刷步任务";
  if (typeof s.pushAdmin === "function") await s.pushAdmin(text).catch(() => {});
  return s.reply(text);
}

async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Number(cfg.timeout_ms) || 15000;
    const content = String((await s.getMsg()) || "").trim();
    if (/^(刷步登录|登录刷步|刷步登陆|登陆刷步)$/.test(content)) return loginAccount();
    if (/^(定时刷步|刷步定时)$/.test(content)) return scheduleSteps();
    if (content === "取消定时") return cancelSchedule();
    if (content === "一键刷步") return oneKeyBrush();
    if (content === "刷步解绑") return unbindAccounts();
    if (content === "刷步" || content === "提交步数") return brushSteps();
    if (content === "添加账号") return addAccount();
    if (content === "查看账号") return viewAccounts();
    if (content === "删除账号") return deleteAccount();
    return s.reply("未识别的指令");
  } catch (error) {
    return s.reply(
      `小米刷步助手处理失败：${String(error?.message || error)
        .replace(/[\r\n]+/g, " ")
        .slice(0, 300)}`,
    );
  }
}

main();

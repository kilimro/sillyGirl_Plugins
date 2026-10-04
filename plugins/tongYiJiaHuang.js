// [title: 统一茄皇]
// [name: tongYiJiaHuang]
// [desc: 统一梦时代茄皇的家：账号登录校验、资源查询、授权支付、青龙/DumbPanel同步及过期检测。]
// [author: rujingxianghai]
// [version: v1.4.1]
// [rule: raw ^(茄皇|qh)(登录|登陆)$|^登(录|陆)(茄皇|qh)$|^(茄皇|qh)(查询|管理|教程)$|^(查询|管理)(茄皇|qh)$|^茄皇授权$|^茄皇检测$]
// [cron: 18 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/统一茄皇_v1.4_By.rujingxianghai.py]
// [depe: ["./vortoUtils.js"]]

const { sender: s, Bucket, plugin, utils, console } = require("sillygirl");
const vorto = require("./vortoUtils");

const configStore = new Bucket("s_qh");
const userStore = new Bucket("s_qh_user");
const tokenStore = new Bucket("s_qh_token");
const authStore = new Bucket("s_qh_auth");
const Config = new plugin.Form({
  osname: plugin.Form.string().title("面板变量名").default("S_TYQH"),
  qlname: plugin.Form.string()
    .title("独立青龙配置")
    .description("Host丨ClientID丨ClientSecret；留空使用Vorto默认配置/容器")
    .default(""),
  use_dumbpanel: plugin.Form.boolean().title("使用DumbPanel").default(false),
  vip_money: plugin.Form.number().title("每账号每月价格").min(0).default(1),
  coin: plugin.Form.integer().title("每账号每月积分").min(0).default(0),
  notify: plugin.Form.string().title("到期通知渠道").description("逗号分隔，如 qq,wx,tg").default(""),
  notify_days: plugin.Form.integer().title("提前提醒天数").min(0).max(365).default(3),
  request_timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(10000),
});

const API_BASE = "https://api.zhumanito.cn";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781 MiniProgramEnv/Windows miniProgram/wx532ecb3bdaaf92f9";
let runtime = { osname: "S_TYQH", qlname: "", useDumbPanel: false, vipMoney: 1, coin: 0, timeout: 10000 };

async function main() {
  runtime = await loadConfig();
  const content = String((await s.getMsg()) || "").trim();
  if (!content) return runAuthCheck(true);
  if (/登录|登陆/.test(content)) return bindAccount();
  if (/查询/.test(content) && /(茄皇|qh)/i.test(content)) return queryAccounts();
  if (/管理/.test(content) && /(茄皇|qh)/i.test(content)) return manageAccounts();
  if (/教程/.test(content) && /(茄皇|qh)/i.test(content)) return showTutorial();
  if (content === "茄皇授权") return adminAuthorize();
  if (content === "茄皇检测") return runAuthCheck(false);
  return s.resume();
}

async function loadConfig() {
  const form = (await Config.get()) || {};
  const legacy = await configStore.getAll();
  const value = (formKey, legacyKey, fallback) =>
    legacy?.[legacyKey] !== undefined && legacy?.[legacyKey] !== ""
      ? legacy[legacyKey]
      : form[formKey] !== undefined
        ? form[formKey]
        : fallback;
  const cfg = {
    osname: String(value("osname", "osname", "S_TYQH") || "S_TYQH").trim(),
    qlname: String(value("qlname", "qlname", "") || "").trim(),
    useDumbPanel: boolValue(value("use_dumbpanel", "use_dumbpanel", false)),
    vipMoney: Math.max(0, Number(value("vip_money", "Vipmoney", 1)) || 0),
    coin: Math.max(0, Number.parseInt(value("coin", "coin", 0), 10) || 0),
    notify: String(value("notify", "notify", "") || "").trim(),
    notifyDays: Math.max(0, Number.parseInt(value("notify_days", "notify_days", 3), 10) || 3),
    timeout: Math.max(3000, Math.min(120000, Number.parseInt(form.request_timeout_ms, 10) || 10000)),
  };
  await Promise.all([
    configStore.set("osname", cfg.osname),
    configStore.set("use_dumbpanel", String(cfg.useDumbPanel)),
    configStore.set("Vipmoney", String(cfg.vipMoney)),
    configStore.set("coin", String(cfg.coin)),
    configStore.set("notify", cfg.notify),
    configStore.set("notify_days", String(cfg.notifyDays)),
  ]);
  return cfg;
}

function panelClient() {
  const explicit = runtime.qlname || undefined;
  return runtime.useDumbPanel
    ? new vorto.DumbPanelClient(runtime.osname, explicit)
    : new vorto.QingLongClient(runtime.osname, explicit);
}

async function updatePanelEnv(wid, accountInfo) {
  const phone = String(accountInfo?.phone || "").trim();
  if (!wid || !phone) return false;
  const expires = await authStore.get(String(wid), "未授权");
  return panelClient().updateEnv(String(wid), `${wid}#${phone}`, `茄皇:${wid}|到期:${expires}`);
}

async function deletePanelEnv(wid) {
  return panelClient().deleteEnv(String(wid));
}

async function qhLogin(wid, phone) {
  try {
    const result = await vorto.requestJson(new URL("/api/login", API_BASE), {
      method: "POST",
      timeout: runtime.timeout,
      headers: { "user-agent": USER_AGENT, origin: "https://h5.zhumanito.cn", referer: "https://h5.zhumanito.cn/" },
      json: { wid, wm_phone: phone },
    });
    const data = result.data?.data;
    if (data?.token && data?.user) return { ok: true, token: data.token, user: data.user };
    return { ok: false, message: String(result.data?.msg || "登录失败") };
  } catch (error) {
    return { ok: false, message: vorto.errorText(error) };
  }
}

async function bindAccount() {
  const text = await vorto.prompt(
    s,
    '=====茄皇登录=====\n支持批量登录，格式: wid#phone（多账号换行）\nwid获取：小程序“统一梦时代”个人中心授权后点头像复制客户编号\n回复"q"退出',
    120000,
  );
  if (text === null) return s.reply("已取消或操作超时");
  const rows = vorto
    .parseBatchAccounts(text)
    .map((item) => ({ wid: item.field0, phone: item.field1 }))
    .filter((item) => item.wid?.length > 5 && item.phone?.length >= 7);
  if (!rows.length) return s.reply("未检测到有效账号，格式应为 wid#phone");
  await s.reply(`正在登录 ${rows.length} 个账号...`);
  const userId = await currentUserId();
  let accounts = await loadUserAccounts(userId),
    success = 0,
    failed = 0;
  const added = [];
  for (let index = 0; index < rows.length; index++) {
    if (index) await sleep(2000);
    const row = rows[index],
      result = await qhLogin(row.wid, row.phone);
    if (!result.ok) {
      failed++;
      await s.reply(`${vorto.maskAccount(row.wid)} 登录失败: ${result.message}`);
      continue;
    }
    if (!accounts.includes(row.wid)) accounts.push(row.wid);
    const info = { wid: row.wid, phone: row.phone, token: result.token };
    await tokenStore.set(row.wid, JSON.stringify(info));
    added.push({ wid: row.wid, info });
    success++;
    await s.reply(`${vorto.maskAccount(row.wid)} 登录成功`);
  }
  await saveUserAccounts(userId, accounts);
  await s.reply(`=====登录完成=====\n成功: ${success}个\n失败: ${failed}个\n==================`);
  const today = dateText(new Date()),
    needAuth = [];
  for (const item of added) {
    const expires = vorto.extractExpireDate(await authStore.get(item.wid, ""));
    if (expires && expires > today) {
      await s.reply(`${vorto.maskAccount(item.wid)} 已授权，到期: ${expires}`);
      await updatePanelEnv(item.wid, item.info);
    } else needAuth.push(item.wid);
  }
  if (needAuth.length) {
    await s.reply(`${needAuth.length} 个账号需要授权`);
    await authorizeAccounts(needAuth);
  }
}

async function queryAccounts() {
  const selected = await selectCurrentAccounts();
  if (!selected) return;
  await s.reply(`✅ 已选择 ${selected.length} 个账号，正在查询...`);
  for (let index = 0; index < selected.length; index++) {
    if (index) await sleep(2000);
    const wid = selected[index],
      expires = vorto.extractExpireDate(await authStore.get(wid, ""));
    const status = expires && expires >= dateText(new Date()) ? "已授权" : "未授权";
    let resources = "";
    const info = vorto.parseStoredObject(await tokenStore.get(wid, "{}"));
    if (info.phone) {
      const result = await qhLogin(wid, info.phone);
      if (result.ok && result.user)
        resources = `\n💧 水滴: ${result.user.water_num ?? 0}\n☀️ 阳光: ${result.user.sun_num ?? 0}\n🌱 种子: ${result.user.seed_num ?? 0}\n🍎 果实: ${result.user.fruit_num ?? 0}`;
    }
    await s.reply(
      `=====账号信息[${index + 1}/${selected.length}]=====\n📱 账号: ${vorto.maskAccount(wid)}\n🏷 状态: ${status}\n📅 到期: ${expires || "未授权"}${resources}\n==================`,
    );
  }
  return s.reply("✅ 查询完成");
}

async function manageAccounts() {
  const userId = await currentUserId();
  let accounts = await loadUserAccounts(userId);
  if (!accounts.length) return s.reply("=====未绑定账号=====\n❌ 未找到账号\n==================");
  const action = await vorto.prompt(
    s,
    '=====账号管理=====\n[1] 授权账号\n[2] 删除账号\n[3] 提交青龙/DumbPanel\n回复"q"退出',
    120000,
  );
  if (action === null) return s.reply("✅ 已退出");
  const selected = await selectFrom(accounts);
  if (!selected) return;
  if (action === "1") return authorizeAccounts(selected);
  if (action === "2") {
    const confirm = await vorto.prompt(s, "=====确认删除=====\n⚠️ 此操作不可恢复\n回复 y 确认删除", 120000, false);
    if (String(confirm).toLowerCase() !== "y") return s.reply("✅ 已取消");
    for (const wid of selected) {
      accounts = accounts.filter((item) => item !== wid);
      await tokenStore.delete(wid);
      await authStore.delete(wid);
      await deletePanelEnv(wid);
    }
    await saveUserAccounts(userId, accounts);
    return s.reply(`✅ 已删除 ${selected.length} 个账号`);
  }
  if (action === "3") {
    let success = 0;
    for (const wid of selected) {
      const expires = vorto.extractExpireDate(await authStore.get(wid, ""));
      const info = vorto.parseStoredObject(await tokenStore.get(wid, "{}"));
      if (expires && expires >= dateText(new Date()) && (await updatePanelEnv(wid, info))) success++;
    }
    return s.reply(
      `=====提交结果=====\n✅ 成功: ${success}个\n❌ 失败: ${selected.length - success}个\n==================`,
    );
  }
  return s.reply("❌ 无效选择");
}

async function authorizeAccounts(wids) {
  const accounts = [];
  for (const wid of wids) {
    const info = vorto.parseStoredObject(await tokenStore.get(wid, "{}"));
    if (info.wid && info.phone) accounts.push({ wid, info });
  }
  if (!accounts.length) return s.reply("❌ 没有有效账号");
  const monthText = await vorto.prompt(
    s,
    `✅ ${accounts.length} 个有效账号\n=====设置授权时长=====\n请输入授权月数(如:1)\n回复"q"退出`,
    120000,
  );
  if (monthText === null) return s.reply("✅ 已取消");
  if (!/^\d+$/.test(monthText) || Number(monthText) <= 0) return s.reply("❌ 月数必须是大于0的整数");
  const months = Number(monthText),
    totalMoney = roundMoney(accounts.length * months * runtime.vipMoney),
    payConfig = await vorto.getPayConfig();
  const available = [];
  if (payConfig.qr_pay_switch) available.push(["扫码支付", "qrcode"]);
  if (payConfig.ma_pay_switch)
    for (const [key, name] of Object.entries(payConfig.pay_types)) available.push([`${name}(码支付)`, `mapay_${key}`]);
  if (runtime.coin > 0) available.push(["积分兑换", "coin"]);
  if (!available.length) return s.reply("❌ 未配置支付方式，请在Vorto JS公共模块中配置");
  let method = available[0];
  if (available.length > 1) {
    const choice = await vorto.prompt(
      s,
      `=====选择支付方式=====\n📊 账号: ${accounts.length}个\n⏰ 时长: ${months}月\n💰 金额: ${totalMoney}元\n${available.map((item, index) => `[${index + 1}] ${item[0]}`).join("\n")}\n回复数字选择`,
      120000,
    );
    if (choice === null) return s.reply("✅ 已取消");
    method = available[Number(choice) - 1];
    if (!method) return s.reply("❌ 无效选择");
  }
  if (method[1] === "coin") {
    const userId = await currentUserId();
    for (const account of accounts)
      await vorto.processCoinPayment(
        s,
        userId,
        "s_qh_auth",
        account.wid,
        account.info,
        months,
        runtime.coin,
        (wid, info, value) => vorto.processAuthorization(s, "s_qh_auth", wid, info, value, updatePanelEnv),
      );
    return;
  }
  const paid =
    method[1] === "qrcode"
      ? await processQrPayment(months, totalMoney, payConfig)
      : await processMaPayment(months, totalMoney, method[1].slice(6));
  if (!paid) return;
  for (const account of accounts)
    await vorto.processAuthorization(s, "s_qh_auth", account.wid, account.info, months, updatePanelEnv);
}

async function processQrPayment(months, money, payConfig) {
  if (money === 0) return true;
  if (!payConfig.zsm) {
    await s.reply("❌ 未配置收款码");
    return false;
  }
  await s.reply(
    `======扫码支付======\n🎫 商品: 茄皇的家\n📅 时长: ${months}月\n💰 金额: ${money}元\n==================`,
  );
  await s.reply(utils.image(payConfig.zsm));
  const result = await vorto.waitPaymentEvent(s, money, 300000);
  if (result.cancelled) await s.reply("✅ 已取消");
  else if (!result.paid) await s.reply(result.reason === "timeout" ? "❌ 支付超时" : "❌ 支付金额不足或支付事件无效");
  return result.paid;
}

async function processMaPayment(months, money, payType) {
  if (money === 0) return true;
  const client = new vorto.MaPayClient();
  const orderNo = `QH${compactTime()}${Math.floor(10000 + Math.random() * 90000)}`;
  const order = await client.createOrder(money, payType, orderNo, `茄皇的家-${money}`, await currentUserId());
  if (order.error) {
    await s.reply(`❌ 创建订单失败: ${order.error}`);
    return false;
  }
  await s.reply(`=====码支付信息=====\n🎫 商品: 茄皇的家\n📅 时长: ${months}月\n💰 金额: ${money}元`);
  await s.reply(utils.image(await vorto.generateQrcodeUrl(order.pay_url)));
  await s.reply('💳 请扫码支付，5分钟内完成；输入"q"可取消');
  for (let round = 0; round < 60; round++) {
    const child = await s.listen({ timeout: 5000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || "").trim())) {
      await s.reply("✅ 已取消支付");
      return false;
    }
    if (await client.isPaid(orderNo)) {
      await s.reply("✅ 支付成功！");
      return true;
    }
  }
  await s.reply("❌ 支付超时");
  return false;
}

async function adminAuthorize() {
  if (!(await s.isAdmin())) return s.reply("❌ 仅限管理员");
  const choice = await vorto.prompt(s, '=====管理员授权=====\n[1] 授权所有用户\n[2] 按用户授权\n回复"q"退出', 120000);
  if (choice === null) return s.reply("✅ 已退出");
  if (choice === "1") return vorto.adminAuthAllAccounts(s, "s_qh_user", "s_qh_auth", "s_qh_token", updatePanelEnv);
  if (choice === "2") return vorto.adminAuthByUser(s, "s_qh_user", "s_qh_auth", "s_qh_token", updatePanelEnv);
  return s.reply("❌ 无效选择");
}

async function runAuthCheck(cron) {
  if (!cron && !(await s.isAdmin())) return s.reply("❌ 仅限管理员");
  if (!cron) await s.reply("🔍 正在检测...");
  const result = await vorto.checkAuthStatus(
    "s_qh",
    "s_qh_user",
    "s_qh_auth",
    "s_qh_token",
    "茄皇的家",
    deletePanelEnv,
    s,
  );
  return cron ? s.pushAdmin(result) : s.reply(result);
}

async function selectCurrentAccounts() {
  const accounts = await loadUserAccounts(await currentUserId());
  if (!accounts.length) {
    await s.reply("=====未绑定账号=====\n❌ 未找到账号\n💡 发送 茄皇登录 绑定\n==================");
    return null;
  }
  return selectFrom(accounts);
}

async function selectFrom(accounts) {
  const lines = ["========选择账号=======", "[0] 全部账号"];
  for (let index = 0; index < accounts.length; index++) {
    const expires = vorto.extractExpireDate(await authStore.get(accounts[index], ""));
    const state = !expires ? "未授权" : expires < dateText(new Date()) ? "已过期" : `到期:${expires}`;
    lines.push(`[${index + 1}]${vorto.maskAccount(accounts[index])}(${state})`);
  }
  const choice = await vorto.prompt(s, `${lines.join("\n")}\n支持多选，用逗号分隔\n回复"q"退出`, 120000);
  if (choice === null) {
    await s.reply("✅ 已退出");
    return null;
  }
  const selected = choice === "0" ? [...accounts] : vorto.parseSelection(choice, accounts);
  if (!selected.length) {
    await s.reply("❌ 未选择有效账号");
    return null;
  }
  await s.reply(`✅ 已选择 ${selected.length} 个账号`);
  return selected;
}

function showTutorial() {
  return s.reply(
    "=====茄皇教程=====\n用户指令：茄皇登录 / 茄皇查询 / 茄皇管理 / 茄皇教程\n管理员：茄皇授权 / 茄皇检测\n登录格式：wid#phone（每行一个）\nwid获取：小程序“统一梦时代”个人中心授权后点头像复制客户编号\n流程：登录绑定 → 查询资源 → 管理授权 → 支付/积分 → 自动提交面板 → 定时检测\n==================",
  );
}

async function currentUserId() {
  return String((await s.getUserId()) || "");
}
async function loadUserAccounts(userId) {
  return vorto.parseStoredList(await userStore.get(String(userId), "[]")).map(String);
}
async function saveUserAccounts(userId, accounts) {
  if (accounts.length) return userStore.set(String(userId), JSON.stringify(accounts));
  return userStore.delete(String(userId));
}
function dateText(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function compactTime() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}
function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}
function boolValue(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value));
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.log(`统一茄皇执行失败：${error?.stack || error}`);
  await s.reply(`统一茄皇执行失败：${vorto.errorText(error)}`);
});

// [title: mrconli账号授权公共模块]
// [name: mrconliAccountRuntime]
// [desc: mrconli系列插件共用的账号保存、批量登录、查询选择、备注、付费授权、积分兑换、青龙同步、管理员授权和过期清理实现。]
// [author: mrconli / sillyGirl]
// [version: v1.0.1]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/key.svg]
// [module: true]
// [origin: backup/mrconli系列插件]
// [depe: ["./vortoUtils.js","undici"]]

const { sender: s, Bucket, container, plugin, utils, console: sgConsole } = require("sillygirl");
const vorto = require("./vortoUtils");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}
const logger = sgConsole || globalThis.console;

function createAccountRuntime(spec) {
  for (const key of ["title", "shortName", "prefix", "defaultEnvName", "login", "query"])
    if (!spec?.[key]) throw new Error(`账号运行参数缺失：${key}`);
  const users = new Bucket(`${spec.prefix}.user`),
    tokens = new Bucket(`${spec.prefix}.token`),
    remarks = new Bucket(`${spec.prefix}.remark`),
    auth = new Bucket(`${spec.prefix}.auth`);
  const Config = new plugin.Form({
    panel_type: plugin.Form.string().title("面板类型(qinglong/daidai)").default("qinglong"),
    panel_config: plugin.Form.string()
      .title("呆呆面板配置(URL丨AppKey丨Secret)")
      .default("")
      .visibleWhen("panel_type", "==", "daidai"),
    qinglong_id: plugin.Form.integer()
      .title("青龙容器编号")
      .min(1)
      .default(1)
      .visibleWhen("panel_type", "==", "qinglong"),
    var_name: plugin.Form.string().title("青龙变量名").default(spec.defaultEnvName),
    price: plugin.Form.number().title("每账号每月价格").min(0).default(1),
    coin: plugin.Form.integer().title("每账号每月积分").min(0).default(0),
    coin_bucket: plugin.Form.string().title("积分数据桶").default("dd_sign_points"),
    qr_code: plugin.Form.string().title("收款码图片URL").default(""),
    is_proxy: plugin.Form.boolean().title("启用代理").default(false),
    proxy_pool: plugin.Form.string().title("代理池API").default("").visibleWhen("is_proxy", "==", true),
    notify: plugin.Form.string().title("过期通知渠道").default(""),
    notify_days: plugin.Form.integer().title("提前通知天数").min(0).max(365).default(3),
    timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
  });
  let cfg = {};

  async function loadConfig() {
    const form = (await Config.get()) || {},
      legacy = await new Bucket(spec.prefix).getAll(),
      global = await new Bucket("mrconli.config").getAll();
    const pick = (key, fallback) =>
      legacy?.[key] !== undefined && legacy[key] !== "" ? legacy[key] : form[key] !== undefined ? form[key] : fallback;
    cfg = {
      panelType: String(pick("panel_type", "qinglong")).toLowerCase(),
      panelConfig: String(pick("panel_config", legacy.ql_config || "")),
      qinglongId: int(form.qinglong_id, 1),
      varName: String(pick("var_name", spec.defaultEnvName)),
      price: Math.max(0, Number(pick("price", 1)) || 0),
      coin: Math.max(0, int(pick("coin", 0), 0)),
      coinBucket: String(pick("coin_bucket", "dd_sign_points")),
      qrCode: String(global.zsm || form.qr_code || ""),
      proxyEnabled: bool(pick("is_proxy", false)),
      proxyPool: String(pick("proxy_pool", "")),
      notify: String(form.notify || legacy.notify || ""),
      notifyDays: Math.max(0, int(form.notify_days ?? legacy.notify_days, 3)),
      timeout: Math.max(3000, Math.min(120000, int(form.timeout_ms, 15000))),
      dispatcher: null,
    };
    if (cfg.proxyEnabled && cfg.proxyPool) await refreshProxy();
    return cfg;
  }

  async function refreshProxy() {
    try {
      const response = await fetch(cfg.proxyPool, { signal: AbortSignal.timeout(cfg.timeout) });
      const value = (await response.text()).trim();
      if (!value || value.includes("白名单")) throw new Error(value || "代理API为空");
      if (ProxyAgent) cfg.dispatcher = new ProxyAgent(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    } catch (error) {
      cfg.dispatcher = null;
      logger.log(`${spec.title}代理获取失败：${vorto.errorText(error)}`);
    }
  }

  async function main() {
    await loadConfig();
    const content = String((await s.getMsg()) || "").trim();
    if (!content) return cronCheck();
    if (/登录|登陆|上车|新增/.test(content)) return login();
    if (/查询/.test(content)) return query();
    if (/管理/.test(content)) return manage();
    if (/教程/.test(content)) return tutorial();
    if (/清理/.test(content)) return cleanExpired(false);
    if (/授权/.test(content)) return adminAuthorize();
    if (typeof spec.handle === "function") {
      const result = await spec.handle(context(), content);
      if (result !== undefined) return result;
    }
    return s.resume();
  }

  function context(extra = {}) {
    return {
      sender: s,
      config: cfg,
      spec,
      users,
      tokens,
      remarks,
      auth,
      prompt: vorto.prompt,
      request,
      requestJson,
      requestBytes,
      currentUserId,
      mask: vorto.maskAccount,
      ...extra,
    };
  }

  async function login() {
    const userId = await currentUserId();
    const result = await spec.login(context({ userId }));
    const rows = Array.isArray(result) ? result : result ? [result] : [];
    if (!rows.length) return;
    let accounts = await userAccounts(userId),
      added = 0,
      updated = 0,
      failed = 0;
    const messages = [];
    for (const row of rows) {
      if (!row?.account || !row?.token) {
        failed++;
        continue;
      }
      const account = String(row.account),
        exists = accounts.includes(account);
      if (!exists) {
        accounts.push(account);
        added++;
      } else updated++;
      await tokens.set(account, String(row.token));
      await remarks.set(account, String(row.remark || account));
      if (row.extra && typeof row.extra === "object")
        for (const [key, value] of Object.entries(row.extra))
          await new Bucket(`${spec.prefix}.${key}`).set(
            account,
            typeof value === "string" ? value : JSON.stringify(value),
          );
      const expires = vorto.extractExpireDate(await auth.get(account, ""));
      if (expires && expires >= today()) await syncEnv(account, userId);
      messages.push(
        `${row.remark || vorto.maskAccount(account)} ${exists ? "更新" : "登录"}成功${expires ? `，授权到期:${expires}` : "，未授权"}`,
      );
    }
    await saveUserAccounts(userId, accounts);
    return s.reply(
      `📊 登录完成\n✅ 成功: ${rows.length - failed}\n➕ 添加: ${added}\n🔄 更新: ${updated}\n✖️ 失败: ${failed}${messages.length ? `\n${messages.join("\n")}` : ""}`,
    );
  }

  async function query() {
    const userId = await currentUserId(),
      accounts = await userAccounts(userId);
    if (!accounts.length) return s.reply(`❌ 未找到账号，发送“${spec.shortName}登录”绑定`);
    const selected = await selectAccounts(accounts, "查询");
    if (!selected) return;
    for (const account of selected) {
      const item = await loadItem(account, userId),
        expires = vorto.extractExpireDate(await auth.get(account, ""));
      if (spec.requireAuthForQuery !== false && (!expires || expires < today())) {
        await s.reply(`❌ ${item.remark} ${expires ? "授权已过期" : "未授权"}`);
        continue;
      }
      try {
        const result = await spec.query(context({ userId }), item);
        await s.reply(
          `=====${spec.title}详情=====\n👤 账号：${item.remark}\n${typeof result === "string" ? result : result?.message || JSON.stringify(result)}${expires ? `\n⏰ 授权到期：${expires}` : ""}\n==================`,
        );
      } catch (error) {
        await s.reply(`❌ ${item.remark} 查询失败：${vorto.errorText(error)}`);
      }
    }
  }

  async function manage() {
    const userId = await currentUserId(),
      accounts = await userAccounts(userId);
    if (!accounts.length) return s.reply(`❌ 未找到账号，发送“${spec.shortName}登录”绑定`);
    const selected = await selectAccounts(accounts, "管理");
    if (!selected) return;
    const action = await vorto.prompt(
      s,
      "[1] 付费/积分授权\n[2] 删除账号\n[3] 查看CK\n[4] 修改备注\n[5] 提交青龙",
      120000,
    );
    if (action === null) return s.reply("已退出");
    if (action === "1") return paidAuthorize(userId, selected);
    if (action === "2") {
      const confirm = await vorto.prompt(s, `确认删除 ${selected.length} 个账号？回复 y`, 60000, false);
      if (String(confirm).toLowerCase() !== "y") return s.reply("已取消");
      let current = accounts;
      for (const account of selected) {
        current = current.filter((value) => value !== account);
        await tokens.delete(account);
        await remarks.delete(account);
        await auth.delete(account);
        await deleteEnv(account);
      }
      await saveUserAccounts(userId, current);
      return s.reply(`已删除 ${selected.length} 个账号`);
    }
    if (action === "3") {
      for (const account of selected) {
        const item = await loadItem(account, userId);
        await s.reply(`${item.remark}\nCK: ${item.token}`);
      }
      return;
    }
    if (action === "4") {
      if (selected.length !== 1) return s.reply("修改备注只能选择一个账号");
      const value = await vorto.prompt(s, "请输入新备注", 60000);
      if (value === null) return s.reply("已取消");
      await remarks.set(selected[0], value);
      return s.reply("备注已更新");
    }
    if (action === "5") {
      let success = 0;
      for (const account of selected) if (await syncEnv(account, userId)) success++;
      return s.reply(`青龙同步完成：${success}/${selected.length}`);
    }
    return s.reply("无效操作");
  }

  async function paidAuthorize(userId, accounts) {
    const raw = await vorto.prompt(s, `已选择 ${accounts.length} 个账号，请输入授权月数`, 120000);
    if (raw === null || !/^\d+$/.test(raw) || Number(raw) <= 0) return s.reply("授权月数无效");
    const months = Number(raw),
      paid = await takePayment(userId, accounts.length, months);
    if (!paid) return;
    const lines = [];
    for (const account of accounts) {
      const item = await loadItem(account, userId),
        expires = await vorto.calculateAuthTime(`${spec.prefix}.auth`, account, { months });
      await auth.set(account, expires);
      await syncEnv(account, userId);
      lines.push(`${item.remark} → ${expires}`);
    }
    return s.reply(`授权完成\n${lines.join("\n")}`);
  }

  async function takePayment(userId, count, months) {
    const pay = await vorto.getPayConfig(),
      methods = [],
      money = Math.round(count * months * cfg.price * 100) / 100;
    if (cfg.coin > 0) methods.push(["积分兑换", "coin"]);
    if (pay.qr_pay_switch || cfg.qrCode) methods.push(["扫码支付", "qr"]);
    if (pay.ma_pay_switch) for (const [key, name] of Object.entries(pay.pay_types)) methods.push([name, `ma_${key}`]);
    if (!methods.length && money === 0) return true;
    if (!methods.length) {
      await s.reply("未配置支付方式");
      return false;
    }
    const choice = await vorto.prompt(
      s,
      `应付 ${money} 元\n${methods.map((item, index) => `[${index + 1}] ${item[0]}`).join("\n")}`,
      120000,
    );
    const method = methods[Number(choice) - 1];
    if (!method) return false;
    if (method[1] === "coin") {
      const store = new Bucket(cfg.coinBucket),
        balance = int(await store.get(userId, "0"), 0),
        required = count * months * cfg.coin;
      if (balance < required) {
        await s.reply(`积分不足：当前${balance}，需要${required}`);
        return false;
      }
      await store.set(userId, String(balance - required));
      return true;
    }
    if (method[1] === "qr") {
      if (money === 0) return true;
      const image = cfg.qrCode || pay.zsm;
      if (!image) return false;
      await s.reply(utils.image(image));
      const result = await vorto.waitPaymentEvent(s, money, 300000);
      return result.paid;
    }
    const client = new vorto.MaPayClient(),
      orderNo = `${spec.orderPrefix || "MR"}${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
    const order = await client.createOrder(money, method[1].slice(3), orderNo, `${spec.title}-${months}月`, userId);
    if (order.error) {
      await s.reply(`创建订单失败：${order.error}`);
      return false;
    }
    await s.reply(utils.image(await vorto.generateQrcodeUrl(order.pay_url)));
    for (let index = 0; index < 60; index++) {
      const child = await s.listen({ timeout: 5000 });
      if (child && /^q$/i.test(String((await child.getMsg()) || "").trim())) return false;
      if (await client.isPaid(orderNo)) return true;
    }
    return false;
  }

  async function adminAuthorize() {
    if (!(await s.isAdmin())) return s.reply("❌ 您不是管理员");
    const choice = await vorto.prompt(s, "[1] 授权所有用户\n[2] 按用户授权", 120000);
    if (choice === "1")
      return vorto.adminAuthAllAccounts(
        s,
        `${spec.prefix}.user`,
        `${spec.prefix}.auth`,
        `${spec.prefix}.token`,
        (account, info) => syncEnv(account, "admin", info),
      );
    if (choice === "2")
      return vorto.adminAuthByUser(
        s,
        `${spec.prefix}.user`,
        `${spec.prefix}.auth`,
        `${spec.prefix}.token`,
        (account, info) => syncEnv(account, "admin", info),
      );
  }

  async function cleanExpired(cron) {
    if (!cron && !(await s.isAdmin())) return s.reply("❌ 您不是管理员");
    let total = 0,
      cleaned = 0;
    for (const userId of await users.keys()) {
      let accounts = await userAccounts(userId);
      total += accounts.length;
      for (const account of [...accounts]) {
        const expires = vorto.extractExpireDate(await auth.get(account, ""));
        if (!expires || expires <= today()) {
          accounts = accounts.filter((value) => value !== account);
          await tokens.delete(account);
          await remarks.delete(account);
          await auth.delete(account);
          await deleteEnv(account);
          cleaned++;
        }
      }
      await saveUserAccounts(userId, accounts);
    }
    const message = `${spec.title}检测完成：共${total}个，清理${cleaned}个过期/未授权账号`;
    return cron ? s.pushAdmin(message) : s.reply(message);
  }

  async function cronCheck() {
    let total = 0,
      expired = 0,
      notices = 0;
    for (const userId of await users.keys()) {
      for (const account of await userAccounts(userId)) {
        total++;
        const item = await loadItem(account, userId),
          expires = vorto.extractExpireDate(await auth.get(account, ""));
        if (expires && expires <= today()) {
          await deleteEnv(account);
          expired++;
          if (await notifyUser(userId, account, `${item.remark}账号授权已过期，环境变量已删除，请及时续费`)) notices++;
          continue;
        }
        if (!expires || typeof spec.cronCheck !== "function") continue;
        try {
          const result = await spec.cronCheck(context({ userId }), item);
          const messages = Array.isArray(result) ? result : result ? [result] : [];
          for (const message of messages) if (await notifyUser(userId, account, String(message))) notices++;
        } catch (error) {
          logger.log(`${spec.title}定时检测 ${account} 失败：${vorto.errorText(error)}`);
        }
      }
    }
    const message = `${spec.title}定时检测完成：账号${total}个，过期${expired}个，通知${notices}条`;
    return typeof s.pushAdmin === "function" ? s.pushAdmin(message) : logger.log(message);
  }

  async function notifyUser(userId, account, message) {
    const content = `=====${spec.title}账号通知=====\n📱 账号: ${vorto.maskAccount(account)}\n📢 消息: ${message}\n==================`;
    let sent = false;
    for (const platform of ["qq", "wx", "tg", "qx", "ipad"])
      sent = (await vorto.pushUser(s, platform, userId, content)) || sent;
    return sent;
  }

  async function syncEnv(account, userId, knownInfo) {
    const item = knownInfo?.token
      ? { account, token: knownInfo.token, remark: knownInfo.remark || account, userId }
      : await loadItem(account, userId);
    const expires = vorto.extractExpireDate(await auth.get(account, ""));
    if (!expires || expires < today()) return false;
    try {
      const value = spec.envValue ? await spec.envValue(context({ userId }), item) : item.token;
      const remark = `${item.remark}|${account}|用户:${userId}|到期:${expires}`;
      if (cfg.panelType === "daidai")
        return new vorto.DumbPanelClient(cfg.varName, cfg.panelConfig).updateEnv(account, value, remark);
      const ql = new container.QingLong({ id: cfg.qinglongId }),
        rows = rowsOf(await ql.getEnvs({ searchValue: cfg.varName }));
      const found = rows.find(
        (row) => row?.name === cfg.varName && String(row?.remarks || row?.remark || "").includes(account),
      );
      if (found) {
        await ql.updateEnv({ id: found.id || found._id, name: cfg.varName, value, remarks: remark });
        if (typeof ql.enableEnvs === "function") await ql.enableEnvs([found.id || found._id]);
      } else await ql.createEnv({ name: cfg.varName, value, remarks: remark });
      return true;
    } catch (error) {
      logger.log(`${spec.title}同步青龙失败：${vorto.errorText(error)}`);
      return false;
    }
  }
  async function deleteEnv(account) {
    try {
      if (cfg.panelType === "daidai") return new vorto.DumbPanelClient(cfg.varName, cfg.panelConfig).deleteEnv(account);
      const ql = new container.QingLong({ id: cfg.qinglongId }),
        rows = rowsOf(await ql.getEnvs({ searchValue: account })),
        ids = rows
          .filter((row) => row?.name === cfg.varName && String(row?.remarks || "").includes(account))
          .map((row) => row.id || row._id)
          .filter(Boolean);
      if (ids.length) await ql.deleteEnvs(ids);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function selectAccounts(accounts, verb) {
    if (accounts.length === 1) return [...accounts];
    const lines = [`请选择${verb}账号`, "[0] 全部账号"];
    for (let index = 0; index < accounts.length; index++)
      lines.push(`[${index + 1}] ${await remarks.get(accounts[index], vorto.maskAccount(accounts[index]))}`);
    const input = await vorto.prompt(s, `${lines.join("\n")}\n支持 1,3 / 1-3,5`, 120000);
    if (input === null) return null;
    if (input === "0") return [...accounts];
    const selected = [],
      add = (index) => {
        if (index >= 1 && index <= accounts.length && !selected.includes(accounts[index - 1]))
          selected.push(accounts[index - 1]);
      };
    for (const part of input.replace(/，/g, ",").split(",")) {
      const range = part.trim().match(/^(\d+)-(\d+)$/);
      if (range) for (let index = Number(range[1]); index <= Number(range[2]); index++) add(index);
      else if (/^\d+$/.test(part.trim())) add(Number(part.trim()));
    }
    if (!selected.length) {
      await s.reply("未选择有效账号");
      return null;
    }
    return selected;
  }

  async function tutorial() {
    return s.reply(spec.tutorial || `${spec.title}指令：${spec.shortName}登录、查询、管理、授权、清理、教程`);
  }
  async function currentUserId() {
    return String((await s.getUserId()) || "");
  }
  async function userAccounts(userId) {
    return vorto.parseStoredList(await users.get(String(userId), "[]")).map(String);
  }
  async function saveUserAccounts(userId, accounts) {
    return accounts.length ? users.set(String(userId), JSON.stringify(accounts)) : users.delete(String(userId));
  }
  async function loadItem(account, userId) {
    return {
      account,
      userId,
      token: String(await tokens.get(account, "")),
      remark: String(await remarks.get(account, account)),
      expires: vorto.extractExpireDate(await auth.get(account, "")),
    };
  }

  async function request(url, options = {}) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), options.timeout || cfg.timeout);
      const headers = { ...(options.headers || {}) };
      let body = options.body;
      if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers["content-type"] ||= "application/json";
      }
      if (options.form !== undefined) {
        body = new URLSearchParams(options.form).toString();
        headers["content-type"] ||= "application/x-www-form-urlencoded";
      }
      try {
        const response = await fetch(url, {
          method: options.method || "GET",
          headers,
          body,
          signal: controller.signal,
          dispatcher: cfg.dispatcher || undefined,
        });
        const text = await response.text();
        if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
        return { status: response.status, headers: response.headers, text };
      } catch (error) {
        if (cfg.proxyEnabled && attempt < 5) {
          await refreshProxy();
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  async function requestJson(url, options) {
    const response = await request(url, options);
    try {
      return JSON.parse(response.text);
    } catch (_) {
      throw new Error(`接口返回非JSON：${response.text.slice(0, 160)}`);
    }
  }
  async function requestBytes(url, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), options.timeout || cfg.timeout),
      headers = { ...(options.headers || {}) };
    let body = options.body;
    if (options.form !== undefined) {
      body = new URLSearchParams(options.form).toString();
      headers["content-type"] ||= "application/x-www-form-urlencoded";
    }
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body,
        signal: controller.signal,
        dispatcher: cfg.dispatcher || undefined,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${bytes.toString("utf8", 0, 160)}`);
      return { status: response.status, headers: response.headers, bytes };
    } finally {
      clearTimeout(timer);
    }
  }
  return { main, Config, context };
}

function rowsOf(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function int(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}
function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value));
}

module.exports = { createAccountRuntime };

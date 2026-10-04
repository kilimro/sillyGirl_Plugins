// [title: Vorto JS公共模块]
// [name: vortoUtils]
// [desc: vorto_utils 0.2.2 的 JavaScript/SillyGirl 实现，提供账号、授权、积分、青龙、DumbPanel、码支付、二维码和过期检测公共逻辑。]
// [author: rujingxianghai / sillyGirl]
// [version: v0.2.3]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [module: true]
// [origin: 自定义]
// [depe: []]

const crypto = require("node:crypto");
const { sender: defaultSender, Bucket, container, Adapter, plugin, console } = require("sillygirl");

const vortoBucket = new Bucket("s_vorto");
const pointsBucket = new Bucket("dd_sign_points");
const Config = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("默认青龙容器编号").min(1).default(1),
  qlname: plugin.Form.string()
    .title("青龙开放接口")
    .description("Host丨ClientID丨ClientSecret；留空时使用容器编号")
    .default(""),
  dpname: plugin.Form.string().title("DumbPanel开放接口").description("Host丨AppKey丨AppSecret").default(""),
  ma_pay_gateway: plugin.Form.string().title("码支付网关").default(""),
  ma_pay_pid: plugin.Form.string().title("码支付商户ID").default(""),
  ma_pay_key: plugin.Form.string().title("码支付密钥").format("password").default(""),
  ma_pay_notify_url: plugin.Form.string().title("码支付异步通知").default(""),
  ma_pay_return_url: plugin.Form.string().title("码支付同步跳转").default(""),
  ma_pay_switch: plugin.Form.boolean().title("启用码支付").default(false),
  qr_pay_switch: plugin.Form.boolean().title("启用收款码支付").default(false),
  zsm: plugin.Form.string().title("收款码图片链接").default(""),
  pay_types: plugin.Form.string()
    .title("支付方式")
    .description("alipay:支付宝,wxpay:微信支付,qqpay:QQ钱包")
    .default(""),
  request_timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(10000),
});

const DEFAULT_PAY_NAMES = { alipay: "支付宝", wxpay: "微信支付", qqpay: "QQ钱包" };

function maskAccount(account) {
  const value = String(account || "");
  if (value.length < 4) return value;
  if (/^\d{11}$/.test(value)) return `${value.slice(0, 3)}****${value.slice(7)}`;
  if (value.length <= 16) return `${value.slice(0, 4)}****${value.slice(-4)}`;
  return `${value.slice(0, 8)}****${value.slice(-8)}`;
}

function parseBatchAccounts(inputText, separator = "#") {
  const rows = [];
  for (const line of String(inputText || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (!line.includes(separator)) continue;
    const parts = line.split(separator);
    if (parts.length < 2) continue;
    const item = {};
    parts.forEach((part, index) => {
      if (part.trim()) item[`field${index}`] = part.trim();
    });
    if (Object.keys(item).length) rows.push(item);
  }
  return rows;
}

async function getConfigValue(key, fallback = "") {
  const legacy = await vortoBucket.get(key, undefined);
  if (legacy !== undefined && legacy !== null && legacy !== "") return legacy;
  const form = (await Config.get()) || {};
  return form[key] !== undefined && form[key] !== null && form[key] !== "" ? form[key] : fallback;
}

async function getPayConfig() {
  const payTypes = {};
  const raw = String(await getConfigValue("pay_types", ""));
  for (const entry of raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const cut = entry.indexOf(":");
    const key = (cut >= 0 ? entry.slice(0, cut) : entry).trim();
    const name = (cut >= 0 ? entry.slice(cut + 1) : DEFAULT_PAY_NAMES[key] || key).trim();
    if (key) payTypes[key] = name;
  }
  return {
    ma_pay_switch: boolValue(await getConfigValue("ma_pay_switch", false)),
    qr_pay_switch: boolValue(await getConfigValue("qr_pay_switch", false)),
    zsm: String(await getConfigValue("zsm", "")),
    pay_types: payTypes,
  };
}

class QingLongClient {
  constructor(osVarName, qlConfigString) {
    this.osVarName = String(osVarName || "").trim();
    this.configString = qlConfigString;
    this.raw = null;
    this.native = null;
  }

  async configure() {
    if (this.raw || this.native) return;
    const source = this.configString === undefined ? await getConfigValue("qlname", "") : this.configString;
    const fields = splitPanelConfig(source);
    if (fields.length >= 3) {
      this.raw = { host: trimBase(fields[0]), clientId: fields[1], clientSecret: fields[2] };
    } else {
      const id = clampInt(await getConfigValue("qinglong_id", 1), 1, 9999, 1);
      this.native = new container.QingLong({ id });
    }
  }

  async isConfigured() {
    await this.configure();
    return Boolean(this.native || (this.raw?.host && this.raw.clientId && this.raw.clientSecret));
  }

  async getToken() {
    await this.configure();
    if (!this.raw) return "native";
    try {
      const url = new URL("/open/auth/token", this.raw.host);
      url.searchParams.set("client_id", this.raw.clientId);
      url.searchParams.set("client_secret", this.raw.clientSecret);
      const result = await requestJson(url, { timeout: 10000 });
      return Number(result.data?.code) === 200 ? result.data?.data?.token || null : null;
    } catch (_) {
      return null;
    }
  }

  async updateEnv(username, envValue, remark = "", _group = "") {
    await this.configure();
    try {
      if (this.native) {
        const rows = normalizeRows(await this.native.getEnvs({ searchValue: username }));
        const found = rows.find(
          (item) => item?.name === this.osVarName && String(item?.remarks || item?.remark || "").includes(username),
        );
        if (found) {
          const id = envId(found);
          await this.native.updateEnv({ id, name: this.osVarName, value: envValue, remarks: remark });
          if (id && typeof this.native.enableEnvs === "function") await this.native.enableEnvs([id]);
        } else {
          await this.native.createEnv({ name: this.osVarName, value: envValue, remarks: remark });
        }
        return true;
      }
      const token = await this.getToken();
      if (!token) return false;
      const headers = { authorization: `Bearer ${token}` };
      const listUrl = new URL("/open/envs", this.raw.host);
      listUrl.searchParams.set("searchValue", username);
      const list = await requestJson(listUrl, { headers, timeout: 10000 });
      const rows = normalizeRows(list.data?.data);
      const found = rows.find(
        (item) => item?.name === this.osVarName && String(item?.remarks || "").includes(username),
      );
      const payload = { name: this.osVarName, value: envValue, remarks: remark };
      if (found) {
        const id = envId(found);
        payload.id = id;
        await requestJson(new URL("/open/envs", this.raw.host), {
          method: "PUT",
          headers,
          json: payload,
          timeout: 10000,
        });
        if (id)
          await requestJson(new URL("/open/envs/enable", this.raw.host), {
            method: "PUT",
            headers,
            json: [id],
            timeout: 10000,
          });
      } else {
        const created = await requestJson(new URL("/open/envs", this.raw.host), {
          method: "POST",
          headers,
          json: [payload],
          timeout: 10000,
        });
        const id = envId(normalizeRows(created.data?.data)[0] || {});
        if (id)
          await requestJson(new URL("/open/envs/enable", this.raw.host), {
            method: "PUT",
            headers,
            json: [id],
            timeout: 10000,
          });
      }
      return true;
    } catch (error) {
      console.log(`Vorto青龙更新失败：${errorText(error)}`);
      return false;
    }
  }

  async deleteEnv(username) {
    await this.configure();
    try {
      if (this.native) {
        const rows = normalizeRows(await this.native.getEnvs({ searchValue: username }));
        const ids = rows
          .filter(
            (item) => item?.name === this.osVarName && String(item?.remarks || item?.remark || "").includes(username),
          )
          .map(envId)
          .filter(Boolean);
        if (!ids.length) return false;
        await this.native.deleteEnvs(ids);
        return true;
      }
      const token = await this.getToken();
      if (!token) return false;
      const headers = { authorization: `Bearer ${token}` };
      const url = new URL("/open/envs", this.raw.host);
      url.searchParams.set("searchValue", username);
      const list = await requestJson(url, { headers, timeout: 10000 });
      const ids = normalizeRows(list.data?.data)
        .filter((item) => item?.name === this.osVarName && String(item?.remarks || "").includes(username))
        .map(envId)
        .filter(Boolean);
      if (!ids.length) return false;
      await requestJson(new URL("/open/envs", this.raw.host), { method: "DELETE", headers, json: ids, timeout: 10000 });
      return true;
    } catch (error) {
      console.log(`Vorto青龙删除失败：${errorText(error)}`);
      return false;
    }
  }

  update_env(...args) {
    return this.updateEnv(...args);
  }
  delete_env(...args) {
    return this.deleteEnv(...args);
  }
}

class DumbPanelClient {
  constructor(osVarName, configString) {
    this.osVarName = String(osVarName || "").trim();
    this.configString = configString;
    this.config = null;
  }
  async configure() {
    if (this.config) return;
    const source = this.configString === undefined ? await getConfigValue("dpname", "") : this.configString;
    const fields = splitPanelConfig(source);
    this.config = fields.length >= 3 ? { host: trimBase(fields[0]), appKey: fields[1], appSecret: fields[2] } : {};
  }
  async isConfigured() {
    await this.configure();
    return Boolean(this.config.host && this.config.appKey && this.config.appSecret);
  }
  async getToken() {
    if (!(await this.isConfigured())) return null;
    try {
      const result = await requestJson(new URL("/api/open-api/token", this.config.host), {
        method: "POST",
        json: { app_key: this.config.appKey, app_secret: this.config.appSecret },
        timeout: 10000,
      });
      const data = result.data?.data;
      if (data && typeof data === "object") return data.access_token || data.token || null;
      return typeof data === "string" ? data : result.data?.access_token || result.data?.token || null;
    } catch (_) {
      return null;
    }
  }
  parseEnvList(value) {
    const data = value?.data;
    return Array.isArray(data)
      ? data
      : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.data)
          ? data.data
          : [];
  }
  async search(username, token) {
    const url = new URL("/api/envs", this.config.host);
    url.searchParams.set("keyword", this.osVarName);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", "100");
    const result = await requestJson(url, { headers: { authorization: `Bearer ${token}` }, timeout: 10000 });
    return this.parseEnvList(result.data).filter(
      (item) => item?.name === this.osVarName && String(item?.remarks || "").includes(username),
    );
  }
  async updateEnv(username, envValue, remark = "", group = "") {
    try {
      const token = await this.getToken();
      if (!token) return false;
      const found = (await this.search(username, token))[0];
      const payload = { name: this.osVarName, value: envValue, remarks: remark };
      if (String(group || "").trim()) payload.group = String(group).trim();
      const url = found ? new URL(`/api/envs/${found.id}`, this.config.host) : new URL("/api/envs", this.config.host);
      const result = await requestJson(url, {
        method: found ? "PUT" : "POST",
        headers: { authorization: `Bearer ${token}` },
        json: payload,
        timeout: 10000,
      });
      return result.status < 400;
    } catch (error) {
      console.log(`Vorto DumbPanel更新失败：${errorText(error)}`);
      return false;
    }
  }
  async deleteEnv(username) {
    try {
      const token = await this.getToken();
      if (!token) return false;
      const found = (await this.search(username, token))[0];
      if (!found) return false;
      const result = await requestJson(new URL(`/api/envs/${found.id}`, this.config.host), {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      return result.status < 400;
    } catch (error) {
      console.log(`Vorto DumbPanel删除失败：${errorText(error)}`);
      return false;
    }
  }
  update_env(...args) {
    return this.updateEnv(...args);
  }
  delete_env(...args) {
    return this.deleteEnv(...args);
  }
}

class MaPayClient {
  constructor(options = {}) {
    this.options = options && typeof options === "object" ? options : {};
    this.config = null;
  }
  async configure() {
    if (this.config) return;
    this.config = {
      gateway: trimBase(this.options.gateway ?? (await getConfigValue("ma_pay_gateway", ""))),
      pid: String(this.options.pid ?? (await getConfigValue("ma_pay_pid", ""))),
      key: String(this.options.key ?? (await getConfigValue("ma_pay_key", ""))),
      notifyUrl: String(
        this.options.notify_url ?? this.options.notifyUrl ?? (await getConfigValue("ma_pay_notify_url", "")),
      ),
      returnUrl: String(
        this.options.return_url ?? this.options.returnUrl ?? (await getConfigValue("ma_pay_return_url", "")),
      ),
    };
  }
  async isConfigured() {
    await this.configure();
    return Boolean(this.config.gateway && this.config.pid && this.config.key);
  }
  sign(params) {
    const filtered = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
      .sort(([a], [b]) => a.localeCompare(b));
    return crypto
      .createHash("md5")
      .update(filtered.map(([key, value]) => `${key}=${value}`).join("&") + this.config.key)
      .digest("hex")
      .toLowerCase();
  }
  async createOrder(amount, payType, outTradeNo, subject, param = "") {
    if (!(await this.isConfigured())) return { error: "码支付未配置" };
    const params = {
      pid: this.config.pid,
      type: payType,
      out_trade_no: outTradeNo,
      notify_url: this.config.notifyUrl,
      return_url: this.config.returnUrl,
      name: subject,
      money: String(Math.round(Number(amount) * 100) / 100),
      param,
    };
    Object.keys(params).forEach((key) => {
      if (!params[key]) delete params[key];
    });
    params.sign = this.sign(params);
    params.sign_type = "MD5";
    try {
      const result = await requestJson(new URL("/mapi.php", this.config.gateway), {
        method: "POST",
        form: params,
        timeout: 10000,
      });
      if (Number(result.data?.code) !== 1) return { error: result.data?.msg || "创建订单失败", raw: result.data };
      const tradeNo = result.data.trade_no;
      return {
        trade_no: tradeNo,
        pay_url: new URL(`/pay/${tradeNo}`, this.config.gateway).toString(),
        raw: result.data,
      };
    } catch (error) {
      return { error: errorText(error) };
    }
  }
  async checkOrder(outTradeNo) {
    if (!(await this.isConfigured())) return { error: "码支付未配置" };
    try {
      const url = new URL("/xpay/epay/api.php", this.config.gateway);
      Object.entries({ act: "order", pid: this.config.pid, key: this.config.key, out_trade_no: outTradeNo }).forEach(
        ([key, value]) => url.searchParams.set(key, value),
      );
      return (await requestJson(url, { timeout: 10000 })).data;
    } catch (error) {
      return { error: errorText(error) };
    }
  }
  async isPaid(outTradeNo) {
    const data = await this.checkOrder(outTradeNo);
    return Number(data?.code) === 1 && Number(data?.status) === 1;
  }
  create_order(...args) {
    return this.createOrder(...args);
  }
  check_order(...args) {
    return this.checkOrder(...args);
  }
  is_paid(...args) {
    return this.isPaid(...args);
  }
}

async function generateQrcodeUrl(content, size = "200x200") {
  const encoded = encodeURIComponent(String(content));
  const timeout = 8000;
  try {
    const url = new URL("https://qrcode.vorto.cn/api/qrcode/generate");
    url.searchParams.set("content", String(content));
    url.searchParams.set("api_key", "4jpC3Cgd0zA7Z3HTJ6aDfW9QjtzitDGI");
    const result = await requestJson(url, { timeout });
    if (result.status === 200 && result.data?.success && result.data?.data?.url) return result.data.data.url;
  } catch (_) {}
  const pixels = Number.parseInt(String(size).split("x")[0], 10) || 300;
  const qrtool = `https://api.qrtool.cn/?text=${encoded}&size=${pixels}&margin=20&level=H`;
  try {
    const response = await request(qrtool, { method: "HEAD", timeout: 5000 });
    if (response.status === 200) return qrtool;
  } catch (_) {}
  return `https://api.qrserver.com/v1/create-qr-code/?size=${encodeURIComponent(size)}&data=${encoded}`;
}

function extractExpireDate(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const data = JSON.parse(value);
    if (data && typeof data === "object") return String(data.expire_time || data.expire || "").trim();
  } catch (_) {}
  return value;
}

async function calculateAuthTime(authBucketName, account, options = {}) {
  const months = Number(options.months ?? 0),
    days = Number(options.days ?? 0);
  const store = new Bucket(authBucketName);
  const current = extractExpireDate(await store.get(String(account), ""));
  let start = startOfLocalDay(new Date());
  const parsed = parseDate(current);
  if (parsed && parsed > start) start = parsed;
  start.setDate(start.getDate() + 30 * months + days);
  return formatDate(start);
}

async function processAuthorization(sender, authBucketName, account, accountInfo, months, updateQlCallback) {
  try {
    const expires = await calculateAuthTime(authBucketName, account, { months });
    await new Bucket(authBucketName).set(String(account), expires);
    if (updateQlCallback) await updateQlCallback(account, accountInfo);
    await sender.reply(`=====授权成功=====\n📱 账号: ${maskAccount(account)}\n📅 到期: ${expires}\n==================`);
    return true;
  } catch (error) {
    await sender.reply(`授权异常: ${errorText(error)}`);
    return false;
  }
}

async function getUserPoints(userId) {
  const value = Number.parseInt(await pointsBucket.get(String(userId), "0"), 10);
  return Number.isFinite(value) ? value : 0;
}
async function updateUserPoints(userId, value) {
  try {
    await pointsBucket.set(String(userId), String(Math.trunc(Number(value))));
    return true;
  } catch (_) {
    return false;
  }
}

async function processCoinPayment(
  sender,
  userId,
  authBucket,
  account,
  accountInfo,
  months,
  coinPerMonth,
  authCallback,
) {
  try {
    const required = Number(months) * Number(coinPerMonth);
    const balance = await getUserPoints(userId);
    if (balance < required) {
      await sender.reply(`=====积分不足=====\n❌ 当前: ${balance}\n💰 需要: ${required}\n==================`);
      return false;
    }
    const newBalance = balance - required;
    if (!(await updateUserPoints(userId, newBalance))) {
      await sender.reply("❌ 积分扣除失败，请联系管理员");
      return false;
    }
    if (await authCallback(account, accountInfo, months)) {
      await sender.reply(`=====积分兑换成功=====\n✅ 扣除: ${required}\n💰 剩余: ${newBalance}\n==================`);
      return true;
    }
    await updateUserPoints(userId, balance);
    return false;
  } catch (error) {
    await sender.reply(`积分兑换异常: ${errorText(error)}`);
    return false;
  }
}

async function selectAccounts(sender, userBucketName, userId, authBucketName, pluginName) {
  const accounts = parseStoredList(await new Bucket(userBucketName).get(String(userId), "[]"));
  if (!accounts.length) {
    await sender.reply(`=====未绑定账号=====\n❌ 未找到账号\n💡 发送 ${pluginName}登录 绑定\n==================`);
    return [null, null];
  }
  const auth = new Bucket(authBucketName);
  const lines = ["========选择账号=======", "[0] 全部账号"];
  for (let index = 0; index < accounts.length; index++) {
    const expires = extractExpireDate(await auth.get(String(accounts[index]), ""));
    const state = !expires ? "未授权" : expires < formatDate(new Date()) ? "已过期" : `到期:${expires}`;
    lines.push(`[${index + 1}]${maskAccount(accounts[index])}(${state})`);
  }
  lines.push("=====================", "支持多选，用逗号分隔", '回复"q"退出', "=====================");
  const choice = await prompt(sender, lines.join("\n"), 120000);
  if (choice === null) {
    await sender.reply("✅ 已退出");
    return [null, null];
  }
  const selected = choice === "0" ? [...accounts] : parseSelection(choice, accounts);
  if (!selected.length) {
    await sender.reply("❌ 未选择有效账号");
    return [null, null];
  }
  return [accounts, selected];
}

async function checkAuthStatus(
  configBucketName,
  userBucketName,
  authBucketName,
  tokenBucketName,
  pluginName,
  deleteQlCallback,
  sender = defaultSender,
) {
  const configStore = new Bucket(configBucketName),
    userStore = new Bucket(userBucketName),
    authStore = new Bucket(authBucketName),
    tokenStore = new Bucket(tokenBucketName);
  const channels = String(await configStore.get("notify", ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!channels.length) return "❌ 未配置通知渠道";
  const keys = await userStore.keys();
  if (!keys.length) return "❌ 没有用户";
  const notifyDays = clampInt(await configStore.get("notify_days", "3"), 0, 3650, 3);
  const today = startOfLocalDay(new Date());
  let total = 0,
    notified = 0,
    cleaned = 0;
  for (const userId of keys) {
    let accounts = parseStoredList(await userStore.get(String(userId), "[]"));
    const toNotify = [],
      toClean = [];
    for (const account of accounts) {
      const expires = extractExpireDate(await authStore.get(String(account), ""));
      const date = parseDate(expires);
      const daysLeft = date ? Math.round((date - today) / 86400000) : 0;
      if (!date || daysLeft <= 0) toClean.push(account);
      else if (daysLeft <= notifyDays) toNotify.push({ account, expires, daysLeft });
    }
    total += accounts.length;
    for (const account of toClean) {
      if (deleteQlCallback) await deleteQlCallback(account);
      await tokenStore.delete(String(account));
      await authStore.delete(String(account));
      accounts = accounts.filter((value) => value !== account);
      cleaned++;
    }
    if (accounts.length) await userStore.set(String(userId), JSON.stringify(accounts));
    else await userStore.delete(String(userId));
    if (toNotify.length) {
      const message = `=====${pluginName}账号检测=====\n⚠️ 即将过期:\n${toNotify.map((item) => `📱 ${maskAccount(item.account)} 剩余${item.daysLeft}天(${item.expires})`).join("\n")}\n💡 发送"${pluginName}管理"续费\n==================`;
      for (const platform of channels) if (await pushUser(sender, platform, userId, message)) notified++;
    }
  }
  return `✅ 检测完成，共 ${total} 个账号，发送 ${notified} 条通知，清理 ${cleaned} 个过期账号`;
}

async function adminAuthAllAccounts(sender, userBucketName, authBucketName, tokenBucketName, updateQlCallback) {
  const users = new Bucket(userBucketName),
    tokens = new Bucket(tokenBucketName),
    auth = new Bucket(authBucketName);
  const keys = await users.keys();
  const rows = [];
  for (const id of keys) rows.push({ id, accounts: parseStoredList(await users.get(String(id), "[]")) });
  if (!rows.length) return sender.reply("❌ 无用户");
  const total = rows.reduce((sum, row) => sum + row.accounts.length, 0);
  const rawDays = await prompt(
    sender,
    `=====授权所有用户=====\n👥 用户数: ${rows.length}\n📊 账号数: ${total}\n请输入授权天数:\n(正数增加天数，负数减少天数)\n回复"q"退出`,
    120000,
  );
  if (rawDays === null || !/^-?\d+$/.test(rawDays))
    return sender.reply(rawDays === null ? "✅ 已取消授权" : "❌ 无效的天数");
  const days = Number(rawDays),
    action = days > 0 ? `增加 ${days} 天` : `减少 ${Math.abs(days)} 天`;
  const confirm = await prompt(
    sender,
    `=====确认授权=====\n👥 用户数: ${rows.length}\n📊 账号数: ${total}\n⏰ 操作: ${action}\n⚠️ 此操作影响所有用户\n回复"y"确认`,
    120000,
    false,
  );
  if (String(confirm).toLowerCase() !== "y") return sender.reply("✅ 已取消授权");
  let success = 0,
    fail = 0;
  for (const row of rows)
    for (const account of row.accounts) {
      try {
        const info = parseStoredObject(await tokens.get(String(account), "{}"));
        const expires = await calculateAuthTime(authBucketName, account, { days });
        await auth.set(String(account), expires);
        if (updateQlCallback) await updateQlCallback(account, info);
        success++;
      } catch (_) {
        fail++;
      }
    }
  return sender.reply(
    `=====授权结果=====\n✅ 成功: ${success} 个账号\n❌ 失败: ${fail} 个账号\n⏰ 操作: ${action}\n==================`,
  );
}

async function adminAuthByUser(sender, userBucketName, authBucketName, tokenBucketName, updateQlCallback) {
  const userId = await prompt(sender, '=====按用户授权=====\n请输入用户ID:\n回复"q"退出', 120000);
  if (userId === null) return sender.reply("✅ 已退出");
  const users = new Bucket(userBucketName),
    tokens = new Bucket(tokenBucketName),
    auth = new Bucket(authBucketName);
  const accounts = parseStoredList(await users.get(userId, "[]"));
  if (!accounts.length) return sender.reply(`❌ 用户 ${userId} 没有绑定任何账号`);
  const lines = [`=====用户 ${userId} 的账号=====`, "[0] 选择全部账号"];
  for (let index = 0; index < accounts.length; index++)
    lines.push(
      `[${index + 1}] ${maskAccount(accounts[index])} - ${extractExpireDate(await auth.get(String(accounts[index]), "")) || "未授权"}`,
    );
  const choice = await prompt(sender, `${lines.join("\n")}\n支持多选，用逗号分隔\n回复"q"退出`, 120000);
  if (choice === null) return sender.reply("✅ 已取消授权");
  const selected = choice === "0" ? [...accounts] : parseSelection(choice, accounts);
  if (!selected.length) return sender.reply("❌ 未选择任何账号");
  const rawDays = await prompt(
    sender,
    `已选择 ${selected.length} 个账号\n请输入授权天数:\n(正数增加天数，负数减少天数)`,
    120000,
  );
  if (rawDays === null || !/^-?\d+$/.test(rawDays))
    return sender.reply(rawDays === null ? "✅ 已取消授权" : "❌ 无效的天数");
  const days = Number(rawDays),
    action = days > 0 ? `增加 ${days} 天` : `减少 ${Math.abs(days)} 天`;
  const confirm = await prompt(
    sender,
    `=====确认授权=====\n📊 账号数: ${selected.length} 个\n⏰ 操作: ${action}\n回复"y"确认`,
    120000,
    false,
  );
  if (String(confirm).toLowerCase() !== "y") return sender.reply("✅ 已取消授权");
  let success = 0,
    fail = 0;
  for (const account of selected) {
    try {
      const info = parseStoredObject(await tokens.get(String(account), "{}"));
      const expires = await calculateAuthTime(authBucketName, account, { days });
      await auth.set(String(account), expires);
      if (updateQlCallback) await updateQlCallback(account, info);
      success++;
    } catch (_) {
      fail++;
    }
  }
  return sender.reply(
    `=====授权结果=====\n✅ 成功: ${success} 个账号\n❌ 失败: ${fail} 个账号\n⏰ 操作: ${action}\n==================`,
  );
}

async function waitPaymentEvent(sender, requiredMoney, timeout = 300000) {
  const child = await sender.listen({ timeout });
  if (!child) return { paid: false, cancelled: false, reason: "timeout" };
  const content = String((await child.getMsg()) || "").trim();
  if (/^q$/i.test(content)) return { paid: false, cancelled: true, reason: "cancel" };
  const event = await child.getEvent().catch(() => ({}));
  const money = Number(event?.Money ?? event?.money ?? event?.payment?.money ?? content);
  return { paid: Number.isFinite(money) && money >= Number(requiredMoney), cancelled: false, money, event };
}

async function requestJson(url, options = {}) {
  const result = await request(url, options);
  if (!result.text) throw new Error(`接口返回为空（HTTP ${result.status}）`);
  try {
    result.data = JSON.parse(result.text);
  } catch (_) {
    throw new Error(`接口返回非JSON（HTTP ${result.status}）：${result.text.slice(0, 160)}`);
  }
  return result;
}

async function request(url, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), Number(options.timeout) || 10000);
  const headers = Object.assign({}, options.headers || {});
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
    const response = await fetch(url, { method: options.method || "GET", headers, body, signal: controller.signal });
    const text = options.method === "HEAD" ? "" : await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return { status: response.status, headers: response.headers, text };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function prompt(sender, text, timeout = 120000, cancelOnQ = true) {
  await sender.reply(text);
  const child = await sender.listen({ timeout });
  if (!child) return null;
  const value = String((await child.getMsg()) || "").trim();
  return !value || (cancelOnQ && /^q$/i.test(value)) ? null : value;
}

async function pushUser(sender, platform, userId, content) {
  try {
    const botId = await sender.getBotId();
    const adapter = new Adapter({ platform: String(platform), bot_id: String(botId || "") });
    await adapter.push({ user_id: String(userId), content });
    if (typeof adapter.destroy === "function") await adapter.destroy();
    return true;
  } catch (_) {
    try {
      const adapter = await sender.getAdapter();
      await adapter.push({ user_id: String(userId), content });
      return true;
    } catch (_) {
      return false;
    }
  }
}

function parseStoredList(raw) {
  if (Array.isArray(raw)) return raw;
  const value = String(raw || "").trim();
  if (!value) return [];
  for (const candidate of [value, value.replace(/'/g, '"')]) {
    try {
      const rows = JSON.parse(candidate);
      if (Array.isArray(rows)) return rows;
    } catch (_) {}
  }
  return [];
}
function parseStoredObject(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const value = JSON.parse(String(raw || "{}"));
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}
function parseSelection(raw, accounts) {
  const selected = [];
  for (const token of String(raw).split(",")) {
    if (!/^\d+$/.test(token.trim())) continue;
    const index = Number(token.trim()) - 1;
    if (index >= 0 && index < accounts.length && !selected.includes(accounts[index])) selected.push(accounts[index]);
  }
  return selected;
}
function splitPanelConfig(value) {
  return String(value || "")
    .replace(/\|/g, "丨")
    .split("丨")
    .map((item) => item.trim())
    .filter(Boolean);
}
function normalizeRows(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}
function envId(value) {
  return value?.id || value?._id;
}
function trimBase(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}
function boolValue(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value));
}
function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}
function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function errorText(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

module.exports = {
  version: "0.2.3",
  Config,
  maskAccount,
  mask_account: maskAccount,
  parseBatchAccounts,
  parse_batch_accounts: parseBatchAccounts,
  getPayConfig,
  get_pay_config: getPayConfig,
  QingLongClient,
  DumbPanelClient,
  MaPayClient,
  generateQrcodeUrl,
  generate_qrcode_url: generateQrcodeUrl,
  extractExpireDate,
  calculateAuthTime,
  calculate_auth_time: calculateAuthTime,
  processAuthorization,
  process_authorization: processAuthorization,
  getUserPoints,
  get_user_points: getUserPoints,
  updateUserPoints,
  update_user_points: updateUserPoints,
  processCoinPayment,
  process_coin_payment: processCoinPayment,
  selectAccounts,
  select_accounts: selectAccounts,
  checkAuthStatus,
  check_auth_status: checkAuthStatus,
  adminAuthAllAccounts,
  admin_auth_all_accounts: adminAuthAllAccounts,
  adminAuthByUser,
  admin_auth_by_user: adminAuthByUser,
  waitPaymentEvent,
  request,
  requestJson,
  prompt,
  parseStoredList,
  parseStoredObject,
  parseSelection,
  errorText,
  pushUser,
};

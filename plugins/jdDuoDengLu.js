// [title: 京东多协议登录]
// [name: jdDuoDengLu]
// [desc: 迁移 BBK、NarkPro、QRabbitPro 和自动化登录队列，支持账密、短信、扫码、续期检测及青龙同步]
// [author: qingge,specter]
// [version: v1.6.1]
// [rule: ^(BBK版本|socksout|socksret|socks导入|兔子检测)$]
// [rule: ^(帐密|账密)(登录|登陆|刷新|检测刷新|临时刷新|删除|清理|重置|停止)$]
// [rule: ^(登录|登陆|短信登录|短信登陆|扫码|口令|密码登录|pro账密|更新账号)$]
// [rule: ^自动(帐密|账密|帐密登陆|帐密登录|重置|查询)$]
// [rule: ^账密添加+([\s\S]+)$]
// [cron: 0 */6 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 99999999]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/key.svg]
// [carry: true]
// [origin: backup/BBK拼车账密_v1.0.7_By.qingge.txt;backup/BBK账密登录_v1.0.0_By.qingge.js;backup/JD自动化登录_v1.0.0_By.qingge.txt;backup/JD自动化登录_v1.0.3_By.qingge.js;backup/Pro-账密登录_v1.5.5_By.qingge.txt;backup/QRabbitPro_v1.5.1_By.specter.txt;backup/QRabbitPro账密_v1.1.8_By.specter.py;backup/QRabbitPro账密_v1.2.0_By.specter.txt;backup/JD账密登录_v1.6.0_By.chuan.py;backup/NarkPro登录_v1.4.1_By.chuan.py;backup/京东登录_v3.3.0_By.97610325.py;backup/京东账密登录_v1.1.3_By.chuan.py;backup/兔子登录_v1.4.18_By.buzhi.txt]
// [depe: []]

const crypto = require("node:crypto");
const { Bucket, sender: s, plugin, container, utils } = require("sillygirl");

const accountStore = new Bucket("jdDuoDengLu.accounts"),
  credentialStore = new Bucket("AutoJdck"),
  failureStore = new Bucket("jdDuoDengLu.failures"),
  notifyStore = new Bucket("jdNotify");
const form = new plugin.Form({
  mode: plugin.Form.select([
    { label: "QRabbitPro", value: "qrabbit" },
    { label: "BBK", value: "bbk" },
    { label: "NarkPro", value: "nark" },
  ])
    .title("账密服务")
    .default("qrabbit"),
  qrabbit_url: plugin.Form.string().title("QRabbitPro 地址").default("").visibleWhen("mode", "==", "qrabbit"),
  qrabbit_token: plugin.Form.string().title("QRabbitPro BotApiToken").default("").visibleWhen("mode", "==", "qrabbit"),
  qrabbit_container_id: plugin.Form.integer()
    .title("QRabbitPro 容器编号")
    .min(1)
    .default(1)
    .visibleWhen("mode", "==", "qrabbit"),
  bbk_url: plugin.Form.string().title("BBK 地址").default("").visibleWhen("mode", "==", "bbk"),
  bbk_socks5: plugin.Form.string().title("BBK SOCKS5").default("").visibleWhen("mode", "==", "bbk"),
  nark_url: plugin.Form.string().title("NarkPro 地址").default("").visibleWhen("mode", "==", "nark"),
  nark_token: plugin.Form.string().title("NarkPro Token").default("").visibleWhen("mode", "==", "nark"),
  auto_url: plugin.Form.string().title("自动化登录队列地址").default(""),
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  env_name: plugin.Form.string().title("青龙变量名").default("JD_COOKIE"),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(5000).max(120000).default(60000),
  max_failures: plugin.Form.integer().title("连续失败清理阈值").min(1).max(20).default(5),
});
let cfg = {};

async function main() {
  cfg = normalizeConfig((await form.get()) || {});
  const content = String((await s.getMsg()) || "").trim();
  if (!content) return refreshAll(true);
  if (content === "BBK版本") return s.reply("京东多协议登录迁移版 v1.6.0");
  if (/^socks(out|ret|导入)$/.test(content)) return socksInfo(content);
  if (content === "兔子检测") return rabbitTest();
  if (/^自动/.test(content)) return autoQueue(content);
  if (/删除|清理|重置|停止/.test(content)) return manage(content);
  if (/刷新|检测刷新|临时刷新|更新账号/.test(content)) return refreshAll(false);
  if (/短信/.test(content)) return smsLogin();
  if (content === "扫码") return qrLogin();
  if (content === "口令") return qrLogin();
  if (/登录|登陆|密码登录|pro账密|^账密添加/.test(content))
    return passwordLogin(content.match(/^账密添加([\s\S]+)/)?.[1]?.trim());
}

function normalizeConfig(raw) {
  return {
    ...raw,
    mode: ["qrabbit", "bbk", "nark"].includes(raw.mode) ? raw.mode : "qrabbit",
    qrabbit_url: trimBase(raw.qrabbit_url),
    bbk_url: trimBase(raw.bbk_url),
    nark_url: trimBase(raw.nark_url),
    auto_url: trimBase(raw.auto_url),
    timeout_ms: Number(raw.timeout_ms) || 60000,
    max_failures: Number(raw.max_failures) || 5,
  };
}

async function passwordLogin(prefill) {
  if (await s.getChatId()) return s.reply("为了账户安全，请私聊机器人使用账密登录");
  let account = prefill || (await prompt("请输入京东账号或手机号"));
  if (!account) return;
  const password = await prompt("请输入密码");
  if (!password) return;
  const result = await loginByMode(account, password);
  if (result.verifyUrl) {
    await s.reply(`账号需要安全验证：\n${result.verifyUrl}\n验证完成后再次发送账密登录`);
    return;
  }
  if (!result.cookie) throw new Error(result.message || "登录结果没有 Cookie");
  const pin = pt(result.cookie, "pt_pin");
  if (!pin) throw new Error("Cookie 缺少 pt_pin");
  const owner = await uid(),
    platform = String((await s.getPlatform()) || "");
  await saveAccount({
    account,
    password,
    cookie: normalizePt(result.cookie),
    pin,
    user: owner,
    platform,
    mode: cfg.mode,
  });
  await syncQingLong(pin, normalizePt(result.cookie), owner);
  await updateNotify(pin, result.cookie);
  await failureStore.delete(account);
  return s.reply(`登录成功：${decode(pin)}\n已保存账密并同步青龙`);
}

async function loginByMode(account, password) {
  if (cfg.mode === "bbk") return bbkLogin(account, password);
  if (cfg.mode === "nark") return narkLogin(account, password);
  return rabbitPasswordLogin(account, password);
}
async function bbkLogin(account, password) {
  if (!cfg.bbk_url) throw new Error("请先配置 BBK 地址");
  const payload = bbkSign({ username: account, password, ...(cfg.bbk_socks5 ? { socks5proxy: cfg.bbk_socks5 } : {}) }),
    data = await requestJson(`${cfg.bbk_url}/xcx/pwdLoginApi`, { method: "POST", json: payload });
  if (Number(data.code) === 128 || /需要验证|安全风险|为了账号安全/.test(String(data.msg || "")))
    return { verifyUrl: data.jmp_url || data.url, message: data.msg };
  if (Number(data.code) !== 200) throw new Error(data.msg || "BBK 登录失败");
  const cookie = pickCookie(data) || String(data.msg || "").match(/pt_key=[^;]+;pt_pin=[^;]+;/)?.[0];
  return { cookie, message: data.msg };
}
async function narkLogin(account, password) {
  if (!cfg.nark_url) throw new Error("请先配置 NarkPro 地址");
  const data = await requestJson(`${cfg.nark_url}/Pwd/Login`, {
    method: "POST",
    json: { username: account, password, BotApitoken: String(cfg.nark_token || "") },
  });
  if (data.success === false) {
    if (/认证|验证/.test(String(data.message || ""))) return { verifyUrl: data.data?.jmp_url, message: data.message };
    throw new Error(data.message || "NarkPro 登录失败");
  }
  return { cookie: data.data?.ck || pickCookie(data), message: data.message };
}
async function rabbitPasswordLogin(account, password) {
  checkRabbit();
  let init = await rabbit("/bot/pwd/init", { account });
  if (!init.success && Number(init.code) === 666)
    for (let i = 0; i < 5 && !init.success; i++) init = await rabbit("/bot/pwd/auto_captcha", { account });
  if (!init.success && ![0, 200].includes(Number(init.code)))
    throw new Error(init.message || init.msg || "兔子初始化失败");
  let data = await rabbit("/bot/pwd/login", { account, pwd: encryptRabbitPassword(password, account) });
  if (!data.success && [601, 602].includes(Number(data.code))) {
    const risk = await rabbit("/bot/risk/risk_send", { account });
    if (!risk.success && Number(risk.code) !== 666) throw new Error(risk.message || "二次验证发送失败");
    const code = await prompt("请输入二次验证验证码");
    if (!code) return {};
    data = await rabbit("/bot/risk/risk_verify_code", { account, code });
  }
  if (!data.success) {
    if (Number(data.code) === 555) return { verifyUrl: data.RiskUrl, message: data.message || data.msg };
    throw new Error(data.message || data.msg || "兔子账密登录失败");
  }
  return { cookie: data.ck || pickCookie(data), message: data.message || data.msg };
}

async function smsLogin() {
  checkRabbit();
  const phone = await prompt("请输入手机号");
  if (!/^1[3-9]\d{9}$/.test(String(phone))) return s.reply("手机号格式错误");
  let data = await requestJson(`${cfg.qrabbit_url}/sms/sendSMS`, {
    method: "POST",
    json: { Phone: phone, container_id: Number(cfg.qrabbit_container_id) || 1 },
  });
  if (!data.success) {
    data = await requestJson(`${cfg.qrabbit_url}/sms/AutoCaptcha`, {
      method: "POST",
      json: { Phone: phone, container_id: Number(cfg.qrabbit_container_id) || 1 },
    });
    if (!data.success) throw new Error(data.message || data.msg || "短信发送失败");
  }
  const code = await prompt("验证码发送成功，请输入六位验证码");
  if (!/^\d{6}$/.test(String(code))) return s.reply("验证码格式错误");
  const result = await requestJson(`${cfg.qrabbit_url}/sms/VerifyCode`, {
    method: "POST",
    json: { Phone: phone, Code: code, container_id: Number(cfg.qrabbit_container_id) || 1 },
  });
  if (String(result.code) !== "200") throw new Error(result.message || result.msg || "短信登录失败");
  const cookie = result.ck || (await rabbitCookieByPin(result.pin, "sms"));
  if (!cookie) throw new Error("兔子未返回 Cookie");
  return finishCookie(cookie, phone, "sms");
}

async function qrLogin() {
  checkRabbit();
  const created = await requestJson(`${cfg.qrabbit_url}/api/GenQrCode`, {
    method: "POST",
    json: { token: cfg.qrabbit_token, container_id: Number(cfg.qrabbit_container_id) || 1 },
  });
  if (!created.qr || !created.QRCodeKey) throw new Error(created.message || created.msg || "二维码生成失败");
  await s.reply(`请使用京东 App 扫码，回复 q 退出\n${utils.image(`data:image/jpeg;base64,${created.qr}`)}`);
  for (let i = 0; i < 70; i++) {
    const child = await s.listen({ timeout: 2000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || "").trim())) return s.reply("已退出");
    const data = await requestJson(`${cfg.qrabbit_url}/api/QrCheck`, {
      method: "POST",
      json: {
        QRCodeKey: created.QRCodeKey,
        token: cfg.qrabbit_token,
        container_id: Number(cfg.qrabbit_container_id) || 1,
      },
    });
    if (String(data.code) === "200") {
      const cookie = data.ck || (await rabbitCookieByPin(data.pin, "qr"));
      if (!cookie) throw new Error("扫码成功但未取得 Cookie");
      return finishCookie(cookie, "", "qr");
    }
    if (["500", "202", "502", "220"].includes(String(data.code)))
      throw new Error(data.errorMsg || data.msg || data.message || "扫码登录失败");
  }
  return s.reply("二维码等待超时");
}
async function rabbitCookieByPin(pin, loginType) {
  const token = await rabbitAdminToken();
  const data = await requestJson(`${cfg.qrabbit_url}/env/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    json: { pin, container_id: Number(cfg.qrabbit_container_id) || 1 },
  });
  const item = (data.data || []).find((row) => String(row.pin) === String(pin));
  return loginType === "sms" ? item?.mck : item?.appck;
}
async function finishCookie(cookie, account, mode) {
  const pin = pt(cookie, "pt_pin"),
    owner = await uid(),
    platform = String((await s.getPlatform()) || "");
  if (!pin) throw new Error("Cookie 缺少 pt_pin");
  await saveAccount({
    account: account || decode(pin),
    password: "",
    cookie: normalizePt(cookie),
    pin,
    user: owner,
    platform,
    mode,
  });
  await syncQingLong(pin, normalizePt(cookie), owner);
  await updateNotify(pin, cookie);
  return s.reply(`${decode(pin)} 登录成功，已同步青龙`);
}

async function refreshAll(cron) {
  const all = await credentialStore.getAll(),
    rows = Object.entries(all)
      .map(([pin, raw]) => ({ pin, ...parseObject(raw) }))
      .filter((row) => row.account && row.password),
    results = [];
  for (const item of rows) {
    try {
      const valid = await jdCookieValid(item.cookie);
      if (valid) {
        results.push(`✅ ${decode(item.pin)} 有效`);
        continue;
      }
      const result = await loginByMode(item.account, item.password);
      if (!result.cookie) throw new Error(result.message || "未取得Cookie");
      item.cookie = normalizePt(result.cookie);
      await saveAccount(item);
      await syncQingLong(item.pin, item.cookie, item.user);
      await failureStore.delete(item.account);
      results.push(`✅ ${decode(item.pin)} 续期成功`);
    } catch (error) {
      const count = Number(await failureStore.get(item.account, "0")) + 1;
      await failureStore.set(item.account, String(count));
      results.push(`❌ ${decode(item.pin)} ${cleanError(error)} (${count}/${cfg.max_failures})`);
      if (count >= cfg.max_failures) await credentialStore.delete(item.pin);
    }
  }
  const text = `京东账密刷新：${rows.length} 个\n${results.join("\n") || "没有已保存账密"}`;
  return cron ? s.pushAdmin(text) : s.reply(text);
}

async function manage(content) {
  if (/停止/.test(content)) return s.reply("当前运行无后台阻塞任务");
  const owner = await uid(),
    list = parseArray(await accountStore.get(owner, "[]"));
  if (!list.length) return s.reply("没有已保存账号");
  await s.reply(["请选择账号", "0. 全部", ...list.map((pin, i) => `${i + 1}. ${decode(pin)}`), "q.退出"].join("\n"));
  const choice = await listen();
  if (!choice || /^q$/i.test(choice)) return;
  const selected = choice === "0" ? list : [list[Number(choice) - 1]].filter(Boolean);
  if (/重置/.test(content)) {
    for (const pin of selected) {
      const item = parseObject(await credentialStore.get(pin, "{}"));
      if (item.account) await failureStore.delete(item.account);
    }
    return s.reply(`已重置 ${selected.length} 个账号失败计数`);
  }
  for (const pin of selected) await credentialStore.delete(pin);
  await accountStore.set(owner, JSON.stringify(list.filter((pin) => !selected.includes(pin))));
  return s.reply(`已删除 ${selected.length} 个账号`);
}

async function autoQueue(content) {
  if (!cfg.auto_url) return s.reply("请先配置自动化登录队列地址");
  if (/重置/.test(content)) {
    await requestJson(`${cfg.auto_url}/clear`, { method: "POST" });
    return s.reply("自动登录队列已重置");
  }
  if (/查询/.test(content)) {
    const data = await requestJson(`${cfg.auto_url}/phone/list`);
    return s.reply(JSON.stringify(data, null, 2).slice(0, 3500));
  }
  const account = await prompt("请输入手机号或账号");
  if (!account) return;
  const password = await prompt("请输入密码");
  if (!password) return;
  const data = await requestJson(
    `${cfg.auto_url}/phone/write?phone=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}&sx=true`,
    { method: "POST" },
  );
  return s.reply(data.message || data.msg || JSON.stringify(data));
}
async function rabbitTest() {
  checkRabbit();
  const started = Date.now(),
    ping = await requestJson(`${cfg.qrabbit_url}/ping`);
  const token = await rabbitAdminToken().catch(() => "");
  return s.reply(
    `兔子检测：${Date.now() - started}ms\n服务：${ping.message || ping.msg || "正常"}\n认证：${token ? "成功" : "失败"}`,
  );
}
function socksInfo(content) {
  if (content === "socks导入") return s.reply("请在插件配置填写 BBK SOCKS5（格式由 BBK 服务决定）");
  return s.reply(`BBK SOCKS5：${cfg.bbk_socks5 ? "已配置" : "未配置"}`);
}

async function saveAccount(item) {
  const owner = String(item.user || (await uid())),
    pin = String(item.pin || pt(item.cookie, "pt_pin"));
  await credentialStore.set(pin, JSON.stringify({ ...item, pin, cookie: normalizePt(item.cookie) }));
  let list = parseArray(await accountStore.get(owner, "[]"));
  if (!list.includes(pin)) list.push(pin);
  await accountStore.set(owner, JSON.stringify(list));
  await new Bucket(`pin${String(item.platform || (await s.getPlatform()) || "").toUpperCase()}`).set(pin, owner);
}
async function syncQingLong(pin, cookie, owner) {
  const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 }),
    rows = rowsOf(await ql.getEnvs({ searchValue: cfg.env_name || "JD_COOKIE" })),
    found = rows.find(
      (row) =>
        row.name === (cfg.env_name || "JD_COOKIE") &&
        (pt(row.value, "pt_pin") === pin || String(row.remarks || "").includes(pin)),
    ),
    payload = {
      name: cfg.env_name || "JD_COOKIE",
      value: normalizePt(cookie),
      remarks: `${decode(pin)}|用户:${owner}|多协议登录`,
    };
  if (found) {
    await ql.updateEnv({ ...payload, id: found.id || found._id });
    if (ql.enableEnvs) await ql.enableEnvs([found.id || found._id]);
  } else await ql.createEnv(payload);
  return true;
}
async function updateNotify(pin, cookie) {
  const row = parseObject(await notifyStore.get(pin, "{}"));
  await notifyStore.set(
    pin,
    JSON.stringify({ ...row, ID: pin, PtKey: pt(cookie, "pt_key"), LoginedAt: new Date().toISOString() }),
  );
}
async function jdCookieValid(cookie) {
  if (!cookie) return false;
  const data = await requestJson("https://plogin.m.jd.com/cgi-bin/ml/islogin", {
    method: "POST",
    headers: {
      cookie,
      "user-agent": "Mozilla/5.0",
      referer: "https://gold.jd.com/",
      "content-type": "application/x-www-form-urlencoded",
    },
  });
  return String(data.islogin) === "1";
}
async function rabbit(path, body) {
  return requestJson(`${cfg.qrabbit_url}${path}?BotApiToken=${encodeURIComponent(cfg.qrabbit_token)}`, {
    method: "POST",
    json: body,
  });
}
async function rabbitAdminToken() {
  const data = await requestJson(`${cfg.qrabbit_url}/admin/auth`, {
    method: "POST",
    json: { BotApiToken: cfg.qrabbit_token, token: cfg.qrabbit_token },
  });
  return data.token || data.data?.token || data.access_token || cfg.qrabbit_token;
}
function checkRabbit() {
  if (!cfg.qrabbit_url || !cfg.qrabbit_token) throw new Error("请先配置 QRabbitPro 地址和 BotApiToken");
}
function encryptRabbitPassword(password, account) {
  const key = crypto
      .createHash("sha512")
      .update(`#(*():dfgjn^%&89$%#${account}#(*():dfgjn^%&89$%#`)
      .digest()
      .subarray(0, 32),
    nonce = crypto.randomBytes(12),
    plain = Buffer.concat([crypto.randomBytes(16), Buffer.from(String(password), "latin1"), crypto.randomBytes(16)]),
    cipher = crypto.createCipheriv("aes-256-gcm", key, nonce),
    encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([cipher.getAuthTag(), encrypted, nonce]).toString("base64");
}
function bbkSign(params) {
  const sorted = Object.keys(params)
      .sort()
      .map((key) => `${key}:${params[key]}`)
      .join("&"),
    ts = Date.now(),
    md5 = crypto.createHash("md5").update(`${sorted}${ts}`).digest("hex"),
    left = md5.slice(0, 20).split("").reverse().join(""),
    parts = [];
  for (let i = 0; i < left.length; i += 2)
    parts.push(
      left
        .slice(i, i + 2)
        .split("")
        .reverse()
        .join(""),
    );
  return { ...params, sign: parts.join("") + md5.slice(20), ts };
}
async function requestJson(url, options = {}) {
  const headers = { ...(options.headers || {}) },
    body = options.json === undefined ? options.body : JSON.stringify(options.json);
  if (options.json !== undefined) headers["content-type"] ||= "application/json";
  const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
      signal: AbortSignal.timeout(cfg.timeout_ms),
    }),
    text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口未返回JSON：${text.slice(0, 180)}`);
  }
}
async function prompt(text) {
  await s.reply(text + "，回复 q 退出");
  const value = await listen();
  return !value || /^q$/i.test(value) ? "" : value;
}
async function listen() {
  const child = await s.listen({ timeout: 120000 });
  return child ? String((await child.getMsg()) || "").trim() : "";
}
async function uid() {
  return String((await s.getUserId()) || "");
}
function pickCookie(value) {
  if (typeof value === "string") return value.match(/pt_key=[^;]+;pt_pin=[^;]+;/)?.[0] || "";
  for (const item of Object.values(value || {})) {
    const found = pickCookie(item);
    if (found) return found;
  }
  return "";
}
function pt(cookie, name) {
  return String(cookie || "").match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`))?.[1] || "";
}
function normalizePt(cookie) {
  return `pt_key=${pt(cookie, "pt_key")};pt_pin=${pt(cookie, "pt_pin")};`;
}
function decode(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}
function parseObject(raw) {
  try {
    return typeof raw === "object" && raw ? raw : JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}
function parseArray(raw) {
  try {
    const value = JSON.parse(String(raw || "[]"));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}
function rowsOf(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}
function trimBase(value) {
  return String(value || "")
    .trim()
    .replace(/\/$/, "");
}
function cleanError(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

main().catch((error) => s.reply(`京东多协议登录失败：${cleanError(error)}`));

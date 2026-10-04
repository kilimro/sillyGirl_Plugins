// [title: 酷我Music提现]
// [name: kuWoMusicTiXian]
// [desc: 酷我账号绑定、短信验证、立即或整点批量提现及次数充值管理]
// [author: sky2022]
// [version: v3.11.0]
// [rule: ^(酷我提现|酷我提现次数检测|酷我提现次数迁移)$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/酷我Music提现_v3.11_By.sky2022.py]
// [depe: ["./kuwoCore.js","./vortoUtils.js","undici"]]

const { sender: s, Bucket, plugin, utils } = require("sillygirl");
const kuwo = require("./kuwoCore.js"),
  vorto = require("./vortoUtils");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}

const users = new Bucket("dd_KuwoTX_bind"),
  accounts = new Bucket("dd_KuwoTX_account"),
  logins = new Bucket("dd_KuwoTX_login"),
  counts = new Bucket("dd_KuwoTX_UserCount");
const form = new plugin.Form({
  count_price: plugin.Form.number().title("每次提现价格").min(0).default(0),
  count_coin: plugin.Form.integer().title("每次提现积分").min(0).default(9999),
  qr_code: plugin.Form.string().title("收款码图片URL").default(""),
  proxy_api: plugin.Form.string().title("代理池API（可留空）").default(""),
  withdraw_delay: plugin.Form.number().title("整点后发包延迟秒").min(0).max(5).default(0),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw || "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch (_) {
    return (
      String(raw || "")
        .match(/['"]([^'"]+)['"]/g)
        ?.map((x) => x.slice(1, -1)) || []
    );
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
async function proxyDispatcher() {
  if (!cfg.proxy_api || !ProxyAgent) return;
  const response = await fetch(cfg.proxy_api, { signal: AbortSignal.timeout(cfg.timeout_ms) }),
    value = (await response.text()).trim();
  if (!value || value.includes("白名单")) throw new Error(value || "代理池返回为空");
  return new ProxyAgent(/^https?:\/\//.test(value) ? value : `http://${value}`);
}
function apiContext() {
  return {
    async requestJson(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      let body = options.body;
      if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers["content-type"] ||= "application/json";
      }
      let dispatcher;
      try {
        dispatcher = await proxyDispatcher();
      } catch (error) {
        if (cfg.proxy_api) throw error;
      }
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), cfg.timeout_ms);
      try {
        const response = await fetch(url, {
            method: options.method || "GET",
            headers,
            body,
            signal: controller.signal,
            dispatcher,
          }),
          text = await response.text();
        if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
        try {
          return JSON.parse(text);
        } catch (_) {
          throw new Error(`接口返回非JSON：${text.slice(0, 160)}`);
        }
      } finally {
        clearTimeout(timer);
        if (dispatcher?.close) await dispatcher.close().catch(() => {});
      }
    },
  };
}
async function owned(userId) {
  userId = userId ?? (await uid());
  return parseList(await users.get(userId, "[]"));
}
async function saveOwned(userId, list) {
  return list.length ? users.set(userId, JSON.stringify([...new Set(list)])) : users.delete(userId);
}
function mask(phone) {
  return String(phone).replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
}
async function load(phone) {
  const raw = await accounts.get(phone, "");
  try {
    return JSON.parse(raw);
  } catch (_) {
    const p = String(raw).split("#"),
      login = String(await logins.get(phone, "")).split("#");
    return { phone, password: login.slice(1).join("#"), session: { loginUid: p[0], loginSid: p[2], appUid: p[1] } };
  }
}
async function bind() {
  const raw = await prompt("请输入手机号#密码", 120000);
  if (raw === null || /^q$/i.test(raw)) return;
  const cut = raw.indexOf("#"),
    phone = raw.slice(0, cut).trim(),
    password = raw.slice(cut + 1);
  if (cut < 1 || !/^1[3-9]\d{9}$/.test(phone) || !password) throw new Error("格式应为11位手机号#密码");
  const ctx = apiContext(),
    session = await kuwo.login(ctx, phone, password);
  await kuwo.sendBindSms(ctx, session, phone);
  const code = await prompt(`${mask(phone)} 验证码已发送，请输入验证码`, 60000);
  if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误或输入超时");
  const result = await kuwo.withdraw(ctx, session, phone, code),
    text = result?.data?.text || result?.data?.description || result?.msg || "接口已验证";
  const valid = [
    "每日仅能提现一次",
    "今日提现次数已用完",
    "账号存在风险",
    "提现额度已用完",
    "提现次数已用完",
    "提现时间未到",
    "当前时段额度已提完",
    "当前账户金币余额不足",
    "提现成功",
    "提现申请发起成功",
  ];
  if (!valid.some((x) => String(text).includes(x))) throw new Error(`账号验证失败：${text}`);
  await accounts.set(phone, JSON.stringify({ phone, password, session, updatedAt: new Date().toISOString() }));
  await logins.set(phone, `${phone}#${password}`);
  const userId = await uid(),
    list = await owned(userId);
  if (!list.includes(phone)) list.push(phone);
  await saveOwned(userId, list);
  return s.reply(`账号 ${mask(phone)} 绑定成功；验证结果：${text}`);
}
async function select(list, verb) {
  if (!list.length) {
    await s.reply("未绑定酷我账号");
    return [];
  }
  if (list.length === 1) return list;
  const value = await prompt(
    [`请选择${verb}账号`, `[0] 全部`, ...list.map((x, i) => `[${i + 1}] ${mask(x)}`)].join("\n"),
  );
  if (value === "0") return list;
  const out = [];
  for (const p of String(value || "")
    .replace(/，/g, ",")
    .split(",")) {
    const n = Number(p);
    if (Number.isInteger(n) && n >= 1 && n <= list.length && !out.includes(list[n - 1])) out.push(list[n - 1]);
  }
  return out;
}
async function prepare(phone) {
  const item = await load(phone);
  if (!item?.password) throw new Error("缺少登录密码，请重新绑定");
  const ctx = apiContext(),
    session = await kuwo.login(ctx, phone, item.password);
  await kuwo.sendBindSms(ctx, session, phone);
  const code = await prompt(`${mask(phone)} 验证码已发送，请输入`, 60000);
  if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误或输入超时");
  item.session = session;
  item.updatedAt = new Date().toISOString();
  await accounts.set(phone, JSON.stringify(item));
  return { phone, ctx, session, code };
}
async function doWithdraw() {
  const userId = await uid(),
    available = Number(await counts.get(userId, "0")) || 0;
  if (available <= 0) return s.reply("当前可用提现次数为0，请先充值");
  const selected = await select(await owned(userId), "提现");
  if (!selected.length) return;
  const mode = await prompt("[1] 立即提现\n[2] 下一个整点批量提现", 60000);
  if (!/[12]/.test(String(mode))) return s.reply("已取消");
  const ready = [];
  for (const phone of selected) {
    try {
      ready.push(await prepare(phone));
    } catch (error) {
      await s.reply(`${mask(phone)} 准备失败：${error.message}`);
    }
  }
  if (!ready.length) return;
  if (mode === "2") {
    const now = Date.now(),
      hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    hour.setHours(hour.getHours() + 1);
    const target = hour.getTime() + Math.max(0, Math.min(5, Number(cfg.withdraw_delay) || 0)) * 1000;
    await s.reply(
      `已准备${ready.length}个账号，目标时间 ${new Date(target).toLocaleTimeString("zh-CN", { hour12: false })}`,
    );
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, target - Date.now())));
  }
  let remain = available,
    success = 0;
  const results = await Promise.all(
    ready.map(async (item) => {
      try {
        const result = await kuwo.withdraw(item.ctx, item.session, item.phone, item.code),
          text = String(result?.data?.text || result?.data?.description || result?.msg || JSON.stringify(result)),
          ok = /提现成功|提现申请发起成功/.test(text);
        if (ok) success++;
        return `${mask(item.phone)}：${text}`;
      } catch (error) {
        return `${mask(item.phone)}：${error.message}`;
      }
    }),
  );
  remain = Math.max(0, remain - success);
  await counts.set(userId, String(remain));
  return s.reply(`${results.join("\n")}\n成功${success}/${ready.length}，剩余次数${remain}`);
}
async function recharge() {
  const userId = await uid(),
    raw = await prompt("请输入充值次数", 60000),
    amount = Number(raw);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("充值次数应为正整数");
  const methods = [],
    pay = await vorto.getPayConfig();
  if (cfg.count_coin > 0) methods.push(["积分兑换", "coin"]);
  if (pay.qr_pay_switch || cfg.qr_code || pay.zsm) methods.push(["扫码支付", "qr"]);
  if (pay.ma_pay_switch) for (const [key, name] of Object.entries(pay.pay_types)) methods.push([name, `ma:${key}`]);
  if (!methods.length && Number(cfg.count_price) === 0) return addCount(userId, amount);
  const pick =
    methods.length === 1
      ? methods[0]
      : methods[Number(await prompt(methods.map((x, i) => `[${i + 1}] ${x[0]}`).join("\n"))) - 1];
  if (!pick) throw new Error("未选择支付方式");
  if (pick[1] === "coin") {
    const balance = await vorto.getUserPoints(userId),
      need = amount * cfg.count_coin;
    if (balance < need) throw new Error(`积分不足：当前${balance}，需要${need}`);
    if (!(await vorto.updateUserPoints(userId, balance - need))) throw new Error("积分扣除失败");
    await addCount(userId, amount);
    return s.reply(`充值${amount}次成功，扣除${need}积分，剩余${balance - need}积分`);
  }
  const money = Math.round(amount * Number(cfg.count_price) * 100) / 100;
  if (pick[1] === "qr") {
    const image = cfg.qr_code || pay.zsm;
    if (!image) throw new Error("收款码未配置");
    await s.reply(utils.image(image));
    const paid = await vorto.waitPaymentEvent(s, money, 300000);
    if (!paid.paid) throw new Error(paid.cancelled ? "支付已取消" : "未检测到足额支付");
    await addCount(userId, amount);
    return s.reply(`充值${amount}次成功`);
  }
  const client = new vorto.MaPayClient(),
    orderNo = `KWTX${Date.now()}${userId}`,
    order = await client.createOrder(money, pick[1].slice(3), orderNo, `酷我提现次数-${amount}`, userId);
  if (order.error) throw new Error(order.error);
  await s.reply(utils.image(await vorto.generateQrcodeUrl(order.pay_url)));
  for (let i = 0; i < 60; i++) {
    const child = await s.listen({ timeout: 5000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || ""))) throw new Error("支付已取消");
    if (await client.isPaid(orderNo)) {
      await addCount(userId, amount);
      return s.reply(`充值${amount}次成功`);
    }
  }
  throw new Error("支付超时");
}
async function addCount(userId, n) {
  const next = (Number(await counts.get(userId, "0")) || 0) + n;
  await counts.set(userId, String(next));
  return next;
}
async function removeAccount() {
  const userId = await uid(),
    list = await owned(userId),
    selected = await select(list, "删除");
  if (!selected.length) return;
  for (const phone of selected) {
    await accounts.delete(phone);
    await logins.delete(phone);
  }
  await saveOwned(
    userId,
    list.filter((x) => !selected.includes(x)),
  );
  return s.reply(`已删除${selected.length}个账号`);
}
async function migrate() {
  if (!(await s.isAdmin())) return s.reply("只有管理员可迁移");
  const rows = [];
  for (const userId of await users.keys()) {
    const list = await owned(userId);
    let moved = 0;
    for (const phone of list) {
      const n = Number(await counts.get(phone, "0")) || 0;
      if (n > 0) {
        moved += n;
        await counts.delete(phone);
      }
    }
    if (moved) {
      const next = await addCount(userId, moved);
      rows.push(`${userId}：迁移${moved}次，现有${next}次`);
    }
  }
  return s.reply(rows.length ? rows.join("\n") : "没有需要迁移的次数");
}
async function checkCounts() {
  let zero = 0,
    total = 0;
  for (const userId of await users.keys()) {
    total++;
    const n = Number(await counts.get(userId, "0")) || 0;
    if (n <= 0) zero++;
  }
  const text = `酷我提现次数检测：用户${total}个，次数不足${zero}个`;
  return typeof s.pushAdmin === "function" ? s.pushAdmin(text) : s.reply(text);
}
async function menu() {
  const userId = await uid(),
    list = await owned(userId),
    count = Number(await counts.get(userId, "0")) || 0,
    choice = await prompt(
      `=====酷我提现=====\n账号${list.length}个，可用次数${count}\n[1] 提交账号\n[2] 充值次数\n[3] 删除账号\n[4] 账号提现\n[q] 退出`,
      120000,
    );
  if (choice === "1") return bind();
  if (choice === "2") return recharge();
  if (choice === "3") return removeAccount();
  if (choice === "4") return doWithdraw();
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    const content = String((await s.getMsg()) || "").trim();
    if (content === "酷我提现次数迁移") return migrate();
    if (content === "酷我提现次数检测" || !content) return checkCounts();
    return menu();
  } catch (error) {
    return s.reply(`酷我Music提现执行失败：${error?.message || error}`);
  }
}
main();

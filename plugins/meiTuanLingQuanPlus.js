// [title: 美团领券PLUS]
// [name: meiTuanLingQuanPlus]
// [desc: 美团三类券包领取、店铺刷白、积分充值及管理员加扣分]
// [author: yuhualhh]
// [version: v2.1.9]
// [rule: ^(美团领券|美团领劵|美团领卷|美团领卷余额查询|美团刷白|美团充分|美团查分|美团加分|美团减分|释放支付锁|释放锁)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 60]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/美团领券PLUS_v2.1.9_By.yuhualhh.py;backup/美团领卷_v1.4.4_By.sky2022.py]
// [depe: ["./vortoUtils.js"]]

const { sender: s, Bucket, plugin, utils } = require("sillygirl"),
  vorto = require("./vortoUtils"),
  points = new Bucket("yuhua_meituan_points"),
  locks = new Bucket("yuhua_meituan_payment_locks");
const form = new plugin.Form({
  api_key: plugin.Form.string().title("领券API秘钥").default(""),
  api_url: plugin.Form.string().title("API地址").default("http://api.oroe.cn"),
  prices: plugin.Form.string().title("三项目积分价格，用|分隔，-1关闭").default("88|88|88"),
  exchange_rate: plugin.Form.number().title("充值1元兑换积分").min(0.01).default(1),
  qr_code: plugin.Form.string().title("收款码图片URL").default(""),
  payment_lock_timeout: plugin.Form.integer().title("支付锁超时秒").min(30).max(3600).default(300),
  min_recharge: plugin.Form.number().title("最低充值金额").min(0.01).default(0.01),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(35000),
});
let cfg = {};
async function uid() {
  return String((await s.getUserId()) || "");
}
async function prompt(text, t = 60000) {
  await s.reply(text);
  const child = await s.listen({ timeout: t });
  return child ? String((await child.getMsg()) || "").trim() : null;
}
async function balance(id) {
  const n = Number(await points.get(String(id), "0"));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
async function setBalance(id, n) {
  return points.set(String(id), String(Math.round(Number(n) * 100) / 100));
}
async function req(url, opt = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), opt.timeout || cfg.timeout_ms);
    try {
      const headers = { ...(opt.headers || {}) };
      let body;
      if (opt.json !== undefined) {
        body = JSON.stringify(opt.json);
        headers["content-type"] = "application/json";
      } else if (opt.form !== undefined) {
        body = new URLSearchParams(opt.form).toString();
        headers["content-type"] = "application/x-www-form-urlencoded";
      }
      const r = await fetch(url, { method: opt.method || "GET", headers, body, signal: c.signal }),
        text = await r.text();
      if (r.status === 402) return { code: -1, msg: "API秘钥余额不足", balance_error: true };
      if (r.status === 404 || text.includes("404 Not Found")) return { code: -1, msg: "请求资源不存在" };
      if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error(`接口返回非JSON：${text.slice(0, 160)}`);
      }
    } catch (error) {
      last = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
function pricesConfig() {
  const raw = String(cfg.prices || "").split("|"),
    out = [];
  for (let i = 0; i < 3; i++) {
    const n = Number(raw[i]);
    out.push(Number.isFinite(n) ? n : 88);
  }
  return out;
}
function api(path) {
  return `${String(cfg.api_url || "http://api.oroe.cn").replace(/\/$/, "")}${path}`;
}
async function callCoupon(cookie, type) {
  const endpoint = { 1: "meituanvc", 2: "meituan259", 3: "meituanza" }[type] || "meituanza",
    payload = { apikey: cfg.api_key, MeiTuanCookie: cookie };
  let r = await req(api(`/API/${endpoint}.php`), { method: "POST", json: payload });
  if (r?.code === undefined) r = await req(api(`/API/${endpoint}.php`), { method: "POST", form: payload });
  return r;
}
async function coupon() {
  if (!cfg.api_key) throw new Error("未配置API秘钥");
  const names = ["美团大众无门槛", "美团综合类券包", "美团早中晚神券"],
    all = pricesConfig(),
    available = all.map((price, i) => ({ price, name: names[i], type: i + 1 })).filter((x) => x.price !== -1),
    n = Number(
      await prompt(
        [
          "=====领券项目=====",
          ...available.map((x, i) => `[${i + 1}] ${x.name}｜${x.price === 0 ? "免费" : `${x.price}积分`}`),
        ].join("\n"),
      ),
    ),
    item = available[n - 1];
  if (!item) throw new Error("项目选择无效");
  const raw = await prompt("请输入带token的美团账号链接或Token", 120000);
  if (!raw || !String(raw).toLowerCase().includes("token")) throw new Error("美团账号链接不正确");
  const userId = await uid(),
    old = await balance(userId);
  if (old < item.price) throw new Error(`积分不足：当前${old}，需要${item.price}`);
  if (item.price > 0 && String(await prompt(`${item.name}消耗${item.price}积分，回复“确认”继续`)) !== "确认")
    return s.reply("已取消");
  if (item.price > 0) await setBalance(userId, old - item.price);
  try {
    const result = await callCoupon(raw, item.type),
      msg = String(result?.msg || "");
    if (Number(result?.code) !== 0 || msg.includes("领到其他券") || msg.includes("请勿请求不相关")) {
      if (item.price > 0) await setBalance(userId, old);
      throw new Error(
        `${result?.balance_error ? "API秘钥余额不足" : msg || "领券失败"}${item.price > 0 ? `，已退还${item.price}积分` : ""}`,
      );
    }
    const info = Array.isArray(result.info) ? result.info : [];
    return s.reply(info.length ? `领券成功\n${info.map((x) => `🎁 ${x}`).join("\n")}` : "优惠券领取成功");
  } catch (error) {
    if (item.price > 0 && (await balance(userId)) !== old) await setBalance(userId, old);
    throw error;
  }
}
async function whitelist() {
  if (!cfg.api_key) throw new Error("未配置API秘钥");
  const raw = await prompt("请输入包含 http://dpurl.cn/ 的店铺链接"),
    link = String(raw || "").match(/http:\/\/dpurl\.cn\/[A-Za-z0-9]+/)?.[0];
  if (!link) throw new Error("店铺链接无效");
  const result = await req(api("/API/whitelist.php"), { method: "POST", form: { apikey: cfg.api_key, url: link } });
  if (Number(result?.code) !== 0) throw new Error(result?.msg || "刷白失败");
  return s.reply("刷白执行完成；打开原链退登后再获取新链领券");
}
async function acquireLock(userId) {
  const raw = await locks.get("global", "");
  try {
    const x = JSON.parse(raw);
    if (Date.now() - Number(x.time) < Number(cfg.payment_lock_timeout) * 1000 && x.userId !== userId)
      throw new Error("当前有其他用户正在支付，请稍后");
  } catch (error) {
    if (error.message.includes("其他用户")) throw error;
  }
  await locks.set("global", JSON.stringify({ userId, time: Date.now() }));
}
async function release() {
  const raw = await locks.get("global", "");
  if (await s.isAdmin()) {
    await locks.delete("global");
    return s.reply("支付锁已释放");
  }
  try {
    const x = JSON.parse(raw);
    if (x.userId === (await uid()) || Date.now() - x.time > Number(cfg.payment_lock_timeout) * 1000) {
      await locks.delete("global");
      return s.reply("支付锁已释放");
    }
  } catch (_) {}
  return s.reply("当前支付锁不属于你");
}
async function recharge() {
  const userId = await uid();
  await acquireLock(userId);
  try {
    const money = Number(await prompt(`请输入充值金额，最低${cfg.min_recharge}元`));
    if (!Number.isFinite(money) || money < Number(cfg.min_recharge)) throw new Error("充值金额无效");
    const pay = await vorto.getPayConfig(),
      methods = [];
    if (pay.qr_pay_switch || cfg.qr_code || pay.zsm) methods.push(["扫码支付", "qr"]);
    if (pay.ma_pay_switch) for (const [k, n] of Object.entries(pay.pay_types)) methods.push([n, `ma:${k}`]);
    const method =
      methods.length === 1
        ? methods[0]
        : methods[Number(await prompt(methods.map((x, i) => `[${i + 1}] ${x[0]}`).join("\n"))) - 1];
    if (!method) throw new Error("未配置支付方式");
    if (method[1] === "qr") {
      const image = cfg.qr_code || pay.zsm;
      if (!image) throw new Error("未配置收款码");
      await s.reply(utils.image(image));
      const paid = await vorto.waitPaymentEvent(s, money, 300000);
      if (!paid.paid) throw new Error(paid.cancelled ? "支付已取消" : "支付超时或金额不足");
    } else {
      const client = new vorto.MaPayClient(),
        orderNo = `MTCP${Date.now()}${userId}`,
        order = await client.createOrder(money, method[1].slice(3), orderNo, "美团领券积分充值", userId);
      if (order.error) throw new Error(order.error);
      await s.reply(utils.image(await vorto.generateQrcodeUrl(order.pay_url)));
      let ok = false;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        if (await client.isPaid(orderNo)) {
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error("支付超时");
    }
    const add = Math.round(money * Number(cfg.exchange_rate) * 100) / 100,
      next = Math.round(((await balance(userId)) + add) * 100) / 100;
    await setBalance(userId, next);
    return s.reply(`充值成功：${money}元 → ${add}积分，当前${next}积分`);
  } finally {
    await locks.delete("global");
  }
}
async function query() {
  const id = await uid();
  return s.reply(`美团领券积分：${await balance(id)}`);
}
async function adminAdjust(sign) {
  if (!(await s.isAdmin())) throw new Error("此命令仅限管理员");
  const target = await prompt("请输入目标用户ID"),
    amount = Number(await prompt(`请输入${sign > 0 ? "增加" : "扣除"}积分`));
  if (!target || !Number.isFinite(amount) || amount <= 0) throw new Error("用户或积分无效");
  const old = await balance(target),
    next = Math.max(0, Math.round((old + sign * amount) * 100) / 100);
  await setBalance(target, next);
  return s.reply(`${sign > 0 ? "加分" : "减分"}成功：${target}，当前${next}`);
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 35000);
    const c = String((await s.getMsg()) || "").trim();
    if (/^(美团领券|美团领劵|美团领卷)$/.test(c)) return coupon();
    if (c === "美团刷白") return whitelist();
    if (c === "美团充分") return recharge();
    if (/美团查分|美团领卷余额查询/.test(c)) return query();
    if (c === "美团加分") return adminAdjust(1);
    if (c === "美团减分") return adminAdjust(-1);
    if (/释放/.test(c)) return release();
    return s.resume();
  } catch (error) {
    return s.reply(`美团领券PLUS执行失败：${error?.message || error}`);
  }
}
main();

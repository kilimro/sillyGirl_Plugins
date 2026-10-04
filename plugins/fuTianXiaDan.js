// [title: 福田下单]
// [name: fuTianXiaDan]
// [desc: 福田账号批量登录、商品搜索、地址创建、积分下单及订单物流查询]
// [author: rujingxianghai]
// [version: v1.0.0]
// [rule: ^(福田下单|福田物流查询)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/福田下单_v1.0_By.rujingxianghai.py]
// [depe: []]

const { sender: s, plugin, utils } = require("sillygirl"),
  BASE = "http://wap.365autogo.com/mobile/api";
const form = new plugin.Form({
  city_id: plugin.Form.string().title("城市ID").default("622"),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(30000),
});
let cfg = {};
async function prompt(text, t = 60000) {
  await s.reply(text);
  const child = await s.listen({ timeout: t });
  return child ? String((await child.getMsg()) || "").trim() : null;
}
function paramUrl(path, param) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("param", JSON.stringify(param));
  return url.href;
}
class Bot {
  constructor() {
    this.phone = "";
    this.shipping = {};
    this.headers = {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 11; V1986A Build/RP1A.200720.012; wv) AppleWebKit/537.36 Chrome/83 Mobile Safari/537.36",
      accept: "application/json, text/plain, */*",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      language: "zh-CN",
      cityId: String(cfg.city_id || "622"),
      osVersion: "11",
      unique: `android-${Math.random().toString(16).slice(2, 18)}`,
      channel: "channel_1",
      os: "android",
      appkey: "ef1fc57c13007e33",
      appVersion: "4.9.0",
      "x-requested-with": "com.foton.suichexing.mobile",
    };
  }
  async req(path, opt = {}) {
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), cfg.timeout_ms);
    try {
      const headers = { ...this.headers, ...(opt.headers || {}) },
        body = opt.form ? new URLSearchParams({ param: JSON.stringify(opt.form) }).toString() : undefined,
        r = await fetch(opt.url || `${BASE}${path}`, { method: opt.method || "GET", headers, body, signal: c.signal }),
        text = await r.text();
      if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error(`接口返回非JSON：${text.slice(0, 160)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  async login(phone, password) {
    this.phone = phone;
    const r = await this.req("/user/login", { method: "POST", form: { loginName: phone, password } });
    if (Number(r.stateCode) !== 0) throw new Error(r.message || "登录失败");
    this.headers.userId = String(r.data?.id || "");
    this.headers.userSession = r.data?.userSession || "";
    if (!this.headers.userSession) throw new Error("登录响应缺少userSession");
    return true;
  }
  async search(word) {
    return this.req("", { url: paramUrl("/product/search", { searchWord: word, sort: 0, page: 1, pageCount: 15 }) });
  }
  async cart() {
    return this.req("/cart/show");
  }
  async clearCart() {
    const c = await this.cart(),
      items = [];
    for (const b of c.data?.baskets || [])
      for (const i of b.items || []) items.push({ basketItemId: i.id, basketId: b.id });
    if (items.length) await this.req("/cart/removeGoods", { method: "POST", form: items });
  }
  async addCart(goodsId, number) {
    await this.clearCart();
    const r = await this.req("/cart/addGoods", { method: "POST", form: [{ goodsId, number, type: 1 }] });
    if (Number(r.stateCode) !== 0) throw new Error(r.message || "添加购物车失败");
  }
  async clearAddresses() {
    const r = await this.req("/user/consignees");
    for (const x of r.data || []) if (x.id) await this.deleteAddress(x.id);
  }
  async regions(id = 0) {
    const r = await this.req("", { url: paramUrl("/region/findChild", { id }) });
    if (Number(r.stateCode) !== 0) throw new Error(r.message || "地区查询失败");
    return r.data || [];
  }
  async chooseRegion() {
    let id = 0;
    for (const label of ["省份/直辖市", "城市/地区", "区/县", "街道/乡镇"]) {
      const rows = await this.regions(id);
      if (!rows.length) return id;
      const n = Number(await prompt([`请选择${label}`, ...rows.map((x, i) => `[${i + 1}] ${x.name}`)].join("\n"))),
        item = rows[n - 1];
      if (!item) throw new Error(`${label}选择无效`);
      id = item.id;
    }
    return id;
  }
  async createAddress() {
    const r = await this.req("/user/addConsignees", {
      method: "POST",
      form: {
        alias: this.shipping.alias || this.shipping.name,
        address: this.shipping.address,
        mobile: this.shipping.mobile,
        name: this.shipping.name,
        defaulted: false,
        regionId: this.shipping.regionId,
        type: 0,
      },
    });
    if (Number(r.stateCode) !== 0 || !r.data?.id) throw new Error(r.message || "创建地址失败");
    this.shipping.id = r.data.id;
    return r.data.id;
  }
  async deleteAddress(id) {
    return this.req("/user/consignees/del", { method: "POST", form: { id } }).catch(() => {});
  }
  async cartToken() {
    const r = await this.req("/asyncCheckout/show");
    if (Number(r.stateCode) !== 0 || !r.data?.cartToken) throw new Error(r.message || "获取cartToken失败");
    return r.data.cartToken;
  }
  async pointVerify(point, addressId) {
    if (point <= 4000) return;
    const image = await this.req("", {
        url: paramUrl("/global/createImageVerifyCode", { type: "VERIFYCODE_IMAGE_USEPOINT" }),
      }),
      base64 = image.data?.base64;
    if (Number(image.stateCode) !== 0 || !base64) throw new Error("获取图形验证码失败");
    await s.reply(utils.image(`base64://${String(base64).replace(/^data:image\/\w+;base64,/, "")}`));
    const img = await prompt(`${this.phone} 请输入图形验证码`),
      sms = await this.req("/asyncCheckout/sendLoginNameSMS", {
        method: "POST",
        form: { loginName: this.phone, imgVerifyCode: img },
      });
    if (Number(sms.stateCode) !== 0) throw new Error(sms.message || "发送短信失败");
    const code = await prompt(`${this.phone} 请输入短信验证码`),
      checked = await this.req("", {
        url: paramUrl("/asyncCheckout/checkPoint", { loginName: this.phone, verifyCode: code }),
      });
    if (Number(checked.stateCode) !== 0) throw new Error(checked.message || "短信验证失败");
    const update = await this.checkoutPayload(addressId, point, true);
    if (Number(update.stateCode) !== 0) throw new Error(update.message || "更新购物车失败");
  }
  async checkoutPayload(addressId, point, update = false) {
    const payload = {
      consigneeId: addressId,
      coupons: [{ basketId: 1, couponIds: [] }],
      deliveryModeId: update ? -1 : 290000003,
      paymentModeType: 2,
      remarks: [],
      payableAmount: "0.00",
      invoice: { status: 0, type: 0 },
      cartToken: await this.cartToken(),
      pointPayment: point,
      balance: "",
      enterpriseCode: "",
      loginName: "",
      regionId: this.shipping.regionId || 1355,
    };
    if (!update) payload.isPresell = false;
    return this.req(update ? "/asyncCheckout/update" : "/asyncCheckout/createOrder", { method: "POST", form: payload });
  }
  async order(addressId, point) {
    await this.pointVerify(Number(point), addressId);
    return this.checkoutPayload(addressId, Number(point), false);
  }
  async orders(status) {
    return this.req("", { url: paramUrl("/order/list", { status: String(status), page: 1, pageCount: 15 }) });
  }
  async logistics(id) {
    return this.req("", { url: paramUrl("/order/packages", { orderId: String(id) }) });
  }
}
function parseAccounts(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((x) => {
      const i = x.indexOf("#");
      return i > 0 ? { phone: x.slice(0, i).trim(), password: x.slice(i + 1).trim() } : null;
    })
    .filter((x) => x?.phone && x.password);
}
async function loginBots(multi = true) {
  const raw = await prompt(multi ? "请输入手机号#密码，多账号换行" : "请输入手机号#密码", 120000),
    rows = parseAccounts(raw);
  if (!rows.length) throw new Error("未识别到有效账号");
  const out = [];
  for (const x of rows) {
    try {
      const b = new Bot();
      await b.login(x.phone, x.password);
      out.push(b);
      await s.reply(`${x.phone} 登录成功`);
    } catch (error) {
      await s.reply(`${x.phone} 登录失败：${error.message}`);
    }
  }
  if (!out.length) throw new Error("没有账号登录成功");
  return out;
}
function productRows(r) {
  return r.data?.items || [];
}
async function orderFlow() {
  const bots = await loginBots(true);
  for (const b of bots) {
    await b.clearAddresses();
    await b.clearCart();
  }
  const name = await prompt("请输入收货人姓名"),
    mobile = await prompt("请输入收货手机号");
  if (!name || !/^1\d{10}$/.test(String(mobile))) throw new Error("收货信息无效");
  const regionId = await bots[0].chooseRegion(),
    detail = await prompt("请输入详细地址（街道门牌号等）");
  if (!detail) throw new Error("详细地址为空");
  for (const b of bots) b.shipping = { name, mobile, address: detail, regionId, alias: name };
  const word = await prompt("请输入要搜索的商品名称"),
    result = await bots[0].search(word),
    items = productRows(result);
  if (Number(result.stateCode) !== 0 || !items.length) throw new Error(result.message || "未找到商品");
  const n = Number(
      await prompt(
        [
          `共${result.data?.total || items.length}个商品`,
          ...items.map(
            (x, i) =>
              `[${i + 1}] ${x.name}｜${x.goods?.point || 0}积分｜¥${x.goods?.price || 0}｜库存${x.goods?.availableStock || 0}｜${x.sellable ? "可买" : "不可买"}`,
          ),
        ].join("\n"),
      ),
    ),
    item = items[n - 1],
    goods = item?.goods;
  if (!item || !item.sellable || Number(goods?.availableStock) <= 0) throw new Error("商品选择无效或不可购买");
  if (
    !/^(y|yes|是)$/i.test(
      String(await prompt(`确认下单：${item.name}，${goods.point}积分，数量${goods.minPurchaseNum || 1}？回复y`)),
    )
  )
    return s.reply("已取消");
  let ok = 0;
  const lines = [];
  for (const b of bots) {
    let addressId;
    try {
      await b.addCart(goods.id, goods.minPurchaseNum || 1);
      addressId = await b.createAddress();
      const r = await b.order(addressId, goods.point);
      if (Number(r.stateCode) !== 0) throw new Error(r.message || "下单失败");
      ok++;
      lines.push(`${b.phone}：下单成功，订单号${r.data?.orderNumber || r.data?.orderNo || "未知"}`);
    } catch (error) {
      lines.push(`${b.phone}：${error.message}`);
    } finally {
      if (addressId) await b.deleteAddress(addressId);
    }
  }
  return s.reply(`${lines.join("\n")}\n批量完成：成功${ok}，失败${bots.length - ok}`);
}
function formatOrder(x, i) {
  const products = (x.productList || []).map((p) => p.name).join(" | ") || "无商品信息";
  return `[${i + 1}] ${x.orderNumber || "未知订单"}\n${x.createTime || ""}｜${products}\n¥${x.payableAmount || 0}｜${x.merchantName || ""}｜${x.orderStatusName || x.statusName || x.orderStatus || ""}`;
}
function formatLogistics(rows) {
  return (
    (rows || [])
      .map((p, i) => {
        const e = p.express || {},
          products = (p.productList || []).map((x) => `${x.name}×${x.count || 1}`).join("、");
        return `包裹${i + 1}：${e.name || "未知快递"} ${e.number || "无单号"}\n${p.logistics || "无物流状态"}｜${Number(p.sign) === 1 ? "已签收" : "未签收"}${products ? `\n${products}` : ""}`;
      })
      .join("\n---\n") || "暂无物流信息"
  );
}
async function logisticsFlow() {
  const [bot] = await loginBots(false),
    choice = await prompt("[1]全部订单 [2]待收货 [3]已完成"),
    status = choice === "2" ? "4" : choice === "3" ? "5" : "0",
    r = await bot.orders(status),
    items = r.data?.items || [];
  if (Number(r.stateCode) !== 0 || !items.length) throw new Error(r.message || "暂无订单");
  const n = Number(await prompt(items.map(formatOrder).join("\n----------------\n"))),
    item = items[n - 1];
  if (!item) throw new Error("订单选择无效");
  const detail = await bot.logistics(item.id);
  if (Number(detail.stateCode) !== 0) throw new Error(detail.message || "物流查询失败");
  return s.reply(formatLogistics(detail.data));
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 30000);
    const c = String((await s.getMsg()) || "").trim();
    return c === "福田物流查询" ? logisticsFlow() : orderFlow();
  } catch (error) {
    return s.reply(`福田执行失败：${error?.message || error}`);
  }
}
main();

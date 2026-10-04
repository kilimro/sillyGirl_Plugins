// [title: 顺丰抢兑]
// [name: shunFengQiangDui]
// [desc: 顺丰积分商城、积分秒杀、会员日免单券及周三6折券定时抢兑]
// [author: 1934103887]
// [version: v7.9.0]
// [rule: ^(顺丰抢兑|运行抢兑|清理抢兑|顺丰取消抢兑)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999999]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/顺丰抢兑_v7.9.0_By.1934103887.py]
// [depe: ["undici"]]

const { sender: s, Bucket, plugin } = require("sillygirl"),
  crypto = require("node:crypto");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}
const BASE = "https://mcs-mimp-web.sf-express.com",
  TOKEN = "wwesldfs29aniversaryvdld29",
  SYS = "MCS-MIMP-CORE",
  queue = new Bucket("Joh_sf_Items"),
  links = new Bucket("Joh_sf"),
  addresses = new Bucket("Joh_sf_dz");
const form = new plugin.Form({
  times: plugin.Form.string().title("抢兑时间").default("09:00:00,10:00:00,12:00:00,14:00:00,15:00:00,18:00:00"),
  proxy: plugin.Form.string().title("固定代理或代理API").default(""),
  free_coupon: plugin.Form.boolean().title("会员日免单券").default(true),
  goods: plugin.Form.boolean().title("积分商城实物").default(true),
  seckill: plugin.Form.boolean().title("积分秒杀").default(true),
  weekly60: plugin.Form.boolean().title("周三6折券").default(true),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
const buckets = {
  ddUser: new Bucket("dd_sf_user"),
  yuhuaUser: new Bucket("yuhua_sf_user"),
  yzUser: new Bucket("Yzyxmm_sf_bind"),
  ddToken: new Bucket("dd_sf_token"),
  yuhuaToken: new Bucket("yuhua_sf_token"),
  yzToken: new Bucket("Yzyxmm_sf_account"),
  ddAuth: new Bucket("dd_sf_auth"),
  yuhuaAuth: new Bucket("yuhua_sf_auth"),
  yzAuth: new Bucket("Yzyxmm_sf_Vip"),
  chuanPhone: new Bucket("chuan_sf_phone"),
  chuanToken: new Bucket("chuan_sf_accountId"),
  chuanAuth: new Bucket("chuan_sf_AuthorizationTime"),
  chuanWx: new Bucket("chuan_sfWX"),
  chuanQq: new Bucket("chuan_sfQQ"),
  chuanTg: new Bucket("chuan_sfTG"),
};
function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw || "[]").replace(/'/g, '"'));
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch (_) {
    return raw ? [String(raw)] : [];
  }
}
function phoneLike(v) {
  return /^1\d{10}$|^1\d{2}\*{4}\d{4}$/.test(String(v));
}
function mask(v) {
  return String(v).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}
function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && String(v) >= new Date().toISOString().slice(0, 10);
}
async function prompt(text, t = 120000) {
  await s.reply(text);
  const child = await s.listen({ timeout: t });
  return child ? String((await child.getMsg()) || "").trim() : null;
}
async function accountPhone(key) {
  return phoneLike(key) ? mask(key) : String(await buckets.chuanPhone.get(key, key));
}
async function accountLink(key) {
  if (phoneLike(key))
    return String(
      (await buckets.yzToken.get(key, "")) ||
        (await buckets.ddToken.get(key, "")) ||
        (await buckets.yuhuaToken.get(key, "")) ||
        "",
    );
  return String((await buckets.chuanToken.get(key, "")) || "");
}
async function authorized(key) {
  if (phoneLike(key))
    return (
      validDate(await buckets.yzAuth.get(key, "")) ||
      validDate(await buckets.ddAuth.get(key, "")) ||
      validDate(await buckets.yuhuaAuth.get(key, ""))
    );
  return validDate(await buckets.chuanAuth.get(key, ""));
}
async function userAccounts() {
  const id = String((await s.getUserId()) || ""),
    out = [];
  for (const b of [buckets.ddUser, buckets.yuhuaUser, buckets.yzUser]) out.push(...parseList(await b.get(id, "")));
  const platform = String((await s.getPlatform()) || ""),
    ch = platform === "wx" ? buckets.chuanWx : platform === "tg" ? buckets.chuanTg : buckets.chuanQq;
  for (const key of await ch.keys()) if (String(await ch.get(key, "")) === id) out.push(key);
  return [...new Set(out)];
}
async function proxyDispatcher() {
  if (!cfg.proxy || !ProxyAgent) return;
  let raw = cfg.proxy;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!(u.port && (!u.pathname || u.pathname === "/"))) {
      const r = await fetch(raw, { signal: AbortSignal.timeout(10000) });
      raw = (await r.text()).trim();
    }
  } catch (_) {
    const r = await fetch(raw, { signal: AbortSignal.timeout(10000) });
    raw = (await r.text()).trim();
  }
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `http://${raw}`;
  return new ProxyAgent(raw);
}
class Session {
  constructor() {
    this.jar = new Map();
    this.dispatcher = null;
  }
  cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(h) {
    let rows = typeof h.getSetCookie === "function" ? h.getSetCookie() : [h.get("set-cookie")].filter(Boolean);
    for (const row of rows) {
      const x = String(row).split(";", 1)[0],
        i = x.indexOf("=");
      if (i > 0) this.jar.set(x.slice(0, i), x.slice(i + 1));
    }
  }
  async request(url, opt = {}, redirect = 0) {
    if (!this.dispatcher) this.dispatcher = await proxyDispatcher();
    const headers = { ...baseHeaders(), ...(opt.headers || {}) };
    if (this.cookie()) headers.cookie = this.cookie();
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), cfg.timeout_ms);
    try {
      const r = await fetch(url, {
        method: opt.method || "GET",
        headers,
        body: opt.json !== undefined ? JSON.stringify(opt.json) : opt.body,
        redirect: "manual",
        signal: c.signal,
        dispatcher: this.dispatcher,
      });
      this.absorb(r.headers);
      if (r.status >= 300 && r.status < 400 && r.headers.get("location") && redirect < 8)
        return this.request(new URL(r.headers.get("location"), url).href, {}, redirect + 1);
      const text = await r.text();
      if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
      return { text, data };
    } finally {
      clearTimeout(timer);
    }
  }
  async login(url) {
    await this.request(decodeURIComponent(url));
    if (!this.jar.get("sessionId") && !this.jar.get("SESSIONID") && !this.jar.get("sessionid"))
      throw new Error("登录链接未取得sessionId");
    return this.jar.get("_login_mobile_") || "未知";
  }
  async api(path, json = {}, extra = {}) {
    const ts = String(Date.now()),
      signature = crypto.createHash("md5").update(`token=${TOKEN}&timestamp=${ts}&sysCode=${SYS}`).digest("hex"),
      r = await this.request(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json;charset=UTF-8", sysCode: SYS, timestamp: ts, signature, ...extra },
        json,
      });
    if (!r.data) throw new Error("接口返回非JSON");
    return r.data;
  }
}
function baseHeaders() {
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/98 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20 WindowsWechat XWEB/6945",
    accept: "application/json, text/plain, */*",
    platform: "MINI_PROGRAM",
  };
}
function address(raw) {
  const p = String(raw || "")
    .replace(/，/g, ",")
    .split(",")
    .map((x) => x.trim());
  if (p.length !== 7 || !/^1\d{10}$/.test(p[5])) return null;
  return {
    province: p[0],
    city: p[1],
    distinct: p[2],
    receiveContact: p[3],
    receiveAddress: p[4],
    receivePhone: p[5],
    fullReceiveAddress: p[6],
  };
}
async function open(key) {
  const link = await accountLink(key);
  if (!link) throw new Error("未找到账号登录链接");
  const session = new Session(),
    phone = await session.login(link);
  return { session, phone, link };
}
async function points(ctx) {
  const r = await ctx.session.api(
    "/mcs-mimp/commonPost/~memberNonactivity~integralTaskStrategyService~queryPointTaskAndSignFromES",
    { channelType: "1", deviceId: crypto.randomUUID().slice(0, 18) },
  );
  if (!r.success) throw new Error(r.errorMessage || "积分查询失败");
  return Number(r.obj?.totalPoint) || 0;
}
async function goods(ctx) {
  const all = [];
  for (let pageNo = 1; pageNo < 20; pageNo++) {
    const r = await ctx.session.api("/mcs-mimp/commonPost/~memberGoods~pointMallService~goodsList", {
      pageSize: 20,
      pageNo,
      categoryCode: "brandHall",
      sortedBy: "default",
      pointRange: 0,
    });
    if (!r.success) throw new Error(r.errorMessage || "商品查询失败");
    const rows = r.obj?.pointGoodsList || [];
    if (!rows.length) break;
    all.push(...rows);
  }
  return all.filter((x) => Number(x.storeDaily) > 0 && Number(x.storeDailyReset) > 0);
}
async function seckill(ctx) {
  const out = [],
    seen = new Set();
  for (const sessionId of [6131, 6132, 6133]) {
    const r = await ctx.session.api("/mcs-mimp/commonPost/~memberGoods~pointFlashSale~getFlashSaleAcInfo", {
      sessionId,
    });
    for (const g of r.success ? r.obj?.currFlashSaleGoodsList || [] : []) {
      if (seen.has(g.flashSaleGoodsId) || g.goodsType !== "SFMD") continue;
      seen.add(g.flashSaleGoodsId);
      out.push({ ...g, acId: r.obj?.id, sessionId: g.sessionId || sessionId });
    }
  }
  return out;
}
async function memberLevel(ctx) {
  const r = await ctx.session.api("/mcs-mimp/commonPost/~memberIntegral~userInfoService~personalInfoNew", {
    sysCode: "ESG-CEMP-CORE",
    optionalColumns: ["levelName"],
    token: "zeTLTYeG0bLetfRk",
  });
  if (!r.success) throw new Error(r.errorMessage || "会员等级查询失败");
  return { level: Number(r.obj?.memberLevel) || 0, name: r.obj?.levelName || "" };
}
async function chooseAccounts(rows) {
  const active = [];
  for (const key of rows) if (await authorized(key)) active.push(key);
  if (!active.length) throw new Error("所选账号均未授权或授权已过期");
  if (active.length === 1) return active;
  const raw = await prompt(
    [
      "请选择账号，多选逗号分隔，[0]全部",
      ...(await Promise.all(active.map(async (x, i) => `[${i + 1}] ${await accountPhone(x)}`))),
    ].join("\n"),
  );
  if (raw === "0") return active;
  return String(raw || "")
    .replace(/，/g, ",")
    .split(",")
    .map(Number)
    .filter((n) => n >= 1 && n <= active.length)
    .map((n) => active[n - 1]);
}
async function ensureAddress(phone) {
  let raw = await addresses.get(phone, "");
  if (raw) {
    const keep = await prompt(`当前地址：${raw}\n回复n保留，y修改`);
    if (/^n$/i.test(String(keep))) return address(raw);
  }
  raw = await prompt("请按 省,市,区县,姓名,详细地址,手机号,完整地址 输入", 300000);
  const parsed = address(raw);
  if (!parsed) throw new Error("地址格式错误");
  await addresses.set(phone, raw);
  return parsed;
}
async function configure() {
  const selected = await chooseAccounts(await userAccounts()),
    options = [],
    map = {};
  if (cfg.free_coupon) {
    map[options.push("会员日免单券")] = 1;
  }
  if (cfg.goods) {
    map[options.push("积分商城实物")] = 2;
  }
  if (cfg.seckill) {
    map[options.push("积分秒杀")] = 3;
  }
  if (cfg.weekly60) {
    map[options.push("周三6折券")] = 4;
  }
  const biz = map[Number(await prompt(["请选择抢兑项目", ...options.map((x, i) => `[${i + 1}] ${x}`)].join("\n")))];
  if (!biz) throw new Error("项目选择无效");
  const out = [];
  for (const key of selected) {
    try {
      const phone = await accountPhone(key),
        ctx = await open(key),
        encoded = encodeURIComponent(ctx.link);
      if (biz === 1) {
        const day = new Date().getDate();
        if (day < 26 || day > 28) throw new Error("会员日免单券仅26至28日提交");
        await queue.set(phone, "free_coupon@ALL");
        await links.set(phone, encoded);
        out.push(`${phone}：已加入免单券队列`);
      } else if (biz === 2) {
        const list = await goods(ctx),
          score = await points(ctx);
        if (!list.length) throw new Error("未查到商城商品");
        const raw = await prompt(
            [
              `${phone} 积分${score}，请选择商品，多选逗号，[0]全部`,
              ...list.map((g, i) => `[${i + 1}] ${g.goodsName}｜${g.pointPrice}积分`),
            ].join("\n"),
          ),
          idx =
            raw === "0"
              ? list.map((_, i) => i)
              : String(raw || "")
                  .replace(/，/g, ",")
                  .split(",")
                  .map((x) => Number(x) - 1)
                  .filter((i) => list[i]);
        const picked = idx.map((i) => list[i]);
        if (!picked.length) throw new Error("未选择商品");
        if (picked.some((g) => Number(g.pointPrice) > score)) throw new Error("积分不足");
        await ensureAddress(phone);
        await queue.set(phone, picked.map((g) => `${g.goodsName}@${g.goodsNo}`).join("#"));
        await links.set(phone, encoded);
        out.push(`${phone}：已加入${picked.length}个实物商品`);
      } else if (biz === 3) {
        const list = await seckill(ctx);
        if (!list.length) throw new Error("未查到秒杀商品");
        const raw = await prompt(
            [
              `${phone} 请选择秒杀商品，多选逗号，[0]全部`,
              ...list.map(
                (g, i) => `[${i + 1}] ${g.goodsName}｜${g.flashSalePoint}积分｜库存${g.flashSaleCurrentStock}`,
              ),
            ].join("\n"),
          ),
          idx =
            raw === "0"
              ? list.map((_, i) => i)
              : String(raw || "")
                  .replace(/，/g, ",")
                  .split(",")
                  .map((x) => Number(x) - 1)
                  .filter((i) => list[i]),
          picked = idx.map((i) => list[i]);
        if (!picked.length) throw new Error("未选择商品");
        await ensureAddress(phone);
        await queue.set(
          phone,
          picked
            .map(
              (g) => `seckill@${g.flashSaleGoodsId}@${g.acId}@${g.sessionId}@${g.goodsName}@${g.goodsType || "SFMD"}`,
            )
            .join("#"),
        );
        await links.set(phone, encoded);
        out.push(`${phone}：已加入${picked.length}个秒杀商品`);
      } else {
        const lv = await memberLevel(ctx);
        if (lv.level < 5) throw new Error(`会员等级${lv.name}(${lv.level})，需≥5`);
        await queue.set(phone, "weekly60");
        await links.set(phone, encoded);
        out.push(`${phone}：已加入周三6折券队列`);
      }
    } catch (error) {
      out.push(`${await accountPhone(key)}：${error.message}`);
    }
  }
  return s.reply(out.join("\n"));
}
async function exchangeOne(phone) {
  const item = String(await queue.get(phone, "")),
    link = String(await links.get(phone, ""));
  if (!item || !link) return `${phone}：队列数据不完整`;
  const ctx = await openLink(link),
    addr = address(await addresses.get(phone, ""));
  let results = [];
  for (const entry of item.split("#")) {
    if (entry.startsWith("free_coupon@")) {
      let round = entry.split("@")[1],
        hour = new Date().getHours();
      if (round === "ALL") round = hour < 11 ? "09:00" : hour < 14 ? "12:00" : "15:00";
      const r = await ctx.session.api(
        "/mcs-mimp/commonPost/~memberNonactivity~memberDayFreeService~freeCouponPurchase",
        { roundTime: round },
      );
      results.push(r.success ? `免单券成功(${round})` : `免单券失败:${r.errorMessage}`);
    } else if (entry === "weekly60") {
      const info = await ctx.session.api(
        "/mcs-mimp/commonPost/~memberNonactivity~weeklySendApiService~seckillPacketInfo",
        {},
      );
      if (!info.success || !info.obj?.giftBagCode) results.push(`6折券失败:${info.errorMessage || "无礼包编码"}`);
      else {
        const r = await ctx.session.api(
          "/mcs-mimp/commonPost/~memberNonactivity~weeklySendApiService~receiveSeckillPacket",
          { giftBagCode: info.obj.giftBagCode },
        );
        results.push(r.success ? `6折券成功:${info.obj.giftBagName || ""}` : `6折券失败:${r.errorMessage}`);
      }
    } else if (entry.startsWith("seckill@")) {
      const [, gid, acId, periods, name, type] = entry.split("@");
      if (["SFIM", "SFMD"].includes(type) && !addr) {
        results.push(`${name}失败:无有效地址`);
        continue;
      }
      const payload = {
        acId: String(acId),
        channel: "MINI_PROGRAM",
        periods: String(periods),
        seckillGoodsId: Number(gid),
        secondChannel: "miaosha0822",
      };
      if (addr)
        Object.assign(payload, {
          provinceId: "",
          provinceName: addr.province,
          cityId: "",
          cityName: addr.city,
          countyId: "",
          countyName: addr.distinct,
          receiverName: addr.receiveContact,
          receiverMobile: addr.receivePhone,
          receiverAddress: addr.receiveAddress,
        });
      const r = await ctx.session.api("/mcs-mimp/commonPost/~memberGoods~pointsSeckillService~receiveGoodN", payload, {
        channel: "miaosha0822",
        referer: `${BASE}/secondKillDetail?id=${acId}`,
      });
      results.push(r.success ? `${name}秒杀成功:${r.obj?.orderNo || ""}` : `${name}秒杀失败:${r.errorMessage}`);
    } else {
      const cut = entry.lastIndexOf("@"),
        name = entry.slice(0, cut),
        goodsNo = entry.slice(cut + 1);
      if (!addr) {
        results.push(`${name}失败:无有效地址`);
        continue;
      }
      const r = await ctx.session.api("/mcs-mimp/commonPost/~memberGoods~pointMallService~createOrder", {
        from: "Point_Mall",
        orderSource: "POINT_MALL_EXCHANGE",
        goodsNo,
        quantity: 1,
        ...addr,
      });
      results.push(r.success ? `${name}兑换成功:${r.obj?.orderNo || ""}` : `${name}兑换失败:${r.errorMessage}`);
    }
  }
  if (results.some((x) => /成功/.test(x))) {
    await queue.delete(phone);
    await links.delete(phone);
  }
  return `${phone}：${results.join("；")}`;
}
async function openLink(encoded) {
  const link = decodeURIComponent(encoded),
    session = new Session(),
    phone = await session.login(link);
  return { session, phone, link };
}
async function run() {
  if (!(await s.isAdmin())) throw new Error("运行抢兑仅限管理员");
  const now = new Date(),
    targets = String(cfg.times || "")
      .split(/[,，]/)
      .map((x) => {
        const m = x.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
        if (!m) return 0;
        const d = new Date(now);
        d.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
        return d.getTime();
      })
      .filter((x) => x >= Date.now())
      .sort((a, b) => a - b);
  if (!targets.length) throw new Error("今日配置的抢兑时间均已过");
  const group = targets.filter((x) => x - targets[0] <= 600000);
  await s.reply(
    `已载入${(await queue.keys()).length}个账号，等待至${new Date(group[0]).toLocaleTimeString("zh-CN", { hour12: false })}`,
  );
  const all = [];
  for (const target of group) {
    await new Promise((r) => setTimeout(r, Math.max(0, target - Date.now())));
    all.push(
      ...(await Promise.all(
        (await queue.keys()).map((phone) => exchangeOne(phone).catch((e) => `${phone}：${e.message}`)),
      )),
    );
  }
  const text = all.join("\n") || "没有待抢账号";
  if (typeof s.pushAdmin === "function") await s.pushAdmin(text);
  return s.reply(text);
}
async function cancel() {
  const keys = await queue.keys();
  if (!keys.length) return s.reply("暂无待抢账号");
  const raw = await prompt(["请选择取消账号，[0]全部，多选逗号", ...keys.map((x, i) => `[${i + 1}] ${x}`)].join("\n")),
    picked =
      raw === "0"
        ? keys
        : String(raw || "")
            .replace(/，/g, ",")
            .split(",")
            .map((x) => keys[Number(x) - 1])
            .filter(Boolean);
  for (const key of picked) {
    await queue.delete(key);
    await links.delete(key);
  }
  return s.reply(`已取消${picked.length}个账号的抢兑`);
}
async function clear() {
  if (!(await s.isAdmin())) throw new Error("清理抢兑仅限管理员");
  for (const key of await queue.keys()) await queue.delete(key);
  for (const key of await links.keys()) await links.delete(key);
  return s.reply("抢兑队列已清空");
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    const c = String((await s.getMsg()) || "").trim();
    if (c === "顺丰抢兑") return configure();
    if (c === "运行抢兑") return run();
    if (c === "顺丰取消抢兑") return cancel();
    if (c === "清理抢兑") return clear();
  } catch (error) {
    return s.reply(`顺丰抢兑执行失败：${error?.message || error}`);
  }
}
main();

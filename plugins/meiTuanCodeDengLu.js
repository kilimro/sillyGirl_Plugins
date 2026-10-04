// [title: 美团团]
// [name: meiTuanCodeDengLu]
// [desc: 美团Token绑定、团币查询、UUID提取、领券/团币双授权和青龙同步]
// [author: Lxg-021002]
// [version: v2.2.7]
// [rule: ^(美团登录|团团登陆|美团查询|团团查询|美团管理|我的美团|我的团团)$]
// [cron: 18 5,8,12,15,18,21 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/美团团_v2.2.7_By.Lxg-021002.py]
// [depe: ["./vortoUtils.js"]]

const { sender: s, Bucket, container, plugin, utils } = require("sillygirl"),
  crypto = require("node:crypto"),
  vorto = require("./vortoUtils");
const binds = new Bucket("Yzyxmm_mt_bind"),
  tokens = new Bucket("Yzyxmm_mt_account"),
  names = new Bucket("Yzyxmm_mt_MTname"),
  mobiles = new Bucket("Yzyxmm_mt_mobile"),
  uuids = new Bucket("Yzyxmm_mt_UUID"),
  couponAuth = new Bucket("Yzyxmm_mt_Lingquantime"),
  coinAuth = new Bucket("Yzyxmm_mt_Tbtime");
const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  coupon_env: plugin.Form.string().title("领券变量名").default("meituanCookie"),
  coin_env: plugin.Form.string().title("团币变量名").default("meituanToken"),
  coupon_price: plugin.Form.number().title("领券每月价格").min(0).default(0),
  coin_price: plugin.Form.number().title("团币每月价格").min(0).default(0),
  coupon_coin: plugin.Form.integer().title("领券每月积分").min(0).default(999999),
  coin_coin: plugin.Form.integer().title("团币每月积分").min(0).default(999999),
  qr_code: plugin.Form.string().title("收款码图片URL").default(""),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw || "[]").replace(/'/g, '"'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch (_) {
    return [];
  }
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function active(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && String(d) >= today();
}
async function uid() {
  return String((await s.getUserId()) || "");
}
async function owned(userId) {
  return parseList(await binds.get(userId ?? (await uid()), "[]"));
}
async function save(userId, rows) {
  return rows.length ? binds.set(userId, JSON.stringify([...new Set(rows)])) : binds.delete(userId);
}
async function prompt(text, t = 120000) {
  await s.reply(text);
  const child = await s.listen({ timeout: t });
  return child ? String((await child.getMsg()) || "").trim() : null;
}
async function req(url, opt = {}) {
  const c = new AbortController(),
    timer = setTimeout(() => c.abort(), cfg.timeout_ms);
  try {
    const r = await fetch(url, {
        method: opt.method || "GET",
        headers: opt.headers,
        body: opt.json ? JSON.stringify(opt.json) : opt.body,
        redirect: opt.redirect || "follow",
        signal: c.signal,
      }),
      text = await r.text();
    if (r.status >= 400) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    return { r, text, data };
  } finally {
    clearTimeout(timer);
  }
}
function headers(token) {
  return {
    connection: "keep-alive",
    origin: "https://mtaccount.meituan.com",
    "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/122 Mobile Safari/537.36",
    token,
    referer: "https://mtaccount.meituan.com/user/",
    "x-requested-with": "com.sankuai.meituan",
  };
}
async function userInfo(token) {
  const x = await req("https://open.meituan.com/user/v1/info?fields=mobile,username,avatarurl,regTime", {
      headers: headers(token),
    }),
    u = x.data?.user;
  if (!u || /登录失败|已将账号锁定/.test(x.text)) throw new Error("Token失效");
  return { id: String(u.id), name: u.username || String(u.id), mobile: u.mobile || "未知" };
}
function rowsOf(v) {
  return Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];
}
async function upsertEnv(account, name, value) {
  const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 }),
    rows = rowsOf(await ql.getEnvs({ searchValue: name })),
    remarks = `美团团管理丨用户:${await uid()}丨美团:${account}`,
    found = rows.find((x) => x.name === name && String(x.remarks || "").includes(account));
  if (found) return ql.updateEnv({ id: found.id || found._id, name, value, remarks });
  return ql.createEnv({ name, value, remarks });
}
async function deleteEnv(account, name) {
  const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 }),
    ids = rowsOf(await ql.getEnvs({ searchValue: name }))
      .filter((x) => x.name === name && String(x.remarks || "").includes(account))
      .map((x) => x.id || x._id)
      .filter(Boolean);
  if (ids.length) return ql.deleteEnvs(ids);
}
async function login() {
  const raw = await prompt("请输入美团Token、带token参数的链接，或 Token#UUID");
  if (!raw || /^q$/i.test(raw)) return;
  let value = raw,
    uuid = "";
  if (raw.includes("#")) [value, uuid] = raw.split(/#(.+)/);
  const fromUrl = value.match(/[?&]token=([^&]+)/)?.[1];
  if (fromUrl) value = decodeURIComponent(fromUrl);
  if (!value.includes("Ag")) throw new Error("未找到有效Token");
  const info = await userInfo(value),
    userId = await uid(),
    list = await owned(userId);
  await tokens.set(info.id, value);
  await names.set(info.id, info.name);
  await mobiles.set(info.id, info.mobile);
  if (uuid) await uuids.set(info.id, uuid);
  if (!list.includes(info.id)) list.push(info.id);
  await save(userId, list);
  if (active(await couponAuth.get(info.id, ""))) await upsertEnv(info.id, cfg.coupon_env, value);
  if (active(await coinAuth.get(info.id, ""))) {
    const id = uuid || (await uuids.get(info.id, ""));
    if (id) await upsertEnv(info.id, cfg.coin_env, `${value}#${id}`);
  }
  return s.reply(`登录成功：${info.name}（${info.mobile}）`);
}
async function select() {
  const list = await owned(await uid());
  if (!list.length) throw new Error("未绑定美团账号");
  if (list.length === 1) return list[0];
  const n = Number(
    await prompt(
      [
        "请选择账号",
        ...(await Promise.all(
          list.map(async (x, i) => `[${i + 1}] ${await names.get(x, x)}丨${await mobiles.get(x, "")}`),
        )),
      ].join("\n"),
    ),
  );
  if (!Number.isInteger(n) || n < 1 || n > list.length) throw new Error("账号选择无效");
  return list[n - 1];
}
function random16() {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}
async function coinSummary(token) {
  const audit = await req("https://open.meituan.com/user/v1/info/auditting?fields=auditAvatarUrl%2CauditUsername", {
      headers: headers(token),
    }),
    id = audit.data?.user?.id;
  if (!id) throw new Error("Token过期");
  const login = await req("https://game.meituan.com/mgc/gamecenter/front/api/v1/login", {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
        "user-agent": headers(token)["user-agent"],
        "content-type": "application/json;charset=UTF-8",
        cookie: `token=${token}`,
      },
      json: {
        mtToken: token,
        deviceUUID: "0000000000000A3467823460D436CAB51202F336236F6A167191373531985811",
        mtUserId: id,
        idempotentString: random16(),
      },
    }),
    access = login.data?.data?.loginInfo?.accessToken;
  if (!access) throw new Error("团币登录失败");
  const balance = await req(
      "https://game.meituan.com/mgc/gamecenter/skuExchange/resource/counts?sceneId=3&gameId=10102",
      { headers: { "user-agent": headers(token)["user-agent"], actoken: access, mtoken: token } },
    ),
    total = Number(balance.data?.data?.[0]?.count) || 0;
  let earned = 0,
    offset = 0,
    done = false;
  const day = today();
  while (!done && offset < 1000) {
    const url = new URL("https://game.meituan.com/coin/billPage/getCoinAccountFlow");
    Object.entries({ yodaReady: "h5", csecplatform: "4", csecversion: "2.3.1" }).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    );
    const page = await req(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/json",
          origin: "https://awp.meituan.com",
          "user-agent": headers(token)["user-agent"],
          referer: "https://awp.meituan.com/",
        },
        json: { mtToken: token, lastUpdateTime: Math.floor(Date.now() / 1000) * 1000, limit: 20, offset },
      }),
      rows = page.data?.data?.coinChangeLogBOList || [];
    if (!rows.length) break;
    for (const row of rows) {
      if (String(row.utimeGmt || "").slice(0, 10) < day) {
        done = true;
        break;
      }
      if (Number(row.changeType) === 1 && !String(row.operationNote || "").includes("退款"))
        earned += Number(row.changeAmount) || 0;
    }
    offset += 20;
  }
  return { total, earned, totalMoney: (total / 1000).toFixed(2), earnedMoney: (earned / 1000).toFixed(2) };
}
async function query() {
  const account = await select(),
    expiry = await coinAuth.get(account, "");
  if (!active(expiry)) throw new Error(`团币授权${expiry ? `已过期:${expiry}` : "未开通"}`);
  const token = await tokens.get(account, ""),
    q = await coinSummary(token);
  return s.reply(
    `用户名:${await names.get(account, account)}\n用户:${await mobiles.get(account, "")}\n团币余额:${q.total}(${q.totalMoney})\n今日团币:${q.earned}(${q.earnedMoney})\n授权到期:${expiry}`,
  );
}
async function extractUuid() {
  const raw = await prompt("请粘贴美团APP-我的-团团赚-游戏中心分享内容");
  if (!raw) return "";
  let url = raw.match(/https?:\/\/[^\s<]+/)?.[0],
    target = url;
  if (url && /dpurl\.cn/i.test(url)) {
    const r = await req(url, { redirect: "manual" });
    target = r.r.headers.get("location") || url;
  }
  if (raw.includes("<url>")) target = raw.match(/<url>(.*?)<\/url>/)?.[1] || target;
  const term = new URL(target).searchParams.get("utm_term") || "",
    i = term.indexOf("2024");
  if (i < 0) return "";
  return i < term.length / 2 ? term.slice(i + 14, i + 78) : term.slice(Math.max(0, i - 64), i);
}
async function addMonths(account, bucket, months) {
  const old = await bucket.get(account, ""),
    d = active(old) ? new Date(`${old}T00:00:00`) : new Date();
  d.setDate(d.getDate() + months * 30);
  const date = d.toISOString().slice(0, 10);
  await bucket.set(account, date);
  return date;
}
async function payAuthorize(account, type) {
  const isCoupon = type === "coupon",
    months = Number(await prompt("请输入开通月数"));
  if (!Number.isInteger(months) || months <= 0) throw new Error("月数无效");
  if (!isCoupon && !(await uuids.get(account, ""))) throw new Error("请先添加UUID");
  const price = Number(isCoupon ? cfg.coupon_price : cfg.coin_price) || 0,
    coin = Number(isCoupon ? cfg.coupon_coin : cfg.coin_coin) || 0,
    pay = await vorto.getPayConfig(),
    methods = [];
  if (coin > 0) methods.push(["积分兑换", "coin"]);
  if (pay.qr_pay_switch || cfg.qr_code || pay.zsm) methods.push(["扫码支付", "qr"]);
  if (pay.ma_pay_switch) for (const [k, n] of Object.entries(pay.pay_types)) methods.push([n, `ma:${k}`]);
  let method =
    price === 0 && !methods.length
      ? ["免费", "free"]
      : methods.length === 1
        ? methods[0]
        : methods[Number(await prompt(methods.map((x, i) => `[${i + 1}] ${x[0]}`).join("\n"))) - 1];
  if (!method) throw new Error("未选择支付方式");
  const userId = await uid();
  if (method[1] === "coin") {
    const bal = await vorto.getUserPoints(userId),
      need = months * coin;
    if (bal < need) throw new Error(`积分不足：当前${bal}，需要${need}`);
    await vorto.updateUserPoints(userId, bal - need);
  } else if (method[1] === "qr") {
    const image = cfg.qr_code || pay.zsm;
    if (!image) throw new Error("未配置收款码");
    await s.reply(utils.image(image));
    if (!(await vorto.waitPaymentEvent(s, months * price, 300000)).paid) throw new Error("支付未完成");
  } else if (method[1].startsWith("ma:")) {
    const client = new vorto.MaPayClient(),
      orderNo = `MTT${Date.now()}${userId}`,
      order = await client.createOrder(
        months * price,
        method[1].slice(3),
        orderNo,
        `美团${isCoupon ? "领券" : "团币"}-${months}月`,
        userId,
      );
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
  const bucket = isCoupon ? couponAuth : coinAuth,
    date = await addMonths(account, bucket, months),
    token = await tokens.get(account, ""),
    value = isCoupon ? token : `${token}#${await uuids.get(account, "")}`;
  await upsertEnv(account, isCoupon ? cfg.coupon_env : cfg.coin_env, value);
  return s.reply(`${isCoupon ? "领券" : "团币"}授权成功，到期${date}`);
}
async function manage() {
  const account = await select(),
    token = await tokens.get(account, ""),
    valid = await userInfo(token)
      .then(() => true)
      .catch(() => false),
    choice = await prompt(
      `账号:${await names.get(account, account)}\nToken:${valid ? "有效" : "失效"}\n领券:${await couponAuth.get(account, "未开通")}\n团币:${await coinAuth.get(account, "未开通")}\nUUID:${(await uuids.get(account, "")) ? "已设置" : "未设置"}\n[1]开通领券 [2]开通团币 [3]删除/关停 [4]添加UUID`,
    );
  if (choice === "1") return payAuthorize(account, "coupon");
  if (choice === "2") return payAuthorize(account, "coin");
  if (choice === "4") {
    const uuid = await extractUuid();
    if (!uuid) throw new Error("UUID提取失败");
    await uuids.set(account, uuid);
    if (active(await coinAuth.get(account, ""))) await upsertEnv(account, cfg.coin_env, `${token}#${uuid}`);
    return s.reply(`UUID更新成功：${uuid}`);
  }
  if (choice === "3") {
    await deleteEnv(account, cfg.coupon_env);
    await deleteEnv(account, cfg.coin_env);
    for (const b of [tokens, names, mobiles, uuids, couponAuth, coinAuth]) await b.delete(account);
    const userId = await uid();
    await save(
      userId,
      (await owned(userId)).filter((x) => x !== account),
    );
    return s.reply("账号及服务已删除");
  }
}
async function cron() {
  let expired = 0,
    invalid = 0;
  for (const userId of await binds.keys()) {
    for (const account of await owned(userId)) {
      const token = await tokens.get(account, "");
      if (
        !(await userInfo(token)
          .then(() => true)
          .catch(() => false))
      )
        invalid++;
      const ca = await couponAuth.get(account, ""),
        ta = await coinAuth.get(account, "");
      if (ca && ca < today()) {
        await deleteEnv(account, cfg.coupon_env);
        expired++;
      }
      if (ta && ta < today()) {
        await deleteEnv(account, cfg.coin_env);
        expired++;
      }
    }
  }
  return typeof s.pushAdmin === "function"
    ? s.pushAdmin(`美团团检测：过期服务${expired}，失效Token${invalid}`)
    : undefined;
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    const c = String((await s.getMsg()) || "").trim();
    if (!c) return cron();
    if (/登录|登陆/.test(c)) return login();
    if (/查询/.test(c)) return query();
    if (/管理|我的/.test(c)) return manage();
    return s.resume();
  } catch (error) {
    return s.reply(`美团团执行失败：${error?.message || error}`);
  }
}
main();

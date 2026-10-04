// [title: 巨量管理]
// [name: juLiangGuanLi]
// [desc: 巨量IP账号管理、余额查询、动态API生成、IP加白与滑块签到]
// [author: chuan]
// [version: v2.1.0]
// [rule: ^(ip|剩余ip|巨量账号管理|巨量加白|生成api|巨量余额|巨量签到)$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 999]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/巨量管理_v2.1.0_By.chuan.py]
// [depe: []]

const { sender: s, Bucket, plugin } = require("sillygirl"),
  crypto = require("node:crypto"),
  store = new Bucket("jl_data");
const form = new plugin.Form({
  captcha_token: plugin.Form.string().title("腾讯滑块打码Token").default(""),
  notify_channels: plugin.Form.string().title("管理员通知渠道").default(""),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
function ua() {
  const first = 55 + Math.floor(Math.random() * 8),
    third = Math.floor(Math.random() * 3201),
    fourth = Math.floor(Math.random() * 141),
    os = [
      "(Windows NT 6.1; WOW64)",
      "(Windows NT 10.0; WOW64)",
      "(X11; Linux x86_64)",
      "(Macintosh; Intel Mac OS X 10_12_6)",
    ][Math.floor(Math.random() * 4)];
  return `Mozilla/5.0 ${os} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${first}.0.${third}.${fourth} Safari/537.36`;
}
async function req(url, opt = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), opt.timeout || cfg.timeout_ms);
  try {
    const response = await fetch(url, {
        method: opt.method || "GET",
        headers: opt.headers,
        body: opt.body,
        signal: controller.signal,
      }),
      text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return {
      response,
      text,
      json() {
        try {
          return JSON.parse(text);
        } catch (_) {
          throw new Error(`接口返回非JSON：${text.slice(0, 160)}`);
        }
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
async function prompt(text, timeout = 60000) {
  await s.reply(text);
  const child = await s.listen({ timeout });
  return child ? String((await child.getMsg()) || "").trim() : null;
}
async function notify(text) {
  return typeof s.pushAdmin === "function" ? s.pushAdmin(text) : s.reply(text);
}
async function login(username, password, userAgent) {
  const url = new URL("https://www.juliangip.com/login/go");
  Object.entries({ type: "password", username, password, sms_code: "" }).forEach(([k, v]) =>
    url.searchParams.set(k, v),
  );
  const r = await req(url, {
      method: "POST",
      headers: { "user-agent": userAgent, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    }),
    data = r.json();
  if (data.state !== "ok") throw new Error(data.message || "登录失败");
  const rows =
    typeof r.response.headers.getSetCookie === "function"
      ? r.response.headers.getSetCookie()
      : [r.response.headers.get("set-cookie")].filter(Boolean);
  if (!rows.length) throw new Error("登录响应缺少Cookie");
  return rows.map((x) => x.split(";", 1)[0]).join("; ");
}
function h(cookie, userAgent, type = "json") {
  return {
    connection: "keep-alive",
    cookie,
    "user-agent": userAgent,
    "content-type":
      type === "json" ? "application/json;charset=UTF-8" : "application/x-www-form-urlencoded; charset=UTF-8",
  };
}
async function orders(cookie, userAgent) {
  return (
    await req("https://www.juliangip.com/order/list", { method: "POST", headers: h(cookie, userAgent, "form") })
  ).json();
}
function tradeOf(data) {
  if (data?.state !== "ok") throw new Error(data?.message || "获取套餐失败");
  const children = data?.data?.[0]?.children || [];
  if (!children.length) throw new Error("没有可用免费套餐");
  return children[0].value;
}
async function keyOf(cookie, trade, userAgent) {
  const r = (
    await req(`https://www.juliangip.com/order/info?trade_no=${encodeURIComponent(trade)}`, {
      headers: h(cookie, userAgent),
    })
  ).json();
  if (Number(r.code) !== 100000) throw new Error(r.message || "获取套餐Key失败");
  return r.data?.key;
}
function sign(raw) {
  return crypto.createHash("md5").update(raw).digest("hex");
}
async function balance(cookie, trade, key, userAgent) {
  return (
    await req(
      `http://v2.api.juliangip.com/dynamic/balance?trade_no=${encodeURIComponent(trade)}&sign=${sign(`trade_no=${trade}&key=${key}`)}`,
      { headers: h(cookie, userAgent) },
    )
  ).json();
}
function extractApi(trade, key) {
  const raw = `auto_white=1&num=1&pt=1&result_type=text&split=2&trade_no=${trade}&key=${key}`;
  return `http://v2.api.juliangip.com/dynamic/getips?auto_white=1&num=1&pt=1&result_type=text&split=2&trade_no=${encodeURIComponent(trade)}&sign=${sign(raw)}`;
}
async function currentIp() {
  const text = (await req("https://ddns.oray.com/checkip")).text,
    ip = text.match(/\d+(?:\.\d+){3}/)?.[0];
  if (!ip) throw new Error("未识别到当前IPv4");
  return ip;
}
async function credentials() {
  const out = [];
  for (const username of await store.keys()) out.push({ username, password: String(await store.get(username, "")) });
  return out;
}
async function eachAccount(action) {
  const rows = await credentials();
  if (!rows.length) throw new Error("暂无账号，请先发送巨量账号管理添加");
  const out = [];
  for (const item of rows) {
    try {
      const userAgent = ua(),
        cookie = await login(item.username, item.password, userAgent),
        trade = tradeOf(await orders(cookie, userAgent));
      out.push(await action({ ...item, userAgent, cookie, trade }));
    } catch (error) {
      out.push(`【${item.username}】${error.message}`);
    }
  }
  return s.reply(out.join("\n"));
}
async function manage() {
  const rows = await credentials(),
    choice = await prompt(["q:退出，0:添加，-序号:删除", ...rows.map((x, i) => `${i + 1}. ${x.username}`)].join("\n"));
  if (choice === "0") {
    const username = await prompt("请输入账号"),
      password = await prompt("请输入密码");
    if (!username || !password) return;
    await login(username, password, ua());
    await store.set(username, password);
    return s.reply("账号有效，添加成功");
  }
  const del = String(choice || "").match(/^-(\d+)$/),
    item = del && rows[Number(del[1]) - 1];
  if (item) {
    await store.delete(item.username);
    return s.reply(`${item.username}删除成功`);
  }
  return s.reply("已退出");
}
async function getTicket(appid) {
  const data = (
      await req("http://119.96.239.11:8888/api/getcode", {
        method: "POST",
        timeout: 61000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeout: "60",
          type: "tencent-turing",
          appid,
          token: cfg.captcha_token,
          developeraccount: "",
        }),
      })
    ).json(),
    raw = data?.data?.code;
  let code = raw;
  try {
    if (typeof raw === "string") code = JSON.parse(raw);
  } catch (_) {}
  if (!code?.randstr || !code?.ticket) throw new Error(data?.msg || "滑块识别失败");
  return code;
}
async function signOne(item, retry = 0) {
  try {
    const page = (await req("https://www.juliangip.com/users/", { headers: h(item.cookie, item.userAgent) })).text;
    if (page.includes("您已成功领取")) return `【${item.username}】今日已签到`;
    if (!page.includes("点击领取今日免费IP")) return `【${item.username}】未发现签到入口`;
    const aid = page.match(/TencentCaptcha\(['"]([^'"]+)/)?.[1];
    if (!aid) throw new Error("未提取到Captcha appid");
    const ticket = await getTicket(aid),
      body = new URLSearchParams({ randStr: ticket.randstr, ticket: ticket.ticket }).toString(),
      r = (
        await req("https://www.juliangip.com/users/getFree", {
          method: "POST",
          headers: h(item.cookie, item.userAgent, "form"),
          body,
        })
      ).json();
    return `【${item.username}】${r.message || JSON.stringify(r)}`;
  } catch (error) {
    if (retry < 3) return signOne(item, retry + 1);
    return `【${item.username}】签到失败：${error.message}`;
  }
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    const content = String((await s.getMsg()) || "").trim();
    if (content === "ip") return s.reply(`当前ip：${await currentIp()}`);
    if (content === "巨量账号管理") return manage();
    if (content === "剩余ip")
      return eachAccount(async (x) => {
        const key = await keyOf(x.cookie, x.trade, x.userAgent),
          r = await balance(x.cookie, x.trade, key, x.userAgent);
        return Number(r.code) === 200
          ? `【${x.username}】剩余${r.data?.balance}ip可用`
          : `【${x.username}】${r.msg || "查询失败"}`;
      });
    if (content === "生成api")
      return eachAccount(
        async (x) => `【${x.username}】\n提取api：${extractApi(x.trade, await keyOf(x.cookie, x.trade, x.userAgent))}`,
      );
    if (content === "巨量加白") {
      const ip = await currentIp();
      await s.reply(`当前ip：${ip}`);
      return eachAccount(async (x) => {
        const r = (
          await req(
            `https://www.juliangip.com/users/product/time/setWhiteIp?trade_no=${encodeURIComponent(x.trade)}&ips=${encodeURIComponent(ip)}`,
            { headers: h(x.cookie, x.userAgent) },
          )
        ).json();
        return `【${x.username}】${r.state === "ok" ? "加白成功" : r.message || "加白失败"}`;
      });
    }
    if (content === "巨量余额") {
      if (!cfg.captcha_token) throw new Error("未配置滑块Token");
      const r = (
        await req("http://119.96.239.11:8888/api/getuserinformation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: cfg.captcha_token }),
        })
      ).json();
      return s.reply(`当前余额：${r.data?.["余额"] ?? "查询失败"}积分`);
    }
    if (content === "巨量签到") {
      if (!cfg.captcha_token) throw new Error("未配置滑块Token");
      const rows = await credentials(),
        out = [];
      for (const item of rows) {
        try {
          const userAgent = ua(),
            cookie = await login(item.username, item.password, userAgent);
          out.push(await signOne({ ...item, userAgent, cookie }));
        } catch (error) {
          out.push(`【${item.username}】${error.message}`);
        }
      }
      return notify(out.join("\n"));
    }
  } catch (error) {
    return s.reply(`巨量管理执行失败：${error?.message || error}`);
  }
}
main();

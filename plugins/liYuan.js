// [title: 梨园]
// [name: liYuan]
// [desc: 梨园行戏曲微信扫码登录、金币任务、余额查询和自动提现]
// [author: huawei]
// [version: v1.2.2]
// [rule: ^(梨园|ly)(扫码|登录|登陆|查询|任务)$]
// [cron: 30 7 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/梨园_v1.2.2_By.huawei.py]
// [depe: ["undici"]]

const { sender: s, Bucket, plugin, utils } = require("sillygirl"),
  crypto = require("node:crypto");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}
const userStore = new Bucket("G_LYHXQ_user"),
  tokenStore = new Bucket("G_LYHXQ_token"),
  FLY = "https://fly.daoran.tv",
  AOP = "http://wechat.daoran.tv",
  FLY_MD5 = "SkvyrWqK9QHTdCT12Rhxunjx+WwMTe9y4KwgeASFDhbYabRSPskR0Q==",
  AOP_MD5 = "GYWmhK2MfuQtDc9Cj8Fbw9hGoJwQ+f3Wbn0R6KhfUJmoy+8Nz7xP1A==",
  APP_SHA1 = "2B8FA3EE98CA3F7270CC599DAB07CF413DE74ABF",
  WX_UA =
    "Mozilla/5.0 (Linux; Android 14; Build/TP1A.220905.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.103 Mobile Safari/537.36 MicroMessenger/8.0.57.2820 WeChat/arm64";
const form = new plugin.Form({
  proxy_api: plugin.Form.string().title("代理API或固定代理").default(""),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {},
  proxyCache = new Map();
function sign() {
  const inner = crypto.createHash("md5").update(APP_SHA1).digest("hex"),
    plain = `daoransign_${inner}_${Math.floor(Date.now() / 1000)}`,
    cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from("E5Up6N2RkuWyJc5@"), Buffer.from("z8eFg_b_CSG9~kU9"));
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
}
function parseProxy(raw) {
  raw = String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  try {
    const j = JSON.parse(raw),
      v = j.proxy || j.result || j.ip_port || j.socks || j.data;
    if (typeof v === "string") raw = v;
    else if (v?.ip && v?.port) raw = `${v.ip}:${v.port}`;
    else if (j.ip && j.port) raw = `${j.ip}:${j.port}`;
  } catch (_) {}
  if (!raw || raw.includes("白名单")) return "";
  return /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
}
async function dispatcher(key = "default", reset = false) {
  if (reset) proxyCache.delete(key);
  if (!cfg.proxy_api || !ProxyAgent) return;
  if (proxyCache.has(key)) return proxyCache.get(key);
  let raw = cfg.proxy_api;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!(u.port && (!u.pathname || u.pathname === "/"))) {
      const r = await fetch(raw, { signal: AbortSignal.timeout(5000) });
      raw = await r.text();
    }
  } catch (_) {
    const r = await fetch(raw, { signal: AbortSignal.timeout(5000) });
    raw = await r.text();
  }
  const value = parseProxy(raw);
  if (!value) throw new Error("代理获取失败");
  const d = new ProxyAgent(value);
  proxyCache.set(key, d);
  return d;
}
async function req(url, opt = {}, key = "default", retry = 0) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), opt.timeout || cfg.timeout_ms);
  try {
    const response = await fetch(url, {
        method: opt.method || "GET",
        headers: opt.headers,
        body: opt.body,
        signal: controller.signal,
        dispatcher: await dispatcher(key, retry > 0),
      }),
      text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return {
      text,
      json() {
        try {
          return JSON.parse(text);
        } catch (_) {
          throw new Error(`接口返回非JSON：${text.slice(0, 160)}`);
        }
      },
    };
  } catch (error) {
    if (retry < 1) return req(url, opt, key, retry + 1);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function uid() {
  return String((await s.getUserId()) || "");
}
async function members() {
  return String((await userStore.get(await uid(), "")) || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
async function saveMembers(v) {
  return userStore.set(await uid(), [...new Set(v)].join(","));
}
async function info(mid) {
  const p = String((await tokenStore.get(mid, "")) || "").split("#");
  return { memberId: p[0], nick: p[1] || p[0] || mid };
}
async function getQrUuid() {
  const url = new URL("https://open.weixin.qq.com/connect/app/qrconnect");
  Object.entries({
    appid: "wxe2e7e595988751cc",
    bundleid: "uni.UNIA317E51",
    scope: "snsapi_userinfo",
    state: "lyhxcx",
    pass_ticket: crypto.randomUUID(),
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return (
    await req(url, { headers: { "user-agent": WX_UA, referer: "https://open.weixin.qq.com/" } }, "wx")
  ).text.match(/uuid\s*:\s*["'](\w+)/)?.[1];
}
async function scan() {
  const uuid = await getQrUuid();
  if (!uuid) throw new Error("获取二维码失败");
  await s.reply(utils.image(`https://open.weixin.qq.com/connect/qrcode/${uuid}`));
  await s.reply("请用微信扫码并确认，3分钟内回复Q可取消");
  let last = "408",
    noticed = false;
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const url = new URL("https://long.open.weixin.qq.com/connect/l/qrconnect");
    Object.entries({ uuid, f: "url", _: Date.now(), last }).forEach(([k, v]) => url.searchParams.set(k, v));
    let text = "";
    try {
      text = (
        await req(
          url,
          { headers: { "user-agent": WX_UA, referer: "https://open.weixin.qq.com/" }, timeout: 6000 },
          "wx",
        )
      ).text;
    } catch (_) {}
    if (text.includes("wx_errcode=405")) {
      const code = text.match(/oauth\?code=([^&"']+)/)?.[1] || text.match(/wx_code=['"]([^'"]+)/)?.[1];
      if (code) return code;
    }
    if (text.includes("wx_errcode=402")) {
      last = "402";
      if (!noticed) {
        noticed = true;
        await s.reply("已扫码，请在微信确认");
      }
    } else last = "408";
    const child = await s.listen({ timeout: 2000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || "").trim())) return null;
  }
  return null;
}
async function appLogin(code) {
  const sg = sign(),
    r = (
      await req(`${FLY}/API_UBP/wx/app/userinfo`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "user-agent": "okhttp/3.12.10",
          md5: FLY_MD5,
          sign: sg,
          project: "lyhxcx",
          item: "x5",
        },
        body: JSON.stringify({
          client: "Mobile",
          code,
          devUid: `autman_${Math.floor(Date.now() / 1000)}`,
          ip: "127.0.0.1",
          item: "x5",
          needMemberId: true,
          project: "lyhxcx",
          province: "100",
          sign: sg,
        }),
      })
    ).json();
  if (Number(r.code) !== 10000000 || !r.memberId) throw new Error(r.retMsg || "登录失败或账号未注册");
  return { memberId: String(r.memberId), nick: r.nickName || "用户" };
}
async function aop(path, mid, extra = {}) {
  const sg = sign();
  return (
    await req(
      `${AOP}/API_AOP${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "user-agent": "okhttp/3.12.10",
          md5: AOP_MD5,
          sign: sg,
          project: "lyhxcx",
          item: "x5",
        },
        body: JSON.stringify({ userId: mid, sign: sg, project: "lyhxcx", item: "x5", ...extra }),
      },
      mid,
    )
  ).json();
}
async function cash(mid) {
  const detail = await aop("/act/coin/task/getDetail", mid, { actCode: "ott_coin" }),
    coins = Number(detail?.coins) || 0;
  await aop("/act/coin/task/cashCoins", mid, { actCode: "ott_coin" }).catch(() => {});
  if (coins < 1000) return `提现: 金币不足(需1000, 当前${coins})`;
  const chosen = Math.floor(coins / 1000) * 1000,
    ad = sign();
  await req(
    `${FLY}/API_UBP/xiaomi/ad/clickBack?oaid=37bba68be59bdb7a&pkg=uni.UNIA317E51&dataType=2`,
    { headers: { "user-agent": "okhttp/3.12.10", md5: FLY_MD5, sign: ad, project: "lyhxcx", item: "x5" } },
    mid,
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const result = await aop("/act/coin/task/exchange", mid, { actCode: "ott_coin", useCoins: chosen });
  return Number(result?.result) === 0 ? `提现: ${chosen}金币成功` : `提现: ${result?.retMsg || "失败"}`;
}
const taskNames = {
  type2: "签到",
  type3: "听戏",
  type4: "看视频",
  type5: "看短视频",
  type6: "广告任务",
  type7: "邀请好友",
  type1: "额外任务",
};
async function runTasks(mid, nick) {
  const first = await aop("/act/coin/task/getDetail", mid, { actCode: "ott_coin" });
  if (Number(first?.code) !== 10000000) return `[${nick}] 获取任务失败`;
  const lines = [],
    earned = { value: 0 };
  async function round(map, suffix = "") {
    for (const [type, item] of Object.entries(map || {})) {
      const taskType = Number(item.taskType) || 0,
        per = Number(item.perCoins) || 0,
        today = Number(item.todayCoins) || 0,
        max = Number(item.todayMaxCoins) || 0,
        name = taskNames[type] || `任务${taskType}`;
      if (Number(item.finishFlag) === 1 || (max > 0 && today >= max) || taskType === 7 || (suffix && taskType === 2))
        continue;
      if (taskType === 2) {
        const r = await aop("/act/coin/task/finish", mid, { actCode: "ott_coin", taskType, taskId: item.taskId });
        if (Number(r?.result) === 0) {
          earned.value += per;
          lines.push(`${name}: +${per}`);
        } else lines.push(`${name}: 失败`);
        continue;
      }
      let count = 0,
        fail = 0,
        limit = per > 0 ? Math.min(50, Math.floor((max - today) / per) + 1) : 10;
      while (count < limit && today + count * per < max) {
        const result = await aop("/act/coin/task/finish", mid, { actCode: "ott_coin", taskType, taskId: item.taskId }),
          ok = Number(result?.result) === 0;
        if (ok) {
          count++;
          earned.value += per;
          fail = 0;
        } else if (++fail >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, ok ? 100 : 300));
      }
      if (count) lines.push(`${name}${suffix}: +${count * per}`);
    }
  }
  await round(first.taskMap);
  const second = await aop("/act/coin/task/getDetail", mid, { actCode: "ott_coin" });
  if (Number(second?.code) === 10000000) await round(second.taskMap, "(补)");
  lines.push(await cash(mid));
  const final = await aop("/act/coin/task/getDetail", mid, { actCode: "ott_coin" });
  return `[${nick}]\n${lines.join("\n")}\n本次+${earned.value} | 余额${Number(final?.code) === 10000000 ? final.coins : 0}`;
}
async function doScan() {
  const code = await scan();
  if (!code) return s.reply("扫码已取消或超时");
  const data = await appLogin(code);
  await tokenStore.set(data.memberId, `${data.memberId}#${data.nick}`);
  const list = await members();
  list.push(data.memberId);
  await saveMembers(list);
  await s.reply(`登录成功：${data.nick}，开始执行任务`);
  return s.reply(await runTasks(data.memberId, data.nick));
}
async function query() {
  const list = await members();
  if (!list.length) return s.reply("暂无绑定账号，发送“梨园扫码”登录");
  const lines = ["=====梨园行戏曲====="];
  for (const mid of list) {
    const x = await info(mid),
      r = await aop("/act/coin/task/getDetail", mid, { actCode: "ott_coin" });
    lines.push(`${x.nick}: ${Number(r?.code) === 10000000 ? r.coins : "查询失败"}金币`);
  }
  return s.reply(lines.join("\n"));
}
async function tasks() {
  const list = await members();
  if (!list.length) return s.reply("暂无绑定账号，发送“梨园扫码”登录");
  const out = await Promise.all(
    list.map(async (mid) => {
      try {
        const x = await info(mid);
        return await runTasks(mid, x.nick);
      } catch (error) {
        return `[${mid}] 异常: ${error.message}`;
      }
    }),
  );
  return s.reply(`=====梨园行任务报告=====\n${out.join("\n---\n")}`);
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    const c = String((await s.getMsg()) || "").trim();
    if (/扫码$/.test(c)) return doScan();
    if (/查询$/.test(c)) return query();
    return tasks();
  } catch (error) {
    return s.reply(`梨园执行失败：${error?.message || error}`);
  }
}
main();

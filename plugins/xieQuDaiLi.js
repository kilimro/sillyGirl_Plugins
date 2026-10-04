// [title: 携趣代理]
// [name: xieQuDaiLi]
// [desc: 携趣、星空和豆芽代理的提取、余量及公网 IP 自动加白管理]
// [author: sillyGirl]
// [version: v2.1.0]
// [rule: ^携趣$|^携趣删白$|^携趣余量$|^携趣管理$|^携趣配置$|^携趣头子加白$|^星空(加白|代理加白)$|^豆芽加白$|^xqfk$]
// [cron: */15 * * * *]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/携趣代理_v4_By.funyhook.py;backup/携趣加白-头子专用_v1.0.3_By.960342874.py;backup/星空加白云端版_v1.0.0_By.rujingxianghai.py;backup/星空代理加白合租_v8.6_By.qingge.js;backup/豆芽加白_v0.0.3_By.qingge.txt;backup/自用插件_v0.1.2_By.qingge.txt]
// [depe: []]

const { Bucket, plugin, sender: s } = require("sillygirl");

const config = new plugin.Form({
  extract_url: plugin.Form.string().title("代理提取 URL").default(""),
  balance_url: plugin.Form.string().title("余量查询 URL").default(""),
  delete_white_url: plugin.Form.string().title("删除白名单 URL").default(""),
  accounts: plugin.Form.string().title("携趣账号").description("uid=值,ukey=值#uid=值,ukey=值").default(""),
  fixed_ip: plugin.Form.string().title("指定加白 IP").default(""),
  public_ip_url: plugin.Form.string().title("公网 IP 接口").default("https://www.ip.cn/api/index?ip&type=0"),
  xingkong_key: plugin.Form.string().title("星空加白 KEY").default(""),
  xingkong_url: plugin.Form.string().title("星空同步地址").default("https://xkdl.vorto.cn"),
  xingkong_apikey: plugin.Form.string().title("星空 APIKEY").default(""),
  xingkong_sign: plugin.Form.string().title("星空 SIGN").default(""),
  xingkong_api_url: plugin.Form.string().title("星空原生 API").default("http://api2.xkdaili.com/tools/XApi.ashx"),
  douya_authkey: plugin.Form.string().title("豆芽秘钥").default(""),
});

const proxyState = new Bucket("xieQuDaiLi.state");

async function main() {
  const cfg = (await config.get()) || {};
  const content = String((await s.getMsg()) || "").trim();
  if (!content) {
    const results = [];
    if (cfg.xingkong_apikey && cfg.xingkong_sign) results.push(await whitelistXingkongApi(cfg, true));
    if (cfg.douya_authkey) results.push(await whitelistDouya(cfg, true));
    if (results.some((row) => row.changed || !row.ok)) await s.pushAdmin(results.map((row) => row.message).join("\n"));
    return;
  }
  if (!(await s.isAdmin())) return s.reply("仅管理员可用");
  if (content === "携趣头子加白") return whitelistXiequ(cfg);
  if (/^星空(?:加白|代理加白)$/.test(content)) {
    if (cfg.xingkong_apikey && cfg.xingkong_sign) return s.reply((await whitelistXingkongApi(cfg, false)).message);
    return whitelistXingkong(cfg);
  }
  if (content === "豆芽加白") return s.reply((await whitelistDouya(cfg, false)).message);
  if (/管理|配置|xqfk/i.test(content)) {
    return s.reply(
      [
        `代理提取：${cfg.extract_url ? "已配置" : "未配置"}`,
        `余量查询：${cfg.balance_url ? "已配置" : "未配置"}`,
        `删除白名单：${cfg.delete_white_url ? "已配置" : "未配置"}`,
      ].join("\n"),
    );
  }
  const url =
    content === "携趣余量" ? cfg.balance_url : content === "携趣删白" ? cfg.delete_white_url : cfg.extract_url;
  if (!url) return s.reply("请先在插件配置填写对应的携趣 API URL");
  try {
    const response = await fetch(String(url), { headers: { accept: "application/json,text/plain,*/*" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    return s.reply(`携趣返回：\n${text.slice(0, 1800)}`);
  } catch (error) {
    return s.reply(`携趣请求失败：${message(error)}`);
  }
}

async function whitelistXiequ(cfg) {
  const accounts = [...String(cfg.accounts || "").matchAll(/uid=([^,#]+),ukey=([^#]+)/g)].map((item) => ({
    uid: item[1],
    ukey: item[2],
  }));
  if (!accounts.length) return s.reply("请先配置携趣账号：uid=值,ukey=值");
  const ip = String(cfg.fixed_ip || "").trim() || (await publicIp(cfg.public_ip_url));
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) throw new Error(`公网 IP 无效：${ip}`);
  for (const item of accounts)
    await fetch(
      `http://op.xiequ.cn/IpWhiteList.aspx?uid=${encodeURIComponent(item.uid)}&ukey=${encodeURIComponent(item.ukey)}&act=del&ip=all`,
      { signal: AbortSignal.timeout(10000) },
    ).catch(() => undefined);
  for (const item of accounts) {
    const data = await fetch(
      `http://op.xiequ.cn/ApiUser.aspx?act=suitdt&uid=${encodeURIComponent(item.uid)}&ukey=${encodeURIComponent(item.ukey)}`,
      { signal: AbortSignal.timeout(10000) },
    )
      .then((r) => r.json())
      .catch(() => ({}));
    const packageRow = (data.data || []).find((row) => Number(row.num) - Number(row.use) > 0);
    if (String(data.success) !== "true" || !packageRow) continue;
    const text = await fetch(
      `http://op.xiequ.cn/IpWhiteList.aspx?uid=${encodeURIComponent(item.uid)}&ukey=${encodeURIComponent(item.ukey)}&act=add&ip=${encodeURIComponent(ip)}`,
      { method: "POST", signal: AbortSignal.timeout(10000) },
    ).then((r) => r.text());
    if (!/success/i.test(text)) throw new Error(text.slice(0, 200) || "携趣加白失败");
    return s.reply(
      `携趣加白成功\nIP：${ip}\n账号：${item.uid}\n剩余：${Number(packageRow.num) - Number(packageRow.use)}`,
    );
  }
  return s.reply("所有携趣账号的可用套餐余量均不足");
}

async function whitelistXingkong(cfg) {
  const key = String(cfg.xingkong_key || "").trim();
  if (!key) return s.reply("请先配置星空加白 KEY");
  const ip = String(cfg.fixed_ip || "").trim() || (await publicIp(cfg.public_ip_url));
  const response = await fetch(`${String(cfg.xingkong_url || "https://xkdl.vorto.cn").replace(/\/$/, "")}/xkdl-sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, ip }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.verify === false) throw new Error(data.message || `HTTP ${response.status}`);
  return s.reply(data.is_new ? `星空 IP 更新成功：${ip}\n${data.message || ""}` : `星空 IP 未变化：${ip}`);
}

async function whitelistXingkongApi(cfg, cron) {
  const ip = String(cfg.fixed_ip || "").trim() || (await publicIp(cfg.public_ip_url));
  if (!validIp(ip)) return { ok: false, changed: false, message: `星空加白失败：公网 IP 无效 ${ip}` };
  const last = await proxyState.get("xingkong_ip", "");
  if (last === ip) return { ok: true, changed: false, message: `星空 IP 未变化：${ip}` };
  const history = [
    ...new Set(
      String(await proxyState.get("xingkong_history", ""))
        .split(",")
        .filter(validIp),
    ),
  ];
  const stale = [...new Set([last, ...history].filter((value) => validIp(value) && value !== ip))];
  if (stale.length)
    await xingkongApi(cfg, "delwhiteip", stale.join(",")).catch((error) =>
      console.log(`星空删白失败：${message(error)}`),
    );
  const result = await xingkongApi(cfg, "addwhiteip", ip);
  if (Number(result?.status) !== 100)
    return {
      ok: false,
      changed: false,
      message: `星空加白失败：${result?.info || JSON.stringify(result).slice(0, 180)}`,
    };
  const nextHistory = [ip, ...history.filter((value) => value !== ip)].slice(0, 5);
  await proxyState.set("xingkong_ip", ip);
  await proxyState.set("xingkong_history", nextHistory.join(","));
  await proxyState.set("xingkong_success_time", new Date().toISOString());
  return { ok: true, changed: true, message: `星空加白成功：${ip}${cron ? "（定时检测）" : ""}` };
}

async function xingkongApi(cfg, type, ip) {
  const url = new URL(String(cfg.xingkong_api_url || "http://api2.xkdaili.com/tools/XApi.ashx"));
  for (const [key, value] of Object.entries({
    apikey: cfg.xingkong_apikey,
    sign: cfg.xingkong_sign,
    type,
    flag: "8",
    ip,
  }))
    url.searchParams.set(key, String(value));
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, info: text };
  }
}

async function whitelistDouya(cfg, cron) {
  const authkey = String(cfg.douya_authkey || "").trim();
  if (!authkey) return { ok: false, changed: false, message: "豆芽加白失败：未配置秘钥" };
  const ip = String(cfg.fixed_ip || "").trim() || (await publicIp(cfg.public_ip_url || "https://4.ipw.cn"));
  if (!validIp(ip)) return { ok: false, changed: false, message: `豆芽加白失败：公网 IP 无效 ${ip}` };
  const last = await proxyState.get("douya_ip", "");
  const list = await douyaApi(cfg, "GetWhite", "");
  if (last === ip && String(list).includes(ip))
    return { ok: true, changed: false, message: `豆芽 IP 已在白名单：${ip}` };
  if (validIp(last) && last !== ip)
    await douyaApi(cfg, "DelWhite", last).catch((error) => console.log(`豆芽删白失败：${message(error)}`));
  const result = await douyaApi(cfg, "AddWhite", ip);
  const verify = await douyaApi(cfg, "GetWhite", "");
  const ok = String(verify).includes(ip);
  if (ok) await proxyState.set("douya_ip", ip);
  return {
    ok,
    changed: ok && last !== ip,
    message: ok
      ? `豆芽加白成功：${ip}${cron ? "（定时检测）" : ""}`
      : `豆芽加白未确认：${String(result).slice(0, 180)}`,
  };
}

async function douyaApi(cfg, service, white) {
  const url = new URL("https://api.douyadaili.com/proxy/");
  url.searchParams.set("service", service);
  url.searchParams.set("authkey", String(cfg.douya_authkey));
  url.searchParams.set("format", "txt");
  if (white) url.searchParams.set("white", white);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  return text;
}

async function publicIp(url) {
  const response = await fetch(String(url || "https://www.ip.cn/api/index?ip&type=0"), {
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* 文本 IP */
  }
  return (
    String(data.ip || text)
      .trim()
      .match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0] || ""
  );
}

function message(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

function validIp(value) {
  return (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(value)) &&
    String(value)
      .split(".")
      .every((part) => Number(part) >= 0 && Number(part) <= 255)
  );
}

main().catch((error) => s.reply(`代理管理失败：${message(error)}`));

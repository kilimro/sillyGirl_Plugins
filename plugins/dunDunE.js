// [title: 顿顿饿]
// [name: dunDunE]
// [desc: 饿了么 Cookie 绑定、资产/券/乐园币查询、备注、解绑、找回、授权续期及青龙同步]
// [author: hicong]
// [version: v1.6.5]
// [rule: ^([\s\S]*cookie2=[\s\S]*)$]
// [rule: ^(查询|简单查询|查券|查币|代挂|简单代挂|备注|解绑|找回|饿了么授权检测|饿了么授权|饿了版本)$]
// [cron: 0 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 99999]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [carry: true]
// [origin: backup/顿顿查_v1.0.0_By.hicong.txt;backup/顿顿饿_vv1.6.4_By.hicong.txt]
// [depe: []]

const crypto = require("node:crypto");
const { Bucket, sender: s, plugin, container } = require("sillygirl");

const users = new Bucket("dunDunE.users"),
  cookies = new Bucket("sm_ddb_CKDB"),
  owners = new Bucket("sm_ddb_userData_WB"),
  phones = new Bucket("sm_ddb_phone"),
  remarks = new Bucket("sm_ddb_remarks"),
  auth = new Bucket("sm_ddb_vip");
const form = new plugin.Form({
  disable_private: plugin.Form.boolean().title("禁用私聊").default(false),
  disable_group: plugin.Form.boolean().title("禁用群聊").default(false),
  group_whitelist: plugin.Form.string().title("群聊白名单").default(""),
  vip_inquiry: plugin.Form.boolean().title("查询需要授权").default(false),
  first_month_points: plugin.Form.integer().title("首月积分").min(0).default(100),
  next_month_points: plugin.Form.integer().title("续费每月积分").min(0).default(80),
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  env_name: plugin.Form.string().title("青龙变量名").default("elmck"),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(3000).max(60000).default(15000),
});
let cfg = {};

async function main() {
  cfg = (await form.get()) || {};
  const content = String((await s.getMsg()) || "").trim();
  if (!content) return cronCheck();
  if (!(await allowed())) return;
  if (/cookie2=/.test(content)) return bindCookie(content);
  if (content === "饿了版本") return s.reply("顿顿饿迁移版 v1.6.5");
  if (content === "找回") return recover();
  if (content === "饿了么授权") return adminAuthorize();
  if (content === "饿了么授权检测") return checkAuthorization();
  const accountIds = await ownedIds();
  if (!accountIds.length)
    return s.reply("无已绑定账号，发送含 cookie2、SID、USERID 的 Cookie 可绑定；账号丢失请发送【找回】");
  if (content === "解绑") return unbind(accountIds);
  if (content === "备注") return setRemark(accountIds);
  if (/代挂/.test(content)) return renew(accountIds, content.startsWith("简单"));
  if (/查询|查券|查币/.test(content)) return query(accountIds, content);
}

async function allowed() {
  const chatId = String((await s.getChatId()) || "");
  if (!chatId && cfg.disable_private) return false;
  if (chatId && cfg.disable_group) return false;
  const whitelist = String(cfg.group_whitelist || "")
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return !chatId || !whitelist.length || whitelist.includes(chatId);
}

async function bindCookie(raw) {
  const cookie = normalizeCookie(raw),
    profile = await userDetail(cookie);
  const id = String(profile.user_id || profile.userId || profile.id || cookieValue(cookie, "USERID") || "");
  if (!id) throw new Error("Cookie 有效但接口没有返回 USERID");
  const owner = await uid();
  await cookies.set(id, cookie);
  await owners.set(id, owner);
  if (profile.mobile) await phones.set(id, String(profile.mobile));
  let rows = await ownedIds(owner);
  if (!rows.includes(id)) {
    rows.push(id);
    await users.set(owner, JSON.stringify(rows));
  }
  const expires = Number(await auth.get(id, "0"));
  let synced = false;
  if (expires > Date.now() / 1000) synced = await syncQingLong(id, cookie, owner);
  return s.reply(
    [
      `账号绑定成功：${display(id)}`,
      profile.username ? `用户名：${profile.username}` : "",
      profile.mobile ? `手机号：${maskPhone(profile.mobile)}` : "",
      expires > Date.now() / 1000 ? `授权剩余：${daysLeft(expires)} 天` : "当前未授权",
      synced ? "青龙同步成功" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function query(ids, mode) {
  const selected = await select(ids, "查询");
  if (!selected) return;
  for (const id of selected) {
    const expires = Number(await auth.get(id, "0"));
    if (cfg.vip_inquiry && expires <= Date.now() / 1000) {
      await s.reply(`【${await label(id)}】未授权或授权已过期`);
      continue;
    }
    let cookie = String(await cookies.get(id, ""));
    try {
      if (mode === "查券") await s.reply(`【${await label(id)}】\n${await queryCoupons(cookie)}`);
      else if (mode === "查币") await s.reply(`【${await label(id)}】\n${await queryCoinDetail(cookie)}`);
      else {
        const data = await queryAssets(cookie, id, mode === "简单查询");
        await s.reply(formatAssets(await label(id), data, expires));
      }
    } catch (error) {
      await s.reply(`【${await label(id)}】查询失败：${cleanError(error)}`);
    }
  }
}

async function queryAssets(cookie, id, simple) {
  const profile = await userDetail(cookie),
    result = { profile };
  if (!simple) {
    const [foodie, wallet, coins] = await Promise.allSettled([
      json(
        "https://h5.ele.me/restapi/svip_biz/v1/supervip/foodie/records?latitude=39.90498795617771&limit=20&longitude=116.40528968768549&offset=0",
        { headers: { cookie } },
      ),
      json("https://httpizza.ele.me/walletUserV2/storedcard/queryBalanceBycardType?cardType=platform", {
        headers: { cookie, referer: "https://r.ele.me/alsc-wallet/home.html?channel=grzx" },
      }),
      queryParkCoins(cookie),
    ]);
    if (foodie.status === "fulfilled") {
      result.foodieTotal = foodie.value.peaCount ?? 0;
      result.foodieToday = (foodie.value.records || [])
        .filter((row) => String(row.createdTime || "").startsWith(today()))
        .reduce((sum, row) => sum + Number(row.count || 0), 0);
    }
    if (wallet.status === "fulfilled") result.wallet = Number(wallet.value?.data?.totalAmount || 0) / 100;
    if (coins.status === "fulfilled") Object.assign(result, coins.value);
  }
  return result;
}

async function queryParkCoins(cookie) {
  const session = await mtopSession(cookie),
    totalData = { bizScene: "IDIOM", bizParam: JSON.stringify({ type: "ggetGold" }), bizMethod: "queryIndex" };
  const total = await mtop(
    "https://shopping.ele.me/h5/mtop.alsc.playgame.mini.game.dispatch/1.0/",
    "mtop.alsc.playgame.mini.game.dispatch",
    totalData,
    session,
  );
  let totalCoin = 0;
  try {
    totalCoin = Number(JSON.parse(total?.data?.data || "{}").num || 0);
  } catch {}
  const detailData = {
    templateId: "1404",
    bizScene: "game_center",
    convertType: "GAME_CENTER",
    startTime: `${today()} 00:00:00`,
    pageNo: 1,
    pageSize: "20",
  };
  const detail = await mtop(
    "https://mtop.ele.me/h5/mtop.koubei.interaction.center.common.querypropertydetail/1.0/",
    "mtop.koubei.interaction.center.common.querypropertydetail",
    detailData,
    session,
  );
  const todayCoin = (detail?.data?.list || [])
    .filter((row) => row.detailType === "GRANT" && String(row.gmtModified || "").includes(today()))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return { totalCoin, todayCoin };
}

async function queryCoinDetail(cookie) {
  const session = await mtopSession(cookie),
    data = {
      templateId: "1404",
      bizScene: "game_center",
      convertType: "GAME_CENTER",
      startTime: `${today()} 00:00:00`,
      pageNo: 1,
      pageSize: "20",
    };
  const body = await mtop(
    "https://mtop.ele.me/h5/mtop.koubei.interaction.center.common.querypropertydetail/1.0/",
    "mtop.koubei.interaction.center.common.querypropertydetail",
    data,
    session,
  );
  const rows = (body?.data?.list || []).filter(
    (row) => row.detailType === "GRANT" && String(row.gmtModified || "").includes(today()),
  );
  return rows.length
    ? rows.map((row) => `${row.extInfo?.desc || "乐园币"} ${row.amount}`).join("\n")
    : "今日暂无乐园币记录";
}

async function queryCoupons(cookie) {
  const session = await mtopSession(cookie),
    data = {
      condition: "",
      latitude: 30.17853,
      longitude: 120.221101,
      tabCode: "HONG_BAO",
      sourceFrom: "ELEME_WECHAT_MINIAPP",
      extInfo: JSON.stringify({ miniAppVersion: "10.19.31" }),
    };
  const body = await mtop(
    "https://guide-acs.m.taobao.com/h5/mtop.alsc.personal.querypasslist/1.0/2.0/",
    "mtop.alsc.personal.queryPassList",
    data,
    session,
    { "x-tap": "wx", referer: "https://servicewechat.com/wxece3a9a4c82f58c9/612/page-frame.html" },
  );
  const benefits = body?.data?.result?.passInfoList?.flatMap((row) => row.benefitList || []) || [];
  return benefits.length
    ? benefits
        .map((row) => `${row.title || "优惠券"} ${row.amountText?.yuanText || ""} ${row.thresholdText || ""}`.trim())
        .join("\n")
    : "暂无可用优惠券";
}

async function mtopSession(cookie) {
  const clean = normalizeCookie(cookie).replace(/_m_h5_tk(?:_enc)?=[^;]*;?/g, "");
  const response = await fetch(
    "https://waimai-guide.ele.me/h5/mtop.alsc.personal.queryminecenter/1.0/?jsv=2.6.2&appKey=12574478",
    { headers: { cookie: clean }, redirect: "manual", signal: AbortSignal.timeout(timeout()) },
  );
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""];
  const joined = setCookies.join(";");
  const tokenRow = joined.match(/_m_h5_tk=([^;]+)/),
    encRow = joined.match(/_m_h5_tk_enc=([^;]+)/);
  const token = (tokenRow?.[1] || cookieValue(cookie, "_m_h5_tk")).split("_")[0];
  if (!token) throw new Error("未取得 MTop Token");
  return {
    token,
    cookie: `${clean};_m_h5_tk=${tokenRow?.[1] || cookieValue(cookie, "_m_h5_tk")};_m_h5_tk_enc=${encRow?.[1] || cookieValue(cookie, "_m_h5_tk_enc")};`,
  };
}

async function mtop(base, api, data, session, extraHeaders = {}) {
  const t = Date.now(),
    bodyText = JSON.stringify(data),
    sign = crypto.createHash("md5").update(`${session.token}&${t}&12574478&${bodyText}`).digest("hex"),
    url = new URL(base);
  for (const [k, v] of Object.entries({
    jsv: "2.7.1",
    appKey: "12574478",
    t,
    sign,
    api,
    v: "1.0",
    type: "originaljson",
    dataType: "json",
    needLogin: "true",
  }))
    url.searchParams.set(k, String(v));
  return json(url, {
    method: "POST",
    headers: { cookie: session.cookie, "content-type": "application/x-www-form-urlencoded", ...extraHeaders },
    body: new URLSearchParams({ data: bodyText }),
  });
}

async function userDetail(cookie) {
  const body = await json("https://restapi.ele.me/eus/v5/user_detail", { headers: { cookie } });
  if (!body?.user_id && !body?.username && !body?.mobile) throw new Error(body?.message || "Cookie 未登录");
  return body;
}

async function renew(ids, simple) {
  const selected = simple ? ids : await select(ids, "续费");
  if (!selected) return;
  await s.reply("请输入续费月数，q退出");
  const child = await s.listen({ timeout: 60000 });
  if (!child) return;
  const raw = String((await child.getMsg()) || "").trim();
  if (/^q$/i.test(raw)) return s.reply("已退出");
  const months = Number(raw);
  if (!Number.isInteger(months) || months <= 0) return s.reply("月份无效");
  const owner = await uid(),
    platform = String((await s.getPlatform()) || "WEB").toUpperCase(),
    points = new Bucket(`sm_gaia_userData_${platform}`),
    wallet = parseObject(await points.get(owner, "{}"));
  let cost = 0;
  for (const id of selected)
    cost +=
      (Number(await auth.get(id, "0")) > Date.now() / 1000
        ? Number(cfg.next_month_points) || 80
        : Number(cfg.first_month_points) || 100) * months;
  if (Number(wallet.balance || 0) < cost) return s.reply(`积分不足：当前 ${Number(wallet.balance || 0)}，需要 ${cost}`);
  wallet.balance = Number(wallet.balance || 0) - cost;
  await points.set(owner, JSON.stringify(wallet));
  for (const id of selected) {
    const old = Number(await auth.get(id, "0"));
    const next = Math.max(old, Date.now() / 1000) + months * 30 * 86400;
    await auth.set(id, String(Math.trunc(next)));
    await syncQingLong(id, await cookies.get(id, ""), owner);
  }
  return s.reply(`续费完成：${selected.length} 个账号，${months} 个月，扣除 ${cost} 积分`);
}

async function setRemark(ids) {
  const selected = await select(ids, "备注");
  if (!selected) return;
  await s.reply("请输入新备注");
  const child = await s.listen({ timeout: 60000 });
  if (!child) return;
  const value = String((await child.getMsg()) || "").trim();
  if (!value) return;
  for (const id of selected) await remarks.set(id, value);
  return s.reply(`已更新 ${selected.length} 个账号备注`);
}
async function unbind(ids) {
  const selected = await select(ids, "解绑");
  if (!selected) return;
  const owner = await uid();
  let all = await ownedIds(owner);
  for (const id of selected) {
    await owners.delete(id);
    all = all.filter((row) => row !== id);
  }
  await users.set(owner, JSON.stringify(all));
  return s.reply(`解绑成功：${selected.length} 个账号`);
}
async function recover() {
  await s.reply("请发送一个已绑定账号的 Cookie");
  const child = await s.listen({ timeout: 60000 });
  if (!child) return;
  const profile = await userDetail(normalizeCookie(await child.getMsg()));
  const id = String(profile.user_id || ""),
    old = String(await owners.get(id, "")),
    current = await uid();
  if (!old) return s.reply("未查询到 Cookie 绑定关系");
  if (old === current) return s.reply("无需找回");
  const all = await ownedIds(old);
  for (const row of all) await owners.set(row, current);
  await users.set(current, JSON.stringify([...new Set([...(await ownedIds(current)), ...all])]));
  await users.delete(old);
  return s.reply(`找回成功：${all.length} 个账号\n原UID：${old}\n现UID：${current}`);
}

async function adminAuthorize() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可授权");
  await s.reply("请输入 USERID 列表（逗号分隔）");
  let child = await s.listen({ timeout: 60000 });
  if (!child) return;
  const ids = String((await child.getMsg()) || "")
    .split(/[,，\s]+/)
    .filter(Boolean);
  await s.reply("请输入增加天数（可为负数）");
  child = await s.listen({ timeout: 60000 });
  if (!child) return;
  const days = Number(await child.getMsg());
  if (!Number.isFinite(days) || days === 0) return s.reply("天数无效");
  for (const id of ids) {
    const old = Number(await auth.get(id, "0")),
      base = old > Date.now() / 1000 ? old : Date.now() / 1000;
    await auth.set(id, String(Math.max(0, Math.trunc(base + days * 86400))));
  }
  return s.reply(`授权完成：${ids.length} 个账号，${days} 天`);
}
async function checkAuthorization() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可检测");
  const all = await cookies.getAll(),
    expired = [],
    invalid = [],
    warning = [];
  for (const [id, cookie] of Object.entries(all)) {
    const until = Number(await auth.get(id, "0"));
    if (until <= Date.now() / 1000) expired.push(id);
    else if (until - Date.now() / 1000 < 86400) warning.push(id);
    try {
      await userDetail(cookie);
    } catch {
      invalid.push(id);
    }
  }
  return s.reply(
    `授权检测完成\nCK失效：${invalid.join(",") || "无"}\n未授权/过期：${expired.join(",") || "无"}\n一天内到期：${warning.join(",") || "无"}`,
  );
}
async function cronCheck() {
  const all = await cookies.getAll(),
    invalid = [],
    expired = [];
  for (const [id, cookie] of Object.entries(all)) {
    if (Number(await auth.get(id, "0")) <= Date.now() / 1000) expired.push(id);
    try {
      await userDetail(cookie);
    } catch {
      invalid.push(id);
    }
  }
  if (invalid.length || expired.length)
    await s.pushAdmin(`顿顿饿定时检测\nCK失效：${invalid.join(",") || "无"}\n授权过期：${expired.join(",") || "无"}`);
}

async function syncQingLong(id, cookie, owner) {
  try {
    const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 }),
      rows = rowsOf(await ql.getEnvs({ searchValue: String(cfg.env_name || "elmck") })),
      found = rows.find(
        (row) => row.name === String(cfg.env_name || "elmck") && String(row.remarks || row.remark || "").includes(id),
      ),
      payload = { name: String(cfg.env_name || "elmck"), value: cookie, remarks: `USERID:${id}|用户:${owner}` };
    if (found) {
      await ql.updateEnv({ ...payload, id: found.id || found._id });
      if (ql.enableEnvs) await ql.enableEnvs([found.id || found._id]);
    } else await ql.createEnv(payload);
    return true;
  } catch (error) {
    console.log(`顿顿饿同步青龙失败：${cleanError(error)}`);
    return false;
  }
}

async function ownedIds(owner) {
  owner = owner === undefined ? await uid() : owner;
  const direct = parseArray(await users.get(owner, "[]")),
    legacy = Object.entries(await owners.getAll())
      .filter(([, value]) => String(value) === String(owner))
      .map(([key]) => key);
  return [...new Set([...direct, ...legacy])];
}
async function select(ids, verb) {
  if (ids.length === 1) return [...ids];
  await s.reply(
    [
      `请选择要${verb}的账号：`,
      `【0】全部`,
      ...(await Promise.all(ids.map(async (id, i) => `【${i + 1}】${await label(id)}`))),
      "支持逗号或空格分隔，q退出",
    ].join("\n"),
  );
  const child = await s.listen({ timeout: 60000 });
  if (!child) return null;
  const value = String((await child.getMsg()) || "").trim();
  if (/^q$/i.test(value)) return null;
  const nums = value.split(/[,，\s]+/);
  if (nums.includes("0")) return [...ids];
  return [
    ...new Set(
      nums
        .map(Number)
        .filter((n) => n >= 1 && n <= ids.length)
        .map((n) => ids[n - 1]),
    ),
  ];
}
async function label(id) {
  return String(await remarks.get(id, "")) || display(id);
}
function display(id) {
  return String(id).length > 6 ? `${String(id).slice(0, 3)}***${String(id).slice(-3)}` : String(id);
}
function maskPhone(value) {
  return String(value).replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
}
function daysLeft(until) {
  return Math.max(0, (Number(until) - Date.now() / 1000) / 86400).toFixed(2);
}
function formatAssets(name, data, expires) {
  return [
    `=====饿了么资产=====`,
    `账号：${name}`,
    data.profile?.username ? `用户名：${data.profile.username}` : "",
    data.profile?.mobile ? `手机号：${maskPhone(data.profile.mobile)}` : "",
    data.todayCoin !== undefined ? `今日乐园币：${data.todayCoin}` : "",
    data.totalCoin !== undefined ? `总乐园币：${data.totalCoin}` : "",
    data.foodieToday !== undefined ? `今日吃货豆：${data.foodieToday}` : "",
    data.foodieTotal !== undefined ? `总吃货豆：${data.foodieTotal}` : "",
    data.wallet !== undefined ? `比比饭余额：${Number(data.wallet).toFixed(2)}` : "",
    expires ? `授权：${expires > Date.now() / 1000 ? `${daysLeft(expires)}天` : "已过期"}` : "未授权",
    "==================",
  ]
    .filter(Boolean)
    .join("\n");
}
function normalizeCookie(value) {
  return String(value || "")
    .replace(/：/g, ";")
    .replace(/\s+/g, "")
    .replace(/;+$/, ";");
}
function cookieValue(cookie, name) {
  return String(cookie).match(new RegExp(`(?:^|;)${name}=([^;]*)`))?.[1] || "";
}
async function json(url, options = {}) {
  const response = await fetch(String(url), { ...options, signal: AbortSignal.timeout(timeout()) }),
    text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口未返回JSON：${text.slice(0, 160)}`);
  }
}
function timeout() {
  return Number(cfg.timeout_ms) || 15000;
}
function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}
function parseArray(raw) {
  try {
    const value = JSON.parse(String(raw || "[]"));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}
function parseObject(raw) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}
function rowsOf(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}
async function uid() {
  return String((await s.getUserId()) || "");
}
function cleanError(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

main().catch((error) => s.reply(`顿顿饿执行失败：${cleanError(error)}`));

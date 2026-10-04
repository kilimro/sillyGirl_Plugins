// [title: 小米社区钱包]
// [name: xiaoMiQianBao]
// [desc: 小米钱包Cookie登录、serviceToken续期、视频会员时长任务查询与兑换]
// [author: linzixuan,yuhualhh,rujingxianghai]
// [version: v3.3.3]
// [rule: ^小米(教程|登录|管理|查询|任务|兑换|授权|清理)$]
// [cron: 0 10 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/小米社区_v4.4_By.rujingxianghai.py;backup/小米钱包_v2.7_By.linzixuan.py;backup/小米钱包-天天领视频会员_v3.3.3_By.yuhualhh.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { randomBytes, randomUUID } = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const BASE = "https://m.jr.airstarfinance.net/mp/api";
const ACTIVITY = "2211-videoWelfare";
const APP = "com.mipay.wallet";
const UA =
  "Mozilla/5.0 (Linux; U; Android 13; zh-CN; M2012K11AC Build/TKQ1.221114.001; AppBundle/com.mipay.wallet; AppVersionName/6.98.0.5484.2643; AppVersionCode/20577630; MiuiVersion/stable-V816.0.6.0.TKHCNXM; DeviceId/alioth; NetworkType/WIFI; mix_version; WebViewVersion/116.0.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/4.3";
const USER_EXTRA = JSON.stringify({
  platformType: 1,
  "com.miui.player": "4.38.0.2",
  "com.miui.video": "v2025082090(MiVideo-UN)",
  "com.mipay.wallet": "6.98.0.5484.2643",
});
const APP_LIMIT = JSON.stringify({
  "com.qiyi.video": false,
  "com.youku.phone": false,
  "com.tencent.qqlive": false,
  "com.hunantv.imgo.activity": false,
  "com.cmcc.cmvideo": false,
  "com.sankuai.meituan": true,
  "com.anjuke.android.app": false,
  "com.tal.abctimelibrary": false,
  "com.lianjia.beike": false,
  "com.kmxs.reader": false,
  "com.jd.jrapp": false,
  "com.smile.gifmaker": false,
  "com.kuaishou.nebula": false,
});

function parseCookie(raw) {
  if (raw && typeof raw === "object") return { ...raw };
  const text = String(raw || "").trim();
  if (text.startsWith("{")) {
    const value = JSON.parse(text);
    return parseCookie(value.cookie || value.cookies || value.token || value);
  }
  const result = {};
  for (const part of text.split(";")) {
    const cut = part.indexOf("=");
    if (cut > 0) result[part.slice(0, cut).trim()] = part.slice(cut + 1).trim();
  }
  if (!Object.keys(result).length && text.split("#").length >= 3) {
    const [userId, passToken, cUserId] = text.split("#");
    Object.assign(result, { userId, passToken, cUserId });
  }
  return result;
}
function cookieString(cookie) {
  return Object.entries(cookie)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}
function setCookies(headers, jar) {
  let values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (!values.length) {
    const one = headers.get("set-cookie");
    if (one) values = one.split(/,(?=\s*[^;,=]+=[^;,]+)/);
  }
  for (const value of values) {
    const first = value.split(";", 1)[0],
      cut = first.indexOf("=");
    if (cut > 0) jar[first.slice(0, cut).trim()] = first.slice(cut + 1).trim();
  }
}
async function refreshServiceToken(cookie, timeout = 20000) {
  if (cookie.jrairstar_serviceToken || cookie.serviceToken) return cookie;
  if (!cookie.userId || !cookie.passToken || !cookie.cUserId)
    throw new Error("CK需包含 userId、passToken、cUserId，或直接包含 jrairstar_serviceToken");
  const jar = { userId: cookie.userId, passToken: cookie.passToken };
  let url = `https://m.jr.airstarfinance.net/mp/api/login?from=mipay_indexicon_TVcard&deepLinkEnable=false&requestUrl=${encodeURIComponent(`https://m.jr.airstarfinance.net/mp/activity/videoActivity?from=mipay_indexicon_TVcard&_noDarkMode=true&_transparentNaviBar=true&cUserId=${cookie.cUserId}&_statusBarHeight=137`)}`;
  for (let hop = 0; hop < 12; hop++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*", cookie: cookieString(jar) },
      signal: AbortSignal.timeout(timeout),
    });
    setCookies(response.headers, jar);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) break;
    url = new URL(location, url).href;
  }
  const token = jar.jrairstar_serviceToken || jar.serviceToken;
  if (!token) throw new Error("未获取到 serviceToken，passToken 可能已失效");
  return { ...cookie, ...jar, cUserId: jar.cUserId || cookie.cUserId, jrairstar_serviceToken: token };
}
function deviceOf(saved) {
  if (saved?.oaid && saved?.androidId && saved?.regId) return saved;
  return {
    oaid: randomBytes(8).toString("hex"),
    androidId: randomBytes(8).toString("hex"),
    regId: `VC84PIuV8vlUt5+tqovAP47+miC3jz02IhFuY/${randomBytes(10).toString("hex")}=`,
  };
}
function sessionOf(token) {
  const parsed = typeof token === "string" && token.trim().startsWith("{") ? JSON.parse(token) : { cookie: token };
  return {
    cookie: parseCookie(parsed.cookie || parsed.token || token),
    device: deviceOf(parsed.device),
    tid: randomUUID(),
    phone: parsed.phone || "",
    remark: parsed.remark || "",
  };
}
async function prepare(ctx, token) {
  const session = sessionOf(token);
  session.cookie = await refreshServiceToken(session.cookie, ctx.config.timeout);
  return session;
}
function common(session) {
  return {
    tid: session.tid,
    app: APP,
    oaid: session.device.oaid,
    regId: session.device.regId,
    versionCode: "20577630",
    versionName: "6.98.0.5484.2643",
    isNfcPhone: "true",
    channel: "mipay_indexicon_TVcard",
    deviceType: "2",
    system: "1",
    visitEnvironment: "2",
    userExtra: USER_EXTRA,
    activityCode: ACTIVITY,
  };
}
async function api(ctx, session, path, options = {}) {
  const headers = {
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    cookie: cookieString(session.cookie),
    ...(options.headers || {}),
  };
  const result = await ctx.requestJson(`${BASE}${path}`, { ...options, headers });
  if (Number(result?.code) !== 0 || result?.success === false)
    throw new Error(result?.error || result?.message || `接口失败 code=${result?.code}`);
  return result?.value;
}
function params(value) {
  return new URLSearchParams(
    Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
async function summary(ctx, session) {
  const base = common(session);
  const [balance, history] = await Promise.all([
    api(ctx, session, `/generalActivity/queryUserGoldRichSum?${params(base)}`),
    api(ctx, session, `/generalActivity/queryUserJoinList?${params({ ...base, pageNum: 1, pageSize: 50 })}`),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const rows = Array.isArray(history?.data) ? history.data : [];
  const todayValue = rows
    .filter((item) => String(item?.createTime || "").startsWith(today) && Number(item?.value) > 0)
    .reduce((sum, item) => sum + Number(item.value), 0);
  return { balance: Number(balance || 0) / 100, today: todayValue / 100, rows };
}
function yimi(session) {
  return JSON.stringify({
    clientInfo: {
      deviceInfo: {
        androidVersion: "33",
        device: "alioth",
        miuiVersion: 816,
        miuiVersionName: "V816",
        model: "M2012K11AC",
        restrictImei: "true",
        screenHeight: 873,
        screenWidth: 393,
      },
      userInfo: {
        androidId: session.device.androidId,
        connectionType: "WIFI",
        oaid: session.device.oaid,
        country: "CN",
        isPersonalizedAdEnabled: true,
        language: "zh-rCN",
        ua: UA,
      },
      appInfo: { packageName: APP, version: "6.98.0.5484.2643" },
      context: { eid: "" },
      impRequests: [{ adsCount: 1, tagId: "1.140.4.1" }],
    },
  });
}
async function taskInfo(ctx, session, taskCode) {
  const form = {
    ...common(session),
    device: "alioth",
    appLimit: APP_LIMIT,
    pagination: "0",
    dataType: "0",
    yimiData: yimi(session),
    taskCode,
    componentStatus: "0",
    jrairstar_ph: session.cookie.jrairstar_ph || "",
  };
  const value = await api(ctx, session, "/generalActivity/getTask", { method: "POST", form });
  return value?.taskInfo || {};
}
async function draw(ctx, session, userTaskId) {
  const query = { ...common(session), imei: "", device: "alioth", appLimit: APP_LIMIT, userTaskId };
  return api(ctx, session, `/generalActivity/luckDraw?${params(query)}`);
}
async function firstVisit(ctx, session) {
  let info = await taskInfo(ctx, session, "FINANCE_FIRSTIN");
  if (!info || (Number(info.completeStatus) === 4 && Number(info.luckDrawStatus) === 2)) return false;
  if (Number(info.completeStatus) !== 4) {
    await api(ctx, session, `/generalActivity/visitIndex?tid=${session.tid}`, {
      method: "POST",
      form: { ...common(session), jrairstar_ph: session.cookie.jrairstar_ph || "" },
    });
    await sleep(1000);
    info = await taskInfo(ctx, session, "FINANCE_FIRSTIN");
  }
  if (Number(info?.completeStatus) === 4 && Number(info?.luckDrawStatus) === 1 && info.userTaskId) {
    await draw(ctx, session, info.userTaskId);
    return true;
  }
  return false;
}
async function runTasks(ctx, session) {
  let completed = 0,
    claimed = 0;
  if (await firstVisit(ctx, session)) claimed++;
  for (let round = 0; round < 6; round++) {
    const info = await taskInfo(ctx, session, "BROWSE_GROUP_TASK1");
    if (!info) break;
    const done = Number(info.periodCompleteCount || 0),
      total = Number(info.periodCount || 3);
    completed = done;
    if (done >= total) break;
    if (Number(info.luckDrawStatus) === 1 && info.userTaskId) {
      await draw(ctx, session, info.userTaskId);
      claimed++;
      continue;
    }
    if (!info.taskId || !info.taskCode) break;
    await sleep(12000 + Math.floor(Math.random() * 2000));
    const general = info.generalActivityUrlInfo || {},
      ad = general.yimiResponse || {},
      first = Array.isArray(ad.adInfos) ? ad.adInfos[0] : null;
    const query = {
      ...common(session),
      taskId: info.taskId,
      browsTaskId: general.id || info.taskId,
      browsClickUrlId: general.browsClickUrlId || 0,
      festivalStatus: "0",
      clickEntryType: first?.id && ad.triggerId ? "" : "undefined",
      adInfoId: first?.id,
      triggerId: ad.triggerId,
    };
    const userTaskId = await api(ctx, session, `/generalActivity/completeTask?${params(query)}`);
    completed++;
    if (userTaskId) {
      await draw(ctx, session, userTaskId);
      claimed++;
    }
    await sleep(1200);
  }
  const value = await summary(ctx, session);
  return { ...value, completed, claimed };
}
async function products(ctx, session) {
  const value = await api(
    ctx,
    session,
    `/generalActivity/getPrizeStatusV2?${params({ tid: session.tid, oaid: session.device.oaid, regId: session.device.regId, activityCode: ACTIVITY, needPrizeBrand: "youku,mgtv,iqiyi,tencent,bilibili,other" })}`,
  );
  return (Array.isArray(value) ? value : []).filter(
    (item) =>
      /会员|VIP|SVIP|月卡/i.test(String(item?.prizeName || "")) &&
      !/1分购|特权|优惠券|立减|优惠购/.test(String(item?.prizeName || "")),
  );
}
async function exchange(ctx, session, prizeCode, phone) {
  return api(
    ctx,
    session,
    `/generalActivity/convertGoldRich?${params({ tid: session.tid, oaid: session.device.oaid, regId: session.device.regId, prizeCode, activityCode: ACTIVITY, app: APP, channel: "mipay_unloadoff_TVcard", deviceType: "2", system: "1", visitEnvironment: "2", userExtra: USER_EXTRA, phone: phone || undefined })}`,
  );
}
async function ownedSessions(ctx) {
  const uid = await ctx.currentUserId(),
    accounts = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!accounts.length) throw new Error("未绑定小米钱包账号");
  return Promise.all(
    accounts.map(async (account) => ({
      account,
      item: { account, token: await ctx.tokens.get(account, ""), remark: await ctx.remarks.get(account, account) },
    })),
  );
}
async function handleTask(ctx) {
  const lines = [];
  for (const { item } of await ownedSessions(ctx)) {
    try {
      const result = await runTasks(ctx, await prepare(ctx, item.token));
      lines.push(
        `${item.remark}：完成${result.completed}，领奖${result.claimed}，今日${result.today.toFixed(2)}天，余额${result.balance.toFixed(2)}天`,
      );
    } catch (error) {
      lines.push(`${item.remark}：${error.message}`);
    }
  }
  return ctx.sender.reply(lines.join("\n"));
}
async function handleExchange(ctx) {
  const rows = await ownedSessions(ctx),
    target = rows[0].item,
    session = await prepare(ctx, target.token),
    list = await products(ctx, session);
  if (!list.length) return ctx.sender.reply("当前没有可直接兑换的会员商品");
  const choice = await ctx.prompt(
    ctx.sender,
    [
      `账号：${target.remark}`,
      ...list.map((item, i) => `[${i + 1}] ${item.prizeName}｜${Number(item.value || item.goldRich || 0) / 100}天`),
      "回复序号兑换，q退出",
    ].join("\n"),
    120000,
  );
  if (choice === null) return ctx.sender.reply("已退出");
  const item = list[Number(choice) - 1];
  if (!item) throw new Error("商品序号无效");
  let phone = "";
  if (item.needPhone || /手机|话费/.test(String(item.prizeName))) {
    phone = await ctx.prompt(ctx.sender, "请输入兑换手机号", 60000);
    if (!/^1[3-9]\d{9}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
  }
  const result = await exchange(ctx, session, item.prizeCode, phone);
  return ctx.sender.reply(
    `兑换成功：${item.prizeName}${result?.value ? `，消耗${Math.abs(Number(result.value)) / 100}天` : ""}${result?.prizeInfo?.couponId ? `\n券ID：${result.prizeInfo.couponId}` : ""}`,
  );
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rt = createAccountRuntime({
  title: "小米社区钱包",
  shortName: "小米",
  prefix: "dd_xiaomi_wallet",
  defaultEnvName: "XIAO_MI_QIAN_BAO",
  orderPrefix: "XM",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(
      ctx.sender,
      "请粘贴小米Cookie：userId、passToken、cUserId；也支持钱包 serviceToken Cookie。多账号请换行",
      120000,
    );
    if (raw === null) return [];
    const result = [];
    for (const [index, line] of raw
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .entries()) {
      const cut = line.indexOf("::"),
        remark = cut > 0 ? line.slice(0, cut).trim() : `小米账号${index + 1}`,
        source = cut > 0 ? line.slice(cut + 2).trim() : line;
      const cookie = await refreshServiceToken(parseCookie(source), ctx.config.timeout),
        device = deviceOf();
      const account = String(cookie.userId || cookie.cUserId || `xm_${index + 1}`),
        token = JSON.stringify({ cookie: cookieString(cookie), device, phone: account, remark });
      await summary(ctx, sessionOf(token));
      result.push({ account, token, remark });
    }
    return result;
  },
  async query(ctx, item) {
    const session = await prepare(ctx, item.token),
      value = await summary(ctx, session);
    return `💰 当前时长：${value.balance.toFixed(2)}天\n🔥 今日时长：${value.today.toFixed(2)}天\n🧾 最近记录：${value.rows.length}条`;
  },
  async handle(ctx, content) {
    if (/任务/.test(content)) return handleTask(ctx);
    if (/兑换/.test(content)) return handleExchange(ctx);
  },
  async cronCheck(ctx, item) {
    const result = await runTasks(ctx, await prepare(ctx, item.token));
    return `任务完成${result.completed}项，领奖${result.claimed}次，今日${result.today.toFixed(2)}天，余额${result.balance.toFixed(2)}天`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "Via浏览器登录 account.xiaomi.com 后复制包含 userId、passToken、cUserId 的Cookie，发送“小米登录”。“小米查询”查时长，“小米任务”执行每日浏览任务，“小米兑换”列出并兑换视频会员。",
});
rt.main().catch((error) => s.reply(`小米钱包执行失败：${error?.message || error}`));

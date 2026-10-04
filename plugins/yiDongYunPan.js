// [title: 移动云盘]
// [name: yiDongYunPan]
// [desc: 移动云盘认证续期、云朵/签到/奖品查询、兑换及青龙同步]
// [author: yuhualhh / sky2022]
// [version: v2.1.0]
// [rule: ^云盘(登录|查询|管理|兑换|一键抢兑|停止抢兑|教程|授权|清理)$]
// [cron: 18 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/移动云盘_v1.1.1_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22H71 MCloud/12.5.4";
const MARKET_UA = `${UA} MCloudApp/12.5.4`;
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; RMX5060 Build/BP2A.250605.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.13 Mobile Safari/537.36 MCloudApp/12.5.4 AppLanguage/zh-CN";
const MARKET = "https://m.mcloud.139.com";
const AES_KEY = "c7lXOigXahPnTViq";

function basic(phone, authToken) {
  return `Basic ${Buffer.from(`mobile:${phone}:${authToken}`).toString("base64")}`;
}

function parseCredential(raw, phoneHint = "") {
  const value = String(raw || "").trim();
  try {
    const data = JSON.parse(value);
    if (data && data.auth_token) return { phone: String(data.phone || phoneHint), authToken: String(data.auth_token) };
  } catch (_) {}
  let authorization = value,
    phone = phoneHint;
  const parts = value.split("#");
  if (parts.length >= 2 && /^1[3-9]\d{9}$/.test(parts.at(-1))) {
    phone = parts.pop();
    authorization = parts.join("#");
  } else if (parts.length === 2 && /^1[3-9]\d{9}$/.test(parts[0])) {
    phone = parts[0];
    return { phone, authToken: parts[1] };
  }
  authorization = authorization.replace(/^Basic\s+/i, "");
  try {
    const decoded = Buffer.from(authorization, "base64").toString("utf8");
    const match = decoded.match(/^mobile:(1[3-9]\d{9}):(.+)$/s);
    if (match) return { phone: match[1], authToken: match[2] };
  } catch (_) {}
  if (phone && authorization) return { phone, authToken: authorization };
  throw new Error("凭证格式应为 Basic凭证#手机号、手机号#authToken 或 JSON");
}

function aesEcb(text) {
  const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(AES_KEY), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]).toString("base64");
}

function device() {
  const deviceId = Buffer.from(
    JSON.stringify({
      deviceId: crypto.randomUUID().replace(/-/g, "").toUpperCase(),
      brand: "Apple",
      model: "iPhone 16 Pro",
      system: "iOS 18.7",
      timestamp: Date.now(),
    }),
  ).toString("base64");
  return { deviceId, xDeviceInfo: `wifi||8|12.5.4|Apple|iPhone 16 Pro|${deviceId}||ios 18.7|||||` };
}

async function refresh(ctx, phone, authToken) {
  const data = await ctx.requestJson("https://user-njs.yun.139.com/user/auth/refreshToken", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      authorization: basic(phone, authToken),
      "x-yun-tid": crypto.randomUUID(),
      "x-yun-api-version": "v1",
      "x-yun-module-type": "100",
      "x-yun-op-type": "1",
      "x-yun-app-channel": "10214200",
      "x-yun-client-info": "||8||||||||||||",
      "hcy-cool-flag": "1",
    },
    json: { data: aesEcb(JSON.stringify({ phoneNumber: phone })) },
  });
  const code = String(data?.code ?? "");
  return (/^(0|00|000|0000)$/.test(code) || data?.success) && data?.data?.token ? String(data.data.token) : "";
}

async function session(ctx, phone, authToken) {
  const sso = await ctx.requestJson("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: {
      authorization: basic(phone, authToken),
      "user-agent": UA,
      "content-type": "application/json",
      accept: "*/*",
    },
    json: { account: phone, toSourceId: "001005" },
  });
  const ssoToken = sso?.success && sso?.data?.token;
  if (!ssoToken) throw new Error(sso?.message || "authToken已失效");
  const jwt = await ctx.requestJson(
    `https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(ssoToken)}`,
    { method: "POST", headers: { "user-agent": UA, accept: "*/*" } },
  );
  const jwtToken = Number(jwt?.code) === 0 && jwt?.result?.token;
  if (!jwtToken) throw new Error(jwt?.msg || "JWT登录失败");
  const dev = device();
  const referer = `${MARKET}/portal/mobilecloud/index.html?path=newsignin&sourceid=1097&enableShare=1&token=${encodeURIComponent(ssoToken)}&targetSourceId=001005`;
  return {
    phone,
    authToken,
    ssoToken,
    jwtToken,
    ...dev,
    headers: {
      "user-agent": MARKET_UA,
      accept: "*/*",
      jwtToken,
      "x-requested-with": "com.chinamobile.mcloud",
      referer,
      deviceId: dev.deviceId,
      "x-deviceinfo": dev.xDeviceInfo,
      cookie: `jwtToken=${jwtToken}`,
    },
  };
}

async function cloudInfo(ctx, ss) {
  const data = await ctx.requestJson(`${MARKET}/ycloud/signin/page/infoV3?client=app`, { headers: ss.headers });
  if (Number(data?.code) !== 0) throw new Error(data?.msg || "云朵信息查询失败");
  const result = data.result || {};
  let today = result.todaySignIn;
  if (today == null) today = (result.cal || []).find((day) => day?.t)?.s;
  return {
    total: result.total || 0,
    toReceive: result.toReceive || 0,
    todaySignIn: Boolean(today),
    continuous: result.continuous || 0,
  };
}

async function prizes(ctx, ss) {
  const data = await ctx.requestJson(
    `https://caiyun.feixin.10086.cn/market/prizeApi/checkPrize/getUserPrizeLogPage?currPage=1&pageSize=15&_=${Date.now()}`,
    { headers: { "user-agent": UA, accept: "*/*", jwtToken: ss.jwtToken, cookie: `jwtToken=${ss.jwtToken}` } },
  );
  return (data?.result?.result || [])
    .filter((item) => Number(item?.flag) === 1)
    .map((item) => item?.prizeName)
    .filter(Boolean);
}

async function exchangeList(ctx, ss) {
  const data = await ctx.requestJson(`${MARKET}/ycloud/signin/page/exchangeList`, { headers: ss.headers });
  if (Number(data?.code) !== 0) throw new Error(data?.msg || "兑换列表查询失败");
  return Object.values(data?.result || {})
    .flat()
    .filter((item) => Number(item?.groupId) !== 10);
}

async function puzzleOffset(ctx, ss) {
  try {
    const id = ss.deviceId.startsWith("B") ? ss.deviceId : `B${ss.deviceId}`;
    const data = await ctx.requestJson(`${MARKET}/ycloud/auth-service/slide/getSlide`, {
      method: "POST",
      headers: {
        ...ss.headers,
        "user-agent": ANDROID_UA,
        deviceId: id,
        appVersion: "12.5.4.0",
        activityId: "sign_in_3",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      form: {},
    });
    if (!data?.result?.puzzle || !data?.result?.picture) return 257;
    const ocr = await ctx.requestJson("http://ddddocr.250666.xyz/capcode", {
      method: "POST",
      json: { slidingImage: data.result.puzzle, backImage: data.result.picture, simpleTarget: true },
    });
    const offset = Math.trunc(Number(ocr?.result));
    return offset > 0 ? offset : 257;
  } catch (_) {
    return 257;
  }
}

async function exchange(ctx, ss, prizeId) {
  const id = ss.deviceId.startsWith("B") ? ss.deviceId : `B${ss.deviceId}`;
  const thumb = encodeURIComponent(id.slice(1)),
    md5 = crypto.createHash("md5").update(ss.phone).digest("hex"),
    offset = await puzzleOffset(ctx, ss);
  const url = `${MARKET}/ycloud/signin/page/exchangeV2?prizeId=${encodeURIComponent(prizeId)}&client=app&clientVersion=12.5.4&puzzleOffset=${offset}&smsCode=`;
  const data = await ctx.requestJson(url, {
    headers: {
      ...ss.headers,
      "user-agent": ANDROID_UA,
      deviceId: id,
      appVersion: "12.5.4.0",
      activityId: "sign_in_3",
      cookie: `jwtToken=${ss.jwtToken}; .thumbcache_${md5}=${thumb}`,
    },
  });
  return {
    success: Number(data?.code) === 0,
    message: Number(data?.code) === 0 ? "兑换成功" : String(data?.msg || "兑换失败"),
  };
}

async function loadOwnedItem(ctx) {
  const userId = await ctx.currentUserId(),
    accounts = JSON.parse((await ctx.users.get(userId, "[]")) || "[]");
  if (!accounts.length) throw new Error("未绑定移动云盘账号");
  let account = accounts[0];
  if (accounts.length > 1) {
    const input = await ctx.prompt(
      ctx.sender,
      accounts.map((v, i) => `[${i + 1}] ${v.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}`).join("\n"),
      120000,
    );
    account = accounts[Number(input) - 1];
    if (!account) throw new Error("账号选择无效");
  }
  return { account, token: String(await ctx.tokens.get(account, "")) };
}

const runtime = createAccountRuntime({
  title: "移动云盘",
  shortName: "云盘",
  prefix: "dd_ydyp",
  defaultEnvName: "ydyp",
  requireAuthForQuery: false,
  tutorial:
    "发送“云盘登录”，依次输入手机号与 authToken；也兼容 Basic凭证#手机号、手机号#authToken、JSON。指令：云盘查询、云盘兑换、云盘管理。",
  async login(ctx) {
    const first = await ctx.prompt(
      ctx.sender,
      "请输入手机号，或直接提交 Basic凭证#手机号 / 手机号#authToken / JSON",
      120000,
    );
    if (first == null) return [];
    let parsed;
    if (/^1[3-9]\d{9}$/.test(first)) {
      const token = await ctx.prompt(ctx.sender, "请输入 authToken", 120000);
      if (!token) throw new Error("未输入authToken");
      parsed = { phone: first, authToken: token };
    } else parsed = parseCredential(first);
    const renewed = await refresh(ctx, parsed.phone, parsed.authToken).catch(() => "");
    if (renewed) parsed.authToken = renewed;
    await session(ctx, parsed.phone, parsed.authToken);
    return {
      account: parsed.phone,
      token: JSON.stringify({ phone: parsed.phone, auth_token: parsed.authToken }),
      remark: parsed.phone,
    };
  },
  async query(ctx, item) {
    const parsed = parseCredential(item.token, item.account),
      renewed = await refresh(ctx, parsed.phone, parsed.authToken).catch(() => "");
    if (renewed) {
      parsed.authToken = renewed;
      await ctx.tokens.set(item.account, JSON.stringify({ phone: parsed.phone, auth_token: renewed }));
    }
    const ss = await session(ctx, parsed.phone, parsed.authToken),
      info = await cloudInfo(ctx, ss),
      waiting = await prizes(ctx, ss);
    return `☁️ 云朵：${info.total}\n📥 待领取：${info.toReceive}\n📅 今日签到：${info.todaySignIn ? "已签到" : "未签到"}\n🔥 连续签到：${info.continuous}天\n🎁 待领奖品：${waiting.length ? waiting.join("、") : "无"}`;
  },
  async envValue(_ctx, item) {
    const p = parseCredential(item.token, item.account);
    return `${basic(p.phone, p.authToken)}#${p.phone}`;
  },
  async handle(ctx, content) {
    if (!/兑换|一键抢兑/.test(content)) return;
    const item = await loadOwnedItem(ctx),
      p = parseCredential(item.token, item.account),
      ss = await session(ctx, p.phone, p.authToken),
      list = await exchangeList(ctx, ss);
    if (!list.length) return ctx.sender.reply("当前没有可兑换奖品");
    const lines = list.map(
      (v, i) => `[${i + 1}] ${v.prizeName || v.name || v.prizeId}（${v.cloudCount || v.needCloud || "?"}云朵）`,
    );
    const choice = await ctx.prompt(ctx.sender, `${lines.join("\n")}\n请输入奖品序号`, 120000),
      target = list[Number(choice) - 1];
    if (!target) return ctx.sender.reply("奖品选择无效");
    const result = await exchange(ctx, ss, target.prizeId || target.id);
    return ctx.sender.reply(`${target.prizeName || target.name || "奖品"}：${result.message}`);
  },
});

runtime
  .main()
  .catch((error) => runtime.sender.reply(`移动云盘处理失败：${String(error?.message || error).slice(0, 300)}`));

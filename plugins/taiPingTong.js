// [title: 太平通]
// [name: taiPingTong]
// [desc: 太平通短信/CK登录、签到、任务领奖、金币气泡及积分查询]
// [author: linzixuan]
// [version: v6.61.0]
// [rule: ^太平(上车|登录|管理|查询|运行|教程|授权|清理)$]
// [cron: 10 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/太平通_vV6.60_By.linzixuan.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://ecustomer.cntaiping.com",
  UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 4 XL Build/TP1A.220905.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36;yuangongejia#android#kehutong;webank/h5face;webank/1.0;netType:NETWORK_WIFI;appVersion:334;packageName:com.cntaiping.tpapp";
function device() {
  return `${crypto.randomBytes(4).toString("hex")}-${crypto.randomBytes(6).toString("hex")}-${crypto.randomBytes(4).toString("hex")}-${crypto.randomBytes(4).toString("hex").slice(0, 7)}-${crypto.randomBytes(6).toString("hex")}`;
}
function headers(token = "", id = device()) {
  return {
    accept: "application/json;charset=UTF-8",
    origin: "https://ecustomercdn.itaiping.com",
    referer: "https://ecustomercdn.itaiping.com/",
    "user-agent": UA,
    "x-ac-device-id": id,
    anonymousId: id,
    "x-ac-channel-id": "KHT",
    "x-ac-mc-type": "gateway.user",
    "x-ac-utm": "11810",
    "x-ac-token-ticket": token,
    "x-ac-black-box": "jWPVu1713323931keU0txvxzkc",
    "content-type": "application/json",
  };
}
async function account(ctx, token) {
  const r = await ctx.requestJson(`${BASE}/tpayms/app/tpay/account/getAcct`, { headers: headers(token) });
  if (!r?.success || !r?.data?.userId) throw new Error(r?.msg || r?.message || "CK失效");
  return {
    userId: String(r.data.userId),
    name: r.data.userName || r.data.nickName || r.data.mobile || String(r.data.userId),
    raw: r.data,
  };
}
async function smsLogin(ctx, phone) {
  const h = headers(""),
    start = await ctx.request(`${BASE}/userms/anonymous/startup/notify`, { headers: h });
  if (start.status !== 200) throw new Error("登录初始化失败");
  await ctx.requestJson(`${BASE}/userms/unifiedLogin/captcha/switch/v2`, {
    method: "POST",
    headers: h,
    json: { mobile: phone, internatCode: "0086", businessCode: "LOGIN" },
  });
  const sent = await ctx.requestJson(`${BASE}/commonms/unifiedLogin/msg/verifyCodeSms`, {
    method: "POST",
    headers: h,
    json: { mobile: phone, internatCode: "0086", businessCode: "LOGIN", serviceType: "KHTBASIC", type: "QUICKLOGON" },
  });
  if (!(sent?.success || String(sent?.code) === "0000"))
    throw new Error(sent?.message || sent?.msg || "验证码发送失败");
  const code = await ctx.prompt(ctx.sender, "验证码已发送，请输入6位验证码", 120000);
  if (!/^\d{6}$/.test(String(code || ""))) throw new Error("验证码格式错误");
  const r = await ctx.requestJson(`${BASE}/userms/anonymous/auth/unifiedLog/loginByMobileVerifyCode/v1`, {
    method: "POST",
    headers: h,
    json: {
      phone,
      internatCode: "0086",
      verificationcode: code,
      x_agentcode: "1762724346751963136",
      userSysType: "UNIFORM_USER",
      userSource: "TPT_WEB",
    },
  });
  if (!r?.success || String(r?.code) !== "0000" || !r?.data?.authToken)
    throw new Error(r?.message || r?.desc || "验证码登录失败");
  return { account: String(r.data.userId), token: String(r.data.authToken), remark: phone };
}
async function post(ctx, token, path, json = {}) {
  const r = await ctx.requestJson(`${BASE}${path}`, { method: "POST", headers: headers(token), json });
  if (!r?.success && /过期|失效|登录/.test(String(r?.msg || r?.message || ""))) throw new Error(r?.msg || r?.message);
  return r;
}
async function points(ctx, token) {
  const [sum, detail] = await Promise.all([
      post(ctx, token, "/campaignsms/integral/queryUserPoints", { sourceOrganId: "932" }),
      post(ctx, token, "/campaignsms/integral/queryIntegralDetailList", { pageNo: 1, pageSize: 100, typePo: "3" }),
    ]),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  let earned = 0,
    browse = 0,
    friend = 0,
    daily = 0;
  for (const x of detail?.data?.list || []) {
    if (String(x.effectDate).slice(0, 10) !== today) continue;
    earned += Number(x.num) || 0;
    if (x.memo === "浏览资讯") browse++;
    else if (x.memo === "好友阅读") friend++;
    else if (["给太平树浇水", "分享海报", "回执签收", "邀请注册"].includes(x.memo)) daily++;
  }
  return { available: sum?.data?.scoreAccountInfo?.availableScore || 0, earned, browse, friend, daily };
}
async function runTasks(ctx, token) {
  const logs = [];
  const sign = await post(ctx, token, "/campaignsms/couponAndsign", {});
  logs.push(sign?.success ? "签到完成" : sign?.msg || "签到未完成");
  const list = await post(ctx, token, "/campaignsms/goldParty/task/list", {
    activityNumber: "goldCoinParty",
    rewardFlag: "1",
    openMsgRemind: 0,
  });
  for (const task of list?.data?.taskList || []) {
    if (task.name === "浏览资讯" || Number(task.taskStatus) === 2) continue;
    if (Number(task.taskStatus) === 0)
      await post(ctx, token, "/campaignsms/goldParty/task/finish", { taskIds: [task.taskId] });
    const add = await post(ctx, token, "/campaignsms/goldParty/goldCoin/add", { taskIds: [task.taskId] });
    logs.push(`${task.name}:${add?.success ? "已领取" : add?.msg || "跳过"}`);
  }
  const bubbles = await post(ctx, token, "/campaignsms/coinBubble/queryList", {});
  if (Array.isArray(bubbles?.data) && bubbles.data.length) {
    const got = await post(ctx, token, "/campaignsms/coinBubble/getAllCoins", {});
    logs.push(got?.success ? "金币气泡已领取" : got?.msg || "气泡领取失败");
  }
  const p = await points(ctx, token);
  return { logs, p };
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    all = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!all.length) throw new Error("未绑定太平通账号");
  const key = all[0];
  return {
    account: key,
    token: String(await ctx.tokens.get(key, "")),
    remark: String(await ctx.remarks.get(key, key)),
  };
}
const rt = createAccountRuntime({
  title: "太平通",
  shortName: "太平",
  prefix: "bd_tpt",
  defaultEnvName: "TPT",
  orderPrefix: "TPT",
  requireAuthForQuery: false,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "请输入11位手机号走短信登录，或直接粘贴 x-ac-token-ticket；支持CK多行",
      120000,
    );
    if (input === null) return [];
    if (/^1[3-9]\d{9}$/.test(input)) return smsLogin(ctx, input);
    const out = [];
    for (const ck of input
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const a = await account(ctx, ck);
      out.push({ account: a.userId, token: ck, remark: a.name });
    }
    return out;
  },
  async query(ctx, item) {
    const a = await account(ctx, item.token),
      p = await points(ctx, item.token);
    return `👤 用户：${a.name}\n🪙 当前金币：${p.available}\n📈 今日金币：${p.earned}\n📰 浏览资讯：${p.browse}\n👥 好友阅读：${p.friend}\n✅ 日常任务：${p.daily}`;
  },
  async handle(ctx, c) {
    if (!/运行/.test(c)) return;
    const item = await owned(ctx),
      r = await runTasks(ctx, item.token);
    return ctx.sender.reply(
      `${item.remark}运行完成\n${r.logs.join("\n")}\n今日金币:${r.p.earned}\n当前金币:${r.p.available}`,
    );
  },
  async cronCheck(ctx, item) {
    const r = await runTasks(ctx, item.token);
    return `运行完成，今日金币${r.p.earned}，当前金币${r.p.available}`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial:
    "发送太平上车：输入手机号可短信验证码登录，也可直接提交抓包所得 x-ac-token-ticket。太平查询查看金币，太平运行执行签到、日常领奖和金币气泡。",
});
rt.main().catch((e) => s.reply(`太平通执行失败：${e?.message || e}`));

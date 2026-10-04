// [title: 酷我Music]
// [name: kuWoMusic]
// [desc: 酷我账号密码及验证码登录、金币/今日收入/提现流水查询、授权与面板同步]
// [author: sky2022]
// [version: v1.4.0]
// [rule: ^(酷我登录|酷我登陆|登陆酷我|登录酷我|酷我查询|查询酷我|酷我管理|管理酷我|酷我教程|酷我说明|酷我授权|酷我清理)$]
// [cron: 20 18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/q002-酷我音乐_v1.1.0_By.yueiqiu4523.py;backup/酷我Music_v1.3.9_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const WEB_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.95 Safari/537.36",
  H5_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KWMusic/11.1.2.0";
function parseLogin(v) {
  const p = String(v).trim().split("#");
  if (!/^1[3-9]\d{9}$/.test(p[0]) || p.length !== 2) throw new Error("格式应为 手机号#密码");
  return { phone: p[0], password: p[1] };
}
function parseToken(v) {
  const p = String(v).split("#");
  if (p.length !== 4) throw new Error("酷我凭证字段不完整");
  return { appUid: p[0], devId: p[1], loginSid: p[2], phone: p[3] };
}
async function login(ctx, raw) {
  const p = parseLogin(raw),
    cap = await ctx.requestJson(
      "http://www.kuwo.cn/api/common/captcha/getcode?reqId=bb7dd120-d1b7-11ef-b9c9-9dd176f54932&httpsStatus=1",
      {
        headers: { "user-agent": WEB_UA, accept: "application/json, text/plain, */*", referer: "http://www.kuwo.cn/" },
      },
    ),
    image = cap?.data?.img,
    verifyToken = cap?.data?.token;
  if (!image || !verifyToken) throw new Error("获取验证码失败");
  const ocr = await ctx.requestJson("https://ddddocr.linzixuan.work/classification", {
      method: "POST",
      json: { image: String(image).replace(/^data:image\/(jpeg|png);base64,/, "") },
    }),
    verifyCode = String(ocr?.result || "").trim();
  if (!verifyCode) throw new Error("验证码识别失败");
  const result = await ctx.requestJson("https://wapi.kuwo.cn/api/www/login/loginByKw?httpsStatus=1", {
    method: "POST",
    headers: {
      "user-agent": WEB_UA,
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      origin: "http://www.kuwo.cn",
      referer: "http://www.kuwo.cn/",
    },
    json: {
      userIp: "www.kuwo.cn",
      uname: p.phone,
      password: p.password,
      verifyCode,
      img: image,
      verifyCodeToken: verifyToken,
    },
  });
  if (Number(result?.code) !== 200) throw new Error(result?.msg || "登录失败");
  const cookies = result?.data?.cookies || {},
    appUid = String(result?.data?.uid || cookies.userid || ""),
    loginSid = String(cookies.websid || "");
  if (!appUid || !loginSid) throw new Error("登录响应缺少uid或websid");
  return {
    account: p.phone,
    remark: cookies.uname3 || p.phone,
    token: `${appUid}#${crypto.randomBytes(8).toString("hex")}#${loginSid}#${p.phone}`,
  };
}
function params(a) {
  return new URLSearchParams({
    uuid: a.devId,
    newver: "3",
    corp: "kuwo",
    uid: a.appUid,
    loginSid: a.loginSid,
    plat: "ip",
    source: "kwplayer_ip_11.1.2.0_TJ.ipa",
    loginUid: a.appUid,
    prod: "kwplayer_ip_11.1.2.0",
    user: a.devId,
    locationid: "1",
  }).toString();
}
function authHeaders(a) {
  return {
    accept: "*/*",
    cookie: `tmeAppID=kwplayer;loginSid=${a.loginSid};ct=1;newdevicelevel=0;deviceScore=0;loginUid=${a.appUid};cv=11120;chid=TJ;os_ver=17.7.2;user=${a.devId};nettype=WiFi;appUid=${a.appUid}`,
    "user-agent": "KWPlayer/11.1.2 (iPhone; iOS 17.7.2; Scale/3.00)",
  };
}
async function gold(ctx, a) {
  const status = await ctx.requestJson(`https://integralapi.kuwo.cn/api/v1/online/sign/new/todayStatus?${params(a)}`, {
    headers: authHeaders(a),
  });
  if (Number(status?.code) !== 200) throw new Error(status?.msg || "金币查询失败");
  let today = 0,
    page = 1,
    more = true;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  while (more && page <= 10) {
    const r = await ctx.requestJson(
        `https://integralapi.kuwo.cn/api/v1/online/sign/v1/earningSignIn/userGoldDetail?userId=${a.appUid}&loginSid=${encodeURIComponent(a.loginSid)}&pn=${page}&rn=50`,
        {
          headers: {
            "user-agent": H5_UA,
            origin: "https://h5app.kuwo.cn",
            accept: "application/json, text/plain, */*",
          },
        },
      ),
      list = r?.data?.list || [];
    if (Number(r?.code) !== 200 || !list.length) break;
    let found = false;
    for (const x of list) {
      if (!x.dateTime) continue;
      const d = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(x.dateTime));
      if (d === date) {
        found = true;
        const n = Number(x.amount) || 0;
        if (n > 0) today += n;
      }
    }
    more = found;
    page++;
  }
  return { total: status.data?.remainScore || 0, today };
}
async function history(ctx, a) {
  const r = await ctx.requestJson(
    `https://integralapi.kuwo.cn/api/v1/online/sign/v1/withdrawDetails?loginUid=${a.appUid}&loginSid=${encodeURIComponent(a.loginSid)}&pn=1&rn=2`,
    { headers: { "user-agent": H5_UA, origin: "https://h5app.kuwo.cn", accept: "application/json, text/plain, */*" } },
  );
  if (Number(r?.code) !== 200) return [];
  return (r?.data?.list || []).map((x) => ({
    amount: x.amount || 0,
    time: x.dateTime
      ? new Date(x.dateTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
      : "未知",
    status: { 0: "处理中", 1: "成功", 2: "失败" }[Number(x.status)] || "未知",
  }));
}
const rt = createAccountRuntime({
  title: "酷我Music",
  shortName: "酷我",
  prefix: "dd_Kuwo",
  defaultEnvName: "Kuwo",
  orderPrefix: "KW",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入 手机号#密码，支持多行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean))
      out.push(await login(ctx, line));
    return out;
  },
  async query(ctx, item) {
    const a = parseToken(item.token),
      g = await gold(ctx, a),
      h = await history(ctx, a);
    return `📱 账号：${a.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}\n🪙 总金币：${g.total}\n📈 今日收入：${g.today}${h.length ? `\n💸 最近提现：\n${h.map((x) => `${x.amount}元｜${x.time}｜${x.status}`).join("\n")}` : "\n💸 最近提现：暂无"}`;
  },
  async cronCheck(ctx, item) {
    const g = await gold(ctx, parseToken(item.token));
    return `账号有效，总金币${g.total}，今日收入${g.today}`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial:
    "发送酷我登录并输入手机号#密码，插件自动获取并识别验证码；查询返回总金币、今日收入和最近两条提现记录。支持授权、管理和面板同步。",
});
rt.main().catch((e) => s.reply(`酷我执行失败：${e?.message || e}`));

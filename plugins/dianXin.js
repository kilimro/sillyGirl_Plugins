// [title: 电信]
// [name: dianXin]
// [desc: 中国电信账号密码登录、ticket/sign、金豆、签到及宠物成长查询]
// [author: sky2022]
// [version: v2.5.0]
// [rule: ^(电信|dx)(登录|登陆|查询|管理|授权|清理|教程|同步)$|^登(录|陆)(电信|dx)$|^(查询|管理)(电信|dx)$|^电信$]
// [cron: 56 8,15 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/电信_v2.4_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC+ugG5A8cZ3FqUKDwM57GM4io6JGcStivT8UdGt67PEOihLZTw3P7371+N47PrmsCpnTRzbTgcupKtUv8ImZalYk65dU8rjC/ridwhw9ffW2LBwvkEnDkkKKRi2liWIItDftJVBiWOh17o6gfbPoNrWORcAdcbpk2L+udld5kZNwIDAQAB
-----END PUBLIC KEY-----`,
  LOGIN_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIbDQEBAQUAA4GNADCBiQKBgQDBkLT15ThVgz6/NOl6s8GNPofdWzWbCkWnkaAm7O2LjkM1H7dMvzkiqdxU02jamGRHLX/ZNMCXHnPcW/sDhiFCBN18qFvy8g6VYb9QtroI09e176s+ZCtiv7hbin2cCTj99iUpnEloZm19lwHyo69u5UMiPMpq0/XKBO8lYhN/gwIDAQAB
-----END PUBLIC KEY-----`,
  DES_KEY = Buffer.from("1234567`90koiuyhgtfrdews"),
  DES_IV = Buffer.alloc(8),
  UA = "Mozilla/5.0 (Linux; Android 13; 22081212C) AppleWebKit/537.36 Chrome/104.0.5112.97 Mobile Safari/537.36";
function parse(v) {
  const i = String(v).indexOf("#");
  if (i < 1 || !/^1[3-9]\d{9}$/.test(String(v).slice(0, i))) throw new Error("格式应为 手机号#服务密码");
  return { phone: String(v).slice(0, i), password: String(v).slice(i + 1) };
}
function encPhone(v) {
  return [...v].map((x) => String.fromCharCode(x.charCodeAt(0) + 2)).join("");
}
function rsa(text, key = KEY, hex = true) {
  const src = Buffer.from(typeof text === "string" ? text : JSON.stringify(text)),
    out = [];
  for (let i = 0; i < src.length; i += 117)
    out.push(crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, src.subarray(i, i + 117)));
  const b = Buffer.concat(out);
  return b.toString(hex ? "hex" : "base64");
}
function des(text, decrypt = false) {
  if (decrypt) {
    const d = crypto.createDecipheriv("des-ede3-cbc", DES_KEY, DES_IV);
    return Buffer.concat([d.update(Buffer.from(text, "hex")), d.final()]).toString();
  }
  const c = crypto.createCipheriv("des-ede3-cbc", DES_KEY, DES_IV);
  return Buffer.concat([c.update(text), c.final()]).toString("hex");
}
function aes(data) {
  const c = crypto.createCipheriv("aes-128-ecb", Buffer.from("34d7cb0bcdf07523"), null);
  return Buffer.concat([c.update(JSON.stringify(data)), c.final()]).toString("hex");
}
async function login(ctx, p) {
  const now = new Date(),
    ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`,
    id = crypto.randomBytes(8).toString("hex"),
    auth = `iPhone 14 15.4.${id}${id.slice(0, 4)}${p.phone}${ts}${p.password.slice(0, 6)}0$$$0.`,
    payload = {
      headerInfos: {
        code: "userLoginNormal",
        timestamp: ts,
        broadAccount: "",
        broadToken: "",
        clientType: "#11.3.0#channel50#iPhone 14 Pro Max#",
        shopId: "20002",
        source: "110003",
        sourcePassword: "Sid98s",
        token: "",
        userLoginName: encPhone(p.phone),
      },
      content: {
        attach: "test",
        fieldData: {
          loginType: "4",
          accountType: "",
          loginAuthCipherAsymmertric: rsa(auth, LOGIN_KEY, false),
          deviceUid: id + id.slice(0, 8),
          phoneNum: encPhone(p.phone),
          isChinatelecom: "0",
          systemVersion: "15.4.0",
          authentication: encPhone(p.password),
        },
      },
    },
    r = await ctx.requestJson("https://appgologin.189.cn:9031/login/client/userLoginNormal", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json" },
      json: payload,
    }),
    data = r?.responseData?.data?.loginSuccessResult;
  if (!data?.userId || !data?.token) throw new Error(r?.responseData?.resultDesc || "电信登录失败");
  const xml = `<Request><HeaderInfos><Code>getSingle</Code><Timestamp>${ts}</Timestamp><BroadAccount></BroadAccount><BroadToken></BroadToken><ClientType>#9.6.1#channel50#iPhone 14 Pro Max#</ClientType><ShopId>20002</ShopId><Source>110003</Source><SourcePassword>Sid98s</SourcePassword><Token>${data.token}</Token><UserLoginName>${p.phone}</UserLoginName></HeaderInfos><Content><Attach>test</Attach><FieldData><TargetId>${des(String(data.userId))}</TargetId><Url>4a6862274835b451</Url></FieldData></Content></Request>`,
    tr = await ctx.request("https://appgologin.189.cn:9031/map/clientXML", {
      method: "POST",
      headers: { "user-agent": "CtClient;10.4.1;Android;13;22081212C", "content-type": "application/xml" },
      body: xml,
    }),
    ticketEnc = tr.text.match(/<Ticket>(.*?)<\/Ticket>/s)?.[1];
  if (!ticketEnc) throw new Error("获取ticket失败");
  const ticket = des(ticketEnc, true),
    sg = await ctx.requestJson(`https://wappark.189.cn/jt-sign/ssoHomLogin?ticket=${encodeURIComponent(ticket)}`, {
      headers: { "user-agent": UA },
    });
  if (String(sg?.resoultCode) !== "0" || !sg?.sign) throw new Error(sg?.message || "获取sign失败");
  return { ...p, userId: String(data.userId), token: data.token, ticket, sign: sg.sign, accId: sg.accId };
}
async function signedPost(ctx, a, path, body) {
  return ctx.requestJson(`https://wappark.189.cn/jt-sign${path}`, {
    method: "POST",
    headers: { "user-agent": UA, sign: a.sign, "content-type": "application/json" },
    json: body,
  });
}
async function query(ctx, a) {
  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" })
      .format(new Date())
      .slice(0, 7),
    [coin, days, check, pet] = await Promise.all([
      signedPost(ctx, a, "/api/home/userCoinInfo", { para: rsa({ phone: a.phone }) }),
      signedPost(ctx, a, "/api/signInfo", { para: rsa({ phone: a.phone, checkDate: ym }) }),
      signedPost(ctx, a, "/webSign/sign", { encode: aes({ phone: a.phone, sysType: "", date: String(Date.now()) }) }),
      signedPost(ctx, a, "/paradise/getParadiseInfo", { para: rsa({ phone: a.phone }) }),
    ]),
    level = pet?.userInfo?.levelInfoMap || {};
  if (Number(coin?.code) === 401) throw new Error("电信sign已过期");
  return {
    coin: coin?.totalCoin || 0,
    days: (days?.data?.signInfo || []).filter((x) => x.state === "Y").length,
    signMessage: check?.data?.msg || check?.msg || "",
    level: level.level || 0,
    growth: level.growthValue || 0,
    full: level.fullGrowthCoinValue || 0,
  };
}
const rt = createAccountRuntime({
  title: "电信",
  shortName: "电信",
  prefix: "dd_dx",
  defaultEnvName: "dxToken",
  orderPrefix: "DX",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入 手机号#服务密码，支持多行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const p = parse(line),
        a = await login(ctx, p),
        q = await query(ctx, a);
      out.push({ account: p.phone, token: line, remark: `${p.phone} 金豆${q.coin}` });
    }
    return out;
  },
  async query(ctx, item) {
    const p = parse(item.token),
      a = await login(ctx, p),
      q = await query(ctx, a);
    return `📱 账号：${p.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}\n🪙 金豆：${q.coin}\n📅 本月签到：${q.days}天\n🎯 今日：${q.signMessage || "状态未知"}\n🐾 宠物等级：${q.level}\n🌱 成长：${q.growth}/${q.full}${q.full ? `（${((q.growth / q.full) * 100).toFixed(1)}%）` : ""}`;
  },
  async cronCheck(ctx, item) {
    const q = await query(ctx, await login(ctx, parse(item.token)));
    return `账号有效，金豆${q.coin}，本月签到${q.days}天`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial:
    "发送电信登录并提交手机号#服务密码。插件完成登录、ticket/sign 换取，查询金豆、月签到和宠物成长；授权后同步面板。",
});
rt.main().catch((e) => s.reply(`电信执行失败：${e?.message || e}`));

// [title: 酷我音乐公共模块]
// [name: kuwoCore]
// [desc: 酷我音乐登录、签名、任务与资产公共能力]
// [author: sillyGirl]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

const { createCipheriv, createHash, randomUUID } = require("node:crypto");

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.95 Safari/537.36";
const DEVICES = [
  ["Pixel 8 Pro", "AP4A.250405.002"],
  ["Pixel 7", "AP2A.240805.005"],
  ["Pixel 9", "AD4A.250605.001"],
  ["SM-S9280", "UP1A.231005.007"],
  ["SM-S9110", "UP1A.231005.007"],
  ["SM-A5560", "TP1A.220624.014"],
  ["2211133C", "TKQ1.220829.002"],
  ["23127PN0CC", "UKQ1.231003.002"],
  ["2407FPN8EC", "VKQ1.240610.001"],
  ["24122RKC7C", "BP2A.250605.031"],
  ["V2329A", "UP1A.231005.007"],
  ["V2336A", "TP1A.220624.014"],
  ["PHZ110", "TP1A.220905.001"],
  ["PJZ110", "UKQ1.240118.001"],
  ["RMX3820", "TP1A.220905.001"],
  ["LE2120", "SKQ1.211006.001"],
  ["NE2210", "TP1A.220905.001"],
  ["22081212C", "V417IR.240305.001"],
];
const ANDROID = [12, 13, 14, 15, 16],
  CHROME = [
    "120.0.6099.230",
    "122.0.6261.95",
    "124.0.6367.113",
    "126.0.6478.122",
    "128.0.6613.88",
    "130.0.6723.107",
    "133.0.6943.137",
    "136.0.7103.60",
    "140.0.7241.98",
    "144.0.7564.45",
    "146.0.7688.100",
    "148.0.7778.120",
  ];

function appUid() {
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join("");
}
function encryptPhone(phone) {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from("ysiVkLJHHnvMWCHq"), Buffer.from("ichYooX+Mb1gRetP"));
  return Buffer.concat([cipher.update(String(phone), "utf8"), cipher.final()]).toString("base64");
}
function phoneUa(phone) {
  const hex = createHash("md5").update(String(phone)).digest("hex"),
    seed = BigInt(`0x${hex}`),
    device = DEVICES[Number(seed % BigInt(DEVICES.length))],
    av = ANDROID[Number(seed % BigInt(ANDROID.length))],
    cv = CHROME[Number((seed >> 8n) % BigInt(CHROME.length))];
  return `Mozilla/5.0 (Linux; Android ${av}; ${device[0]} Build/${device[1]}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${cv} Mobile Safari/537.36/ kuwopage`;
}
function webHeaders() {
  return {
    "user-agent": DESKTOP_UA,
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    referer: "http://www.kuwo.cn/",
    "accept-language": "zh-CN,zh;q=0.9",
  };
}
function mobileHeaders(phone) {
  return {
    "user-agent": phoneUa(phone),
    accept: "application/json, text/plain, */*",
    origin: "https://h5app.kuwo.cn",
    referer: "https://h5app.kuwo.cn/apps/earning-sign/cash_out.html",
    "accept-language": "zh-CN,zh-Hans;q=0.9",
  };
}
function qs(url, params) {
  const out = new URL(url);
  for (const [k, v] of Object.entries(params || {})) out.searchParams.set(k, String(v));
  return out.href;
}
async function ocr(ctx, image) {
  let last;
  for (const endpoint of [
    "https://ddddocr.linzixuan.work/classification",
    "https://ddddor.linzixuan.top/classification",
  ]) {
    try {
      const r = await ctx.requestJson(endpoint, {
        method: "POST",
        json: { image: String(image).replace(/^data:image\/[^;]+;base64,/, "") },
      });
      if (r?.result) return String(r.result).trim();
      last = new Error("OCR响应缺少result");
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("验证码识别失败");
}
async function login(ctx, phone, password, retries = 3) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const captcha = await ctx.requestJson(
        qs("http://www.kuwo.cn/api/common/captcha/getcode", { reqId: randomUUID(), httpsStatus: 1 }),
        { headers: webHeaders() },
      );
      if (!captcha?.data?.img || !captcha?.data?.token) throw new Error("获取验证码失败");
      const verifyCode = await ocr(ctx, captcha.data.img),
        result = await ctx.requestJson(qs("https://wapi.kuwo.cn/api/www/login/loginByKw", { httpsStatus: 1 }), {
          method: "POST",
          headers: { ...webHeaders(), origin: "http://www.kuwo.cn" },
          json: {
            userIp: "www.kuwo.cn",
            uname: phone,
            password,
            verifyCode,
            img: captcha.data.img,
            verifyCodeToken: captcha.data.token,
          },
        });
      if (Number(result?.code) !== 200) throw new Error(result?.msg || "登录失败");
      const sid = result.data?.cookies?.websid,
        uid = result.data?.cookies?.userid;
      if (!sid || !uid) throw new Error("登录响应缺少userid/websid");
      return { loginUid: String(uid), loginSid: String(sid), appUid: appUid() };
    } catch (e) {
      last = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw last;
}
async function sendBindSms(ctx, session, phone) {
  const result = await ctx.requestJson(
    qs("https://integralapi.kuwo.cn/api/v1/online/sign/v1/userBindPhone", {
      loginUid: session.loginUid,
      loginSid: session.loginSid,
      mobile: encryptPhone(phone),
    }),
    { headers: mobileHeaders(phone) },
  );
  if (Number(result?.code) !== 200) throw new Error(result?.data?.description || result?.msg || "发送验证码失败");
  return result;
}
async function withdraw(ctx, session, phone, code, quotaId = "30002") {
  return ctx.requestJson(
    qs("https://integralapi.kuwo.cn/api/v1/online/sign/v1/getWithdraw", {
      encry: "",
      type: "",
      quotaId,
      loginUid: session.loginUid,
      loginSid: session.loginSid,
      appuid: appUid(),
      source: "kwplayer_ar_12.1.4.0_40.apk",
      version: "1",
      phone: encryptPhone(phone),
      code,
    }),
    { headers: mobileHeaders(phone) },
  );
}
async function exchangeVip(ctx, session) {
  return ctx.requestJson(
    qs("https://integralapi.kuwo.cn/api/v1/online/sign/getExchangeAward", {
      loginUid: session.loginUid,
      loginSid: session.loginSid,
      appUid: session.appUid || appUid(),
      platform: "ar",
      source: "kwplayer_ar_11.1.4.1_hw.apk",
      version: "11.1.4.1",
      quotaId: "13",
      exchangeType: "vip",
    }),
    {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14; POCO F2 Pro Build/UQ1A.240105.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.101 Mobile Safari/537.36/ kuwopage",
        origin: "https://h5app.kuwo.cn",
        "x-requested-with": "cn.kuwo.player",
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    },
  );
}

module.exports = { appUid, encryptPhone, phoneUa, login, sendBindSms, withdraw, exchangeVip, mobileHeaders };

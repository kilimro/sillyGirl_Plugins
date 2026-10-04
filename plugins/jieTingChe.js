// [title: 捷停车]
// [name: jieTingChe]
// [desc: 捷停车图片验证码/短信登录、积分余额查询、授权及青龙/呆呆面板同步。]
// [author: huawei]
// [version: v1.5.3]
// [rule: raw ^捷停车(登录|登陆|上车|查询|管理|授权|清理|上传|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/捷停车_v1.5.3_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s, utils } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://sytgate.jslife.com.cn";
function headers(uc) {
  return {
    "user-agent": "okhttp/4.10.0",
    connection: "Keep-Alive",
    "accept-encoding": "gzip",
    "content-type": "application/json; charset=utf-8",
    uc_id: uc,
    applicationversion: "60400",
  };
}
function common(phone) {
  return {
    applictionType: "APP",
    applictionVersion: "60400",
    privacyVersion: "1.0",
    telephone: phone,
    telephoneType: 1,
    timestamp: String(Date.now()),
    verifyType: "VERIFY_LOGIN",
    version: "V1.0",
  };
}
async function verifyImage(ctx, phone, uc) {
  const d = await ctx.requestJson(`${BASE}/core-gateway/user/login/verify/image`, {
    method: "POST",
    headers: headers(uc),
    json: common(phone),
  });
  if (!d?.success) throw new Error(d?.msg || "获取图片验证码失败");
  return d.obj || {};
}
async function sms(ctx, phone, uc, key, captcha) {
  const d = await ctx.requestJson(`${BASE}/core-gateway/user/login/sms/push`, {
    method: "POST",
    headers: headers(uc),
    json: { ...common(phone), ...(key ? { key } : {}), ...(captcha ? { captchaCode: captcha } : {}) },
  });
  if (!d?.success) throw new Error(d?.msg || "短信发送失败");
}
async function login(ctx, phone, code, device, uc) {
  const d = await ctx.requestJson(`${BASE}/core-gateway/user/login/app_login`, {
      method: "POST",
      headers: headers(uc),
      json: {
        appSource: "A3",
        applictionType: "APP",
        applictionVersion: "60400",
        deviceId: device,
        osType: "ANDROID",
        privacyVersion: "1.0",
        sceneSource: "LOGIN",
        telephone: phone,
        telephoneType: 1,
        timestamp: String(Date.now()),
        userSource: "A3",
        userType: "APP_JTC",
        verificationCode: code,
      },
    }),
    x = d?.obj || {};
  if (!d?.success || !x.userId || !x.token) throw new Error(d?.msg || "短信登录失败");
  return {
    phone: x.telephone || phone,
    userId: String(x.userId),
    token: String(x.token),
    nickName: x.nickName || "",
    deviceId: device,
  };
}
async function balance(ctx, x) {
  const d = await ctx.requestJson(`${BASE}/base-gateway/integral/v2/balance/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    json: {
      userId: x.userId,
      signType: "MD5",
      reqSource: "APP_JTC",
      applictionType: "APP",
      applictionVersion: "60408",
      timestamp: String(Date.now()),
      sign: "E8E4E0E6C6A619AA09869E875B78697D",
      nonce: crypto.randomUUID().toUpperCase(),
    },
  });
  if (!d?.success) throw new Error(d?.msg || "积分查询失败");
  return d.obj || d.data || {};
}
const parse = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};
const rt = createAccountRuntime({
  title: "捷停车",
  shortName: "捷停车",
  prefix: "G_JTC",
  defaultEnvName: "JT_TOKEN",
  orderPrefix: "JTC",
  requireAuthForQuery: true,
  async login(ctx) {
    try {
      const phone = await ctx.prompt(ctx.sender, "请输入手机号", 60000);
      if (!/^1[3-9]\d{9}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
      const device = crypto.randomUUID().replaceAll("-", ""),
        uc = device,
        v = await verifyImage(ctx, phone, uc);
      let captcha = "";
      if (String(v.isVerifyImage ?? "1") === "1" && v.url) {
        await ctx.sender.reply(utils.image(v.url));
        captcha = await ctx.prompt(ctx.sender, "请输入图片中的4位验证码", 60000);
        if (!/^.{4}$/.test(String(captcha || ""))) throw new Error("图片验证码格式错误");
      }
      await sms(ctx, phone, uc, v.key || "", captcha);
      const code = await ctx.prompt(ctx.sender, "短信已发送，请输入6位验证码", 180000);
      if (!/^\d{6}$/.test(String(code || ""))) throw new Error("短信验证码格式错误");
      const x = await login(ctx, phone, code, device, uc);
      return [{ account: x.phone, token: JSON.stringify(x), remark: x.nickName || x.phone }];
    } catch (e) {
      await ctx.sender.reply(`捷停车登录失败：${e?.message || e}`);
      return [];
    }
  },
  async query(ctx, item) {
    const x = parse(item.token),
      d = await balance(ctx, x),
      amount = d.balance ?? d.integralBalance ?? d.totalIntegral ?? d.availableIntegral ?? 0,
      records = d.records || d.integralRecordList || [];
    return `📱 手机：${ctx.mask(x.phone || item.account)}\n👤 昵称：${x.nickName || item.remark}\n💰 积分余额：${amount}\n🎁 最近记录：${Array.isArray(records) ? records.length : 0}条`;
  },
  async cronCheck(ctx, item) {
    try {
      const d = await balance(ctx, parse(item.token));
      return `凭证有效，积分余额${d.balance ?? d.integralBalance ?? d.totalIntegral ?? 0}`;
    } catch (_) {
      return "捷停车Token已失效，请重新短信登录";
    }
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.userId}#${x.token}`;
  },
  tutorial:
    "=====捷停车教程=====\n发送捷停车登录，输入手机号；若接口要求图片验证码，插件发送图片供输入，再完成短信登录。\n查询积分余额，授权后同步青龙/呆呆面板，变量值 userId#token。\n指令：捷停车登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`捷停车执行失败：${e?.message || e}`));

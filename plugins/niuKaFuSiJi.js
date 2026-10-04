// [title: 牛卡福司机]
// [name: niuKaFuSiJi]
// [desc: 牛卡福司机账密登录、Token自动刷新、积分/余额/红包查询、授权及青龙同步。]
// [author: rujingxianghai]
// [version: v3.5.0]
// [rule: raw ^(牛卡福|nkf)(登录|登陆|上车|查询|管理|授权|检测|一键更新|清理|教程)$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/牛卡福司机_v3.5_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://unify-driver.nucarf.net/api",
  ACT = "https://driver-activity.nucarf.net/api";
const parse = (v) => {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  },
  deviceName = () => `Android-${crypto.randomBytes(4).toString("hex")}`,
  deviceId = () => crypto.randomBytes(8).toString("hex");
function baseHeaders(x = {}) {
  return {
    "x-request-id": crypto.randomUUID(),
    "x-apptype": "APP",
    "x-appversion": "5.9.0",
    "x-device-id": x.device_id || deviceId(),
    "x-device-type": "ANDROID",
    "x-device-name": x.device_name || deviceName(),
    "x-driver-unifyid": x.unifyId || "",
    "x-access-token": x.token || "",
    "content-type": "application/json",
  };
}
async function passwordLogin(ctx, phone, password, old = {}) {
  const k = await ctx.requestJson(`${BASE}/driver/app/unify/common/getPubKey`),
    key = k?.data?.pubKey,
    keyId = k?.data?.pubKeyId;
  if (Number(k?.code) !== 200 || !key) throw new Error(k?.message || "获取公钥失败");
  const encrypted = crypto
      .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(password))
      .toString("base64"),
    x = { phone, password, device_id: old.device_id || deviceId(), device_name: old.device_name || deviceName() },
    d = await ctx.requestJson(`${BASE}/driver/app/auth/login`, {
      method: "POST",
      headers: baseHeaders(x),
      json: {
        deviceIp: "192.168.124.153",
        deviceType: "ANDROID",
        loginType: "MOBILE_PASSWORD",
        pubKeyId: keyId,
        username: phone,
        verificationCode: encrypted,
      },
    });
  if (Number(d?.code) !== 200 || !d?.data?.token) throw new Error(d?.message || "账密登录失败");
  return { ...x, token: d.data.token, unifyId: d.data.unifyId };
}
async function points(ctx, x) {
  const d = await ctx.requestJson(`${BASE}/points/account/getAccountInfo`, {
    method: "POST",
    headers: baseHeaders(x),
    json: { unifyId: x.unifyId, platformType: "NUCARF_DRIVER" },
  });
  if (Number(d?.code) !== 200) throw new Error(d?.message || "积分查询失败");
  return d?.data?.totalPoints ?? 0;
}
async function wallet(ctx, x) {
  const d = await ctx.requestJson(`${BASE}/driver/app/middle/wallet/entrance`, { headers: baseHeaders(x) });
  return Number(d?.code) === 200 ? (d?.data?.walletBalance ?? 0) : "N/A";
}
async function reds(ctx, x) {
  const d = await ctx.requestJson(`${ACT}/driver/app/unify/activity/instantgrab/myWinningRecordByActivity`, {
    method: "POST",
    headers: baseHeaders(x),
    json: { pageNo: 1, pageSize: 10 },
  });
  const out = [];
  for (const a of d?.data || []) for (const r of a?.recordList || []) out.push(r);
  return out;
}
const rt = createAccountRuntime({
  title: "牛卡福司机",
  shortName: "牛卡福",
  prefix: "s_nkfsj",
  defaultEnvName: "S_NKF",
  orderPrefix: "NKF",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入手机号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.indexOf("#"),
          phone = raw.slice(0, p).trim(),
          password = raw.slice(p + 1).trim();
        if (!/^1\d{10}$/.test(phone) || !password) throw new Error("格式应为手机号#密码");
        const x = await passwordLogin(ctx, phone, password);
        rows.push({ account: phone, token: JSON.stringify(x), remark: phone });
      } catch (e) {
        await ctx.sender.reply(`牛卡福登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const old = parse(item.token),
      x = await passwordLogin(ctx, old.phone || item.account, old.password, old);
    await ctx.tokens.set(item.account, JSON.stringify(x));
    const [p, w, r] = await Promise.all([points(ctx, x), wallet(ctx, x), reds(ctx, x)]),
      lines = r
        .slice(0, 5)
        .map((v) => `- ${v.awardName || v.prizeName || v.name || "红包"} ${v.awardAmount || v.amount || ""}`);
    return `💰 积分：${p}\n💵 余额：${w}元\n🧧 红包记录：${r.length}条${lines.length ? `\n${lines.join("\n")}` : ""}`;
  },
  async cronCheck(ctx, item) {
    try {
      const old = parse(item.token),
        x = await passwordLogin(ctx, old.phone || item.account, old.password, old);
      await ctx.tokens.set(item.account, JSON.stringify(x));
      return `Token刷新成功，积分${await points(ctx, x)}，余额${await wallet(ctx, x)}元`;
    } catch (e) {
      return `自动更新失败：${e?.message || e}`;
    }
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.phone || item.account}#${x.token || ""}#${x.unifyId || ""}`;
  },
  tutorial:
    "=====牛卡福司机教程=====\n先在牛卡福司机APP设置登录密码，发送牛卡福登录并提交 手机号#密码。\n插件每次运行通过动态RSA公钥重新登录，刷新Token/unifyId，查询积分、钱包余额和红包记录。\n授权后同步青龙格式：手机号#Token#unifyId。\n指令：牛卡福登录、查询、管理、授权、一键更新、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`牛卡福司机执行失败：${e?.message || e}`));

// [title: m001_回收猿]
// [name: m001HuiShouYuan]
// [desc: 回收猿会员名批量登录、余额/冻结/提现收益查询、备注与CK管理、付费或积分授权、青龙同步和过期清理。]
// [author: mrconli]
// [version: v1.4.1]
// [rule: raw ^回收猿(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 32 8,16 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m001_回收猿_v1.4.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const API = "https://www.52bjy.com";
const APP_KEY = "1079fb245839e765";
const SIGN_SALT = "UppwYkfBlk";

function sign(params) {
  return crypto
    .createHash("md5")
    .update(
      Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join("&") + SIGN_SALT,
    )
    .digest("hex");
}

async function getInfo(ctx, username) {
  const params = {
    action: "userinfo",
    app: "hsywx",
    appkey: APP_KEY,
    auth: "51db9d390db6c9ef4c544be8ea15b8de",
    merchant_id: "2",
    username,
  };
  params.sign = sign(params);
  const url = new URL("/api/app/user.php", API);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const data = await ctx.requestJson(url, {
    headers: {
      "user-agent": "Mozilla/5.0 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
      referer: "https://servicewechat.com/wxadd84841bd31a665/113/page-frame.html",
    },
  });
  return data?.data ? { mobile: data.data.mobile, passport: data.data.passport } : null;
}

async function getBalance(ctx, username) {
  const params = { action: "user", appkey: APP_KEY, merchant_id: "2", method: "center", username, version: "2" };
  params.sign = sign(params);
  const url = new URL("/api/app/hsy.php", API);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const data = await ctx.requestJson(url);
  if (!data?.data) throw new Error(data?.msg || "余额接口数据为空");
  const item = data.data,
    total = Math.round((Number(item.award || 0) + Number(item.award_total || 0)) * 100) / 100;
  return `🧧 余额：${item.award ?? 0}元\n💳 冻结中：${item.award_freeze_total ?? 0}元\n🍀 可提现：${item.award_balance ?? 0}元\n🔄 提现中：${item.award_check ?? 0}元\n💰 已提现：${item.award_total ?? 0}元\n📊 总收益：${total}元`;
}

const runtime = createAccountRuntime({
  title: "回收猿",
  shortName: "回收猿",
  prefix: "mrconli.huishouyuan",
  defaultEnvName: "hsy_username",
  orderPrefix: "HSY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "=======回收猿登录=======\n请输入：备注#username\n支持批量，每行一个；无需抓包，提交会员名即可\n输入q退出",
      120000,
    );
    if (input === null) return [];
    const results = [];
    for (const line of input
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#");
      if (cut <= 0 || cut === line.length - 1) continue;
      const remark = line.slice(0, cut).trim(),
        username = line.slice(cut + 1).trim();
      try {
        await getBalance(ctx, username);
        const info = await getInfo(ctx, username).catch(() => null);
        results.push({
          account: username,
          token: username,
          remark: remark || info?.passport || username,
          extra: info ? { profile: info } : undefined,
        });
      } catch (error) {
        await ctx.sender.reply(`${remark || username} 登录认证失败：${error?.message || error}`);
      }
    }
    return results;
  },
  async query(ctx, item) {
    return getBalance(ctx, item.token);
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====回收猿教程=====\n入口：小程序『回收猿旧衣服回收』\n登录格式：备注#会员名（支持多行）\n指令：回收猿登录、查询、管理、授权、清理、教程\n收益：查询余额、冻结中、可提现、提现中、已提现和总收益\n==================",
});

runtime.main().catch(async (error) => s.reply(`回收猿执行失败：${error?.message || error}`));

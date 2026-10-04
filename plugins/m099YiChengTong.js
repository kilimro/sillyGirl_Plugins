// [title: m099_衣城通]
// [name: m099YiChengTong]
// [desc: 衣城通短信验证码或Authorization批量登录、积分/金额查询、账号管理、付费或积分授权、青龙同步和过期清理。]
// [author: mrconli]
// [version: v1.0.1]
// [rule: raw ^衣城通(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 38 8,18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m099_衣城通_v1.0.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const API = "https://api.yctjob.com";
const BASE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
  xweb_xhr: "1",
  "content-type": "application/json",
  accept: "*/*",
  referer: "https://servicewechat.com/wxc4eaf0fd0c97862f/138/page-frame.html",
};

async function sendCode(ctx, mobile) {
  await ctx.requestJson(new URL("/client/web/common/sendVerifyCode", API), {
    method: "POST",
    headers: BASE_HEADERS,
    json: { mobile },
  });
  return true;
}

async function phoneLogin(ctx, mobile, code) {
  const data = await ctx.requestJson(new URL("/client/web/phoneLogin", API), {
    method: "POST",
    headers: BASE_HEADERS,
    json: { registerType: 1, sourceType: 0, shareId: null, userUuid: null, mobile, code },
  });
  if (Number(data?.code) !== 200 || !data?.data?.token) throw new Error(data?.msg || "短信登录失败");
  return data.data.token;
}

async function api(ctx, path, token) {
  const headers = { ...BASE_HEADERS, authorization: `Bearer ${String(token).replace(/^Bearer\s+/i, "")}` };
  const data = await ctx.requestJson(new URL(path, API), { headers });
  if (Number(data?.code) !== 200) throw new Error(data?.msg || `接口${path}失败`);
  return data.data || {};
}

async function userInfo(ctx, token) {
  const data = await api(ctx, "/client/user/myResume", token);
  if (!data.mobile) throw new Error("账号手机号为空");
  return String(data.mobile);
}

const runtime = createAccountRuntime({
  title: "衣城通",
  shortName: "衣城通",
  prefix: "mrconli.yichengtong",
  defaultEnvName: "m_yct",
  orderPrefix: "YCT",
  requireAuthForQuery: true,
  async login(ctx) {
    const choice = await ctx.prompt(
      ctx.sender,
      "=====登录方式=====\n[1] 短信登录\n[2] Authorization批量登录\n回复q退出",
      60000,
    );
    if (choice === null) return [];
    if (choice === "1") {
      const mobile = await ctx.prompt(ctx.sender, "请输入手机号", 120000);
      if (!/^1[3-9]\d{9}$/.test(String(mobile || ""))) {
        await ctx.sender.reply("手机号格式不正确");
        return [];
      }
      await sendCode(ctx, mobile);
      const code = await ctx.prompt(ctx.sender, "请输入收到的6位验证码", 120000);
      if (!/^\d{6}$/.test(String(code || ""))) {
        await ctx.sender.reply("验证码格式不正确");
        return [];
      }
      const token = await phoneLogin(ctx, mobile, code);
      return [{ account: mobile, token, remark: mobile }];
    }
    if (choice === "2") {
      const input = await ctx.prompt(ctx.sender, "请输入Authorization（不带Bearer），支持多行", 120000);
      if (input === null) return [];
      const rows = [];
      for (const raw of input
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)) {
        const token = raw.replace(/^Bearer\s+/i, "");
        try {
          const mobile = await userInfo(ctx, token);
          rows.push({ account: mobile, token, remark: mobile });
        } catch (error) {
          await ctx.sender.reply(`CK认证失败：${error?.message || error}`);
        }
      }
      return rows;
    }
    await ctx.sender.reply("无效选择");
    return [];
  },
  async query(ctx, item) {
    const data = await api(ctx, "/client/user/taskHome", item.token);
    return `🎉 积分：${data.integral ?? 0}\n💰 金额：${data.amount ?? 0}元`;
  },
  async cronCheck(ctx, item) {
    try {
      await userInfo(ctx, item.token);
      const data = await api(ctx, "/client/user/taskHome", item.token);
      return Number(data.amount || 0) > 0.3 ? `余额已到${data.amount}元，可以提现了` : "";
    } catch (_) {
      return "CK已失效，请及时更新";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====衣城通教程=====\n入口：小程序『衣城通』\n登录支持短信验证码和抓包Authorization批量提交（不带Bearer）\n指令：衣城通登录、查询、管理、授权、清理、教程\n收益：签到积分、现金，满2元可提\n==================",
});

runtime.main().catch(async (error) => s.reply(`衣城通执行失败：${error?.message || error}`));

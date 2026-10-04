// [title: m116_今视频]
// [name: m116JinShiPin]
// [desc: 今视频微信扫码或token批量登录、今视频豆查询、备注与CK管理、授权、青龙同步和过期清理。]
// [author: mrconli]
// [version: v1.0.1]
// [rule: raw ^今视频(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 46 8,18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m116_今视频_v1.0.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s, utils } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const APPID = "wx9b368dd31bb430c3";
const BUNDLEID = "com.jxtv.jinshipin";
const WECHAT_UA =
  "Mozilla/5.0 (Linux; Android 15; 2210132C Build/AQ3A.240812.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.103 Mobile Safari/537.36 XWEB/1300473 MMWEBSDK/20250201 MMWEBID/9172 MicroMessenger/8.0.57.2820(0x28003939) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64";

async function getUserInfo(ctx, token) {
  const url = new URL("https://app.jxgdw.com/api/v2/app/tab/template/list");
  url.searchParams.set("tabId", "10113");
  const data = await ctx.requestJson(url, {
    headers: {
      "user-agent": "okhttp/4.9.2",
      "accept-encoding": "gzip",
      appversion: "6.1.2",
      channeltype: "jinshipin",
      authorization: `Bearer ${String(token).replace(/^Bearer\s+/i, "")}`,
      os: "Android",
    },
  });
  const info = data?.result?.[0]?.userInfo;
  if (!info?.phone) throw new Error(data?.message || data?.msg || "获取用户信息失败");
  return { phone: String(info.phone), nickname: info.nickname || "未设置", beans: info.jspBeanCount ?? 0 };
}

async function getQrUuid(ctx) {
  const url = new URL("https://open.weixin.qq.com/connect/app/qrconnect");
  Object.entries({
    appid: APPID,
    bundleid: BUNDLEID,
    scope: "snsapi_userinfo",
    state: "wx_oauth_authorization_state",
    pass_ticket: crypto.randomUUID(),
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await ctx.request(url, {
    headers: { "user-agent": WECHAT_UA, referer: "https://open.weixin.qq.com/" },
  });
  const uuid = response.text.match(/uuid\s*:\s*["'](\w+)["']/)?.[1];
  if (!uuid) throw new Error("微信登录页未返回二维码UUID");
  return uuid;
}

async function pollQr(ctx, uuid) {
  for (let index = 0; index < 90; index++) {
    const url = new URL("https://long.open.weixin.qq.com/connect/l/qrconnect");
    Object.entries({ uuid, f: "url", _: Date.now() }).forEach(([key, value]) =>
      url.searchParams.set(key, String(value)),
    );
    const response = await ctx.request(url, {
      headers: { "user-agent": WECHAT_UA, referer: "https://open.weixin.qq.com/" },
    });
    if (/window\.wx_errcode=405/.test(response.text)) {
      const code = response.text.match(/oauth\?code=([^&]+)&state=/)?.[1];
      if (code) return { code, nickname: response.text.match(/window\.wx_nickname='([^']+)'/)?.[1] || "微信用户" };
    }
    if (/window\.wx_errcode=404/.test(response.text)) throw new Error("二维码已过期");
    if (!/window\.wx_errcode=(408|404|405)/.test(response.text)) throw new Error("微信扫码状态异常");
    const child = await s.listen({ timeout: 1000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || "").trim())) return null;
  }
  throw new Error("扫码超时");
}

async function exchangeCode(ctx, code) {
  const data = await ctx.requestJson("https://app.jxgdw.com/api/auth/wechat-login", {
    method: "POST",
    headers: {
      device: crypto.randomUUID().toUpperCase(),
      connection: "keep-alive",
      "accept-encoding": "br;q=1.0, gzip;q=0.9, deflate;q=0.8",
      "content-type": "application/json",
      os: "iOS",
      "user-agent": "GVideo/6.1.2 (com.sobey.JiangXiTV; build:6.1.14; iOS 26.2.0) Alamofire/5.7.1",
      host: "app.jxgdw.com",
      appversion: "6.1.2",
      "accept-language": "zh-Hans-US;q=1.0",
      accept: "*/*",
    },
    json: { code },
  });
  const value = data?.result?.userTokenVO;
  if (Number(data?.code) !== 0 || !value?.token || !value?.user?.phone)
    throw new Error(data?.message || data?.msg || "微信授权码换取token失败");
  return { phone: String(value.user.phone), token: value.token };
}

const runtime = createAccountRuntime({
  title: "今视频",
  shortName: "今视频",
  prefix: "mrconli.jinshipin",
  defaultEnvName: "m_jinshipin",
  orderPrefix: "JSP",
  requireAuthForQuery: true,
  async login(ctx) {
    const choice = await ctx.prompt(
      ctx.sender,
      "=====登录方式=====\n[1] 微信扫码登录\n[2] token批量登录\n回复q退出",
      60000,
    );
    if (choice === null) return [];
    if (choice === "1") {
      const uuid = await getQrUuid(ctx);
      await ctx.sender.reply("请使用微信扫码并确认登录");
      await ctx.sender.reply(utils.image(`https://open.weixin.qq.com/connect/qrcode/${uuid}`));
      const scanned = await pollQr(ctx, uuid);
      if (!scanned) {
        await ctx.sender.reply("已取消扫码登录");
        return [];
      }
      await ctx.sender.reply(`${scanned.nickname} 扫码成功，正在换取登录凭证`);
      const item = await exchangeCode(ctx, scanned.code);
      return [{ account: item.phone, token: item.token, remark: item.phone }];
    }
    if (choice === "2") {
      const input = await ctx.prompt(ctx.sender, "请输入token（不带Bearer），支持多行", 120000);
      if (input === null) return [];
      const rows = [];
      for (const raw of input
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)) {
        const token = raw.replace(/^Bearer\s+/i, "");
        try {
          const info = await getUserInfo(ctx, token);
          rows.push({ account: info.phone, token, remark: info.nickname || info.phone });
        } catch (error) {
          await ctx.sender.reply(`token认证失败：${error?.message || error}`);
        }
      }
      return rows;
    }
    await ctx.sender.reply("无效选择");
    return [];
  },
  async query(ctx, item) {
    const info = await getUserInfo(ctx, item.token);
    return `👤 昵称：${info.nickname}\n🫘 今视频豆：${info.beans}`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====今视频教程=====\n入口：应用商店下载『今视频』APP\n登录支持微信扫码，或抓包token批量提交（不带Bearer）\n指令：今视频登录、查询、管理、授权、清理、教程\n收益：注册、签到、观看视频获取现金和今视频豆\n==================",
});

runtime.main().catch(async (error) => s.reply(`今视频执行失败：${error?.message || error}`));

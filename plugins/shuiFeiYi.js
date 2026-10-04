// [title: 水费易]
// [name: shuiFeiYi]
// [desc: 水费易会员ID批量登录、会员昵称/手机号/积分查询、账号管理、授权、青龙同步和到期检测。]
// [author: mrconli]
// [version: v1.0.1]
// [rule: raw ^水费易(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 42 9,18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/水费易_v1.0.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
async function info(ctx, memberId) {
  const data = await ctx.requestJson("https://memberapi.ai.ipaiyun.cn/MemberApp/GetShopMember", {
    method: "POST",
    headers: {
      "accept-language": "zh-CN,zh;q=0.9",
      connection: "keep-alive",
      origin: "https://wbapp.ai.ipaiyun.cn",
      referer: "https://wbapp.ai.ipaiyun.cn/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/116.0.0.0 Safari/537.36 MicroMessenger/7.0.20",
      ipaistf: "oUFK7XqVy1U=",
      ipaiuvck: "null",
      isapp: "1",
      "content-type": "application/json;charset=UTF-8",
      ipaiyunpaas: crypto.randomUUID(),
    },
    json: { memberID: memberId, compId: 60001 },
  });
  const value = data?.resultJson?.shopmodel;
  if (!value?.mobilePhone) throw new Error(data?.msg || "会员ID认证失败");
  return {
    nickname: value.nickName || "未知用户",
    phone: String(value.mobilePhone),
    integral: value.integral ?? 0,
    signed: data?.resultJson?.isSign,
  };
}
const runtime = createAccountRuntime({
  title: "水费易",
  shortName: "水费易",
  prefix: "mrconli.shuifeiyi",
  defaultEnvName: "m_dnys",
  orderPrefix: "SFY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入会员ID，支持批量每行一个", 120000);
    if (input === null) return [];
    const rows = [];
    for (const id of input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean))
      try {
        const x = await info(ctx, id);
        rows.push({ account: x.phone, token: id, remark: x.nickname || x.phone });
      } catch (error) {
        await ctx.sender.reply(`${id} 登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await info(ctx, item.token);
    return `👤 昵称：${x.nickname}\n🔥 会员ID：${item.token}\n🍀 积分：${x.integral}\n📅 签到状态：${Number(x.signed) === 1 ? "已签到" : "未签到"}`;
  },
  async cronCheck(ctx, item) {
    try {
      await info(ctx, item.token);
      return "";
    } catch (_) {
      return "会员ID检测失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====水费易教程=====\n登录直接提交会员ID，支持批量\n查询昵称、手机号、积分和签到状态\n指令：水费易登录、查询、管理、授权、清理、教程\n==================",
});
runtime.main().catch(async (error) => s.reply(`水费易执行失败：${error?.message || error}`));

// [title: m034_旧衣小二]
// [name: m034JiuYiXiaoEr]
// [desc: 旧衣小二token批量登录、手机号/昵称/环保币查询、定时签到、账号管理、授权和青龙同步。]
// [author: mrconli]
// [version: v1.0.1]
// [rule: raw ^小二(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 34 7,16 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m034_旧衣小二_v1.0.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const H = {
  host: "jiuyixiaoer.fzjingzhou.com",
  connection: "keep-alive",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
  xweb_xhr: "1",
  "content-type": "application/x-www-form-urlencoded",
  platform: "MP-WEIXIN",
  accept: "*/*",
  referer: "https://servicewechat.com/wx426d52c8130b8559/5/page-frame.html",
  "accept-encoding": "gzip, deflate, br",
  "accept-language": "zh-CN,zh;q=0.9",
};
async function info(ctx, token) {
  const d = await ctx.requestJson("https://jiuyixiaoer.fzjingzhou.com/api/Person/index", {
      method: "POST",
      headers: H,
      form: { token },
    }),
    x = d?.data;
  if (!x?.mobile) throw new Error(d?.msg || "token认证失败");
  return { phone: String(x.mobile), nickname: x.nickname || "", score: x.score ?? 0 };
}
async function sign(ctx, token) {
  const d = await ctx.requestJson("https://jiuyixiaoer.fzjingzhou.com/api/Person/sign", {
    method: "POST",
    headers: H,
    form: { token },
  });
  if (Number(d?.code) === 1000) return `签到成功，获得积分：${d.data}`;
  if (Number(d?.code) === 1001) return `${d.msg}！`;
  throw new Error(d?.msg || "签到异常");
}
const rt = createAccountRuntime({
  title: "旧衣小二",
  shortName: "小二",
  prefix: "mrconli.jiuyixiaoer",
  defaultEnvName: "M034_JIU_YI_XIAO_ER",
  orderPrefix: "JYXE",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入token，支持批量每行一个", 120000);
    if (input === null) return [];
    const rows = [];
    for (const token of input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean))
      try {
        const x = await info(ctx, token);
        rows.push({ account: x.phone, token, remark: x.nickname || x.phone });
      } catch (error) {
        await ctx.sender.reply(`旧衣小二登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await info(ctx, item.token);
    return `👤 昵称：${x.nickname}\n🌸 环保币：${x.score}`;
  },
  async cronCheck(ctx, item) {
    try {
      return await sign(ctx, item.token);
    } catch (error) {
      return `签到异常：${error?.message || error}`;
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====旧衣小二教程=====\n抓包提交token，支持批量\n查询昵称和环保币；定时任务自动签到并通知结果\n指令：小二登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (error) => s.reply(`旧衣小二执行失败：${error?.message || error}`));

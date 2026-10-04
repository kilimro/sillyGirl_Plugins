// [title: m109_小程序牛牛短剧]
// [name: niuNiuDuanJuXiaoChengXuBan]
// [desc: 小牛牛短剧token批量登录、积分与现金余额查询、备注/CK管理、付费或积分授权、青龙同步和过期清理。]
// [author: mrconli]
// [version: v1.0.1]
// [rule: raw ^小牛牛(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 49 8,18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 99999999]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/m109_小程序牛牛短剧_v1.0.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

async function getUserInfo(ctx, token) {
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
    xweb_xhr: "1",
    "content-type": "application/x-www-form-urlencoded",
    token,
    referer: "https://servicewechat.com/wxcb95401f250e9a53/19/page-frame.html",
  };
  const integral = await ctx.requestJson("https://api.tianjinzhitongdaohe.com/sqx_fast/app/integral/selectByUserId", {
    headers,
  });
  if (Number(integral?.code) !== 0 || !integral?.data?.userId) throw new Error(integral?.msg || "token认证失败");
  const invite = await ctx.requestJson("https://api.tianjinzhitongdaohe.com/sqx_fast/app/invite/selectInviteMoney", {
    headers,
  });
  return {
    account: String(integral.data.userId),
    integral: integral.data.integralNum ?? 0,
    money: invite?.data?.inviteMoney?.money ?? 0,
  };
}

const runtime = createAccountRuntime({
  title: "小牛牛短剧",
  shortName: "小牛牛",
  prefix: "mrconli.xnndj",
  defaultEnvName: "xnndj",
  orderPrefix: "XNNDJ",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入：备注#token\n支持批量，每行一个", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#");
      if (cut <= 0 || cut === line.length - 1) {
        await ctx.sender.reply(`${line} 格式错误`);
        continue;
      }
      const remark = line.slice(0, cut).trim(),
        token = line.slice(cut + 1).trim();
      try {
        const info = await getUserInfo(ctx, token);
        rows.push({ account: info.account, token, remark });
      } catch (error) {
        await ctx.sender.reply(`${remark} token认证失败：${error?.message || error}`);
      }
    }
    return rows;
  },
  async query(ctx, item) {
    const info = await getUserInfo(ctx, item.token);
    return `💎 积分：${info.integral}分\n💰 余额：${info.money}元`;
  },
  async cronCheck(ctx, item) {
    try {
      await getUserInfo(ctx, item.token);
      return "";
    } catch (_) {
      return `${item.remark} CK检测失效，请重新登录`;
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====小牛牛短剧教程=====\n入口：小程序『牛牛短剧』\n抓包提交格式：备注#token（支持多行）\n指令：小牛牛登录、查询、管理、授权、清理、教程\n收益：现金收益、积分与余额查询\n==================",
});

runtime.main().catch(async (error) => s.reply(`小牛牛执行失败：${error?.message || error}`));

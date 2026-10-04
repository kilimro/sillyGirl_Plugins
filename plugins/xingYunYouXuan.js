// [title: 星韵优选]
// [name: xingYunYouXuan]
// [desc: 星韵优选3rdsession批量绑定、用户ID/昵称/积分实时查询、授权及青龙/呆呆面板同步。]
// [author: rujingxianghai / huawei]
// [version: v1.1.0]
// [rule: raw ^(星韵|xyyx)(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 18 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/【插件】-星韵_v1.0.0_By.huawei.py;backup/星韵优选_v1.1_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const API = "https://gzpengru.weimbo.com/api/index.php?ackey=GZYTAPPLET";
function headers(token) {
  return {
    host: "gzpengru.weimbo.com",
    connection: "keep-alive",
    "3rdsession": token,
    "content-type": "application/json",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 13; M2012K11AC) AppleWebKit/537.36 MicroMessenger/8.0.45 MiniProgramEnv/Android",
    referer: "https://servicewechat.com/wxc86c9aecdb67f876/9/page-frame.html",
  };
}
async function user(ctx, token) {
  const d = await ctx.requestJson(API, { method: "POST", headers: headers(token), json: { action: "userInfoData" } });
  if (!d?.Status) throw new Error(d?.Message || "3rdsession无效");
  const u = d?.Data?.user || {},
    id = String(u.id || "")
      .replace(/^ID\s*[：:]\s*/, "")
      .trim();
  if (!id) throw new Error("接口未返回用户ID");
  return { id, name: u.name || "未知", points: d?.Data?.u_money?.jifen ?? 0 };
}
const rt = createAccountRuntime({
  title: "星韵优选",
  shortName: "星韵",
  prefix: "s_xyyx",
  defaultEnvName: "S_XYYX",
  orderPrefix: "XYYX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入3rdsession，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const token of input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean))
      try {
        const x = await user(ctx, token);
        rows.push({ account: x.id, token, remark: x.name });
      } catch (e) {
        await ctx.sender.reply(`星韵登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await user(ctx, item.token);
    return `👤 昵称：${x.name}\n🆔 用户ID：${x.id}\n💰 当前积分：${x.points}\n🔐 3rdsession：有效`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = await user(ctx, item.token);
      return `账号有效，当前积分${x.points}`;
    } catch (_) {
      return "3rdsession已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====星韵优选教程=====\n活动入口：#小程序://星韵优选/kt8xm5WOSI0Z6ri\n抓包取得请求头 3rdsession，支持批量换行提交\n实时查询昵称、用户ID和积分，并同步至面板供签到/视频脚本使用\n指令：星韵登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`星韵优选执行失败：${e?.message || e}`));

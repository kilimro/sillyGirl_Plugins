// [title: 战马能量星球]
// [name: zhanMaNengLiangXingQiu]
// [desc: 战马小程序 Safe 批量绑定、积分查询、授权到期检测及青龙同步。]
// [author: 8165799]
// [version: v1.5.0]
// [rule: raw ^战马(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 56 9,19 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/战马_v1.5_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const URL = "https://warhorsechina.cojoy.com.cn/app/api/custom/getusercenter";
function clean(v) {
  return String(v || "").trim();
}
function headers() {
  return {
    host: "warhorsechina.cojoy.com.cn",
    connection: "keep-alive",
    customappid: "wx94dca6ef07a54c55",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
    xweb_xhr: "1",
    "content-type": "application/x-www-form-urlencoded",
    "cGvnZetrWSWfLcdYaN40mLdFx6ObkRltdZmhS5hQkgDbuZd9bLcQevwBVEjx-war-horse-zm-2025":
      "ku9qdPDtR7HDR8Z48R8YU5G0wnRDZ4a1f2FqddxzwOyJ2AaqmnZxBPDCrE0S",
    accept: "*/*",
    referer: "https://servicewechat.com/wx94dca6ef07a54c55/180/page-frame.html",
  };
}
async function info(ctx, safe) {
  const d = await ctx.requestJson(`${URL}?safe=${encodeURIComponent(clean(safe))}`, { headers: headers() });
  if (Number(d?.status) !== 1) throw new Error(d?.msg || "Safe失效");
  return { integral: Number(d.nowscore || 0), nickname: d.nickname || d.nickName || "战马用户", raw: d };
}
const rt = createAccountRuntime({
  title: "战马能量星球",
  shortName: "战马",
  prefix: "dd_zm",
  defaultEnvName: "zmnlyl",
  orderPrefix: "ZM",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入Safe，支持 Safe#备注 和批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/[\r\n&]+/).filter(Boolean))
      try {
        const [safe, remark] = raw.split("#"),
          x = await info(ctx, safe);
        rows.push({
          account: `zm_${crypto.createHash("sha256").update(safe).digest("hex").slice(0, 16)}`,
          token: clean(safe),
          remark: clean(remark) || x.nickname,
        });
      } catch (e) {
        await ctx.sender.reply(`战马登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await info(ctx, item.token);
    return `📛 用户：${x.nickname}\n🏆 当前积分：${x.integral}\n💵 账户状态：正常`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = await info(ctx, item.token);
      return `Safe有效，当前积分${x.integral}`;
    } catch (_) {
      return "战马Safe已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return clean(item.token);
  },
  tutorial:
    "=====战马教程=====\n抓包战马能量星球小程序 getusercenter 请求，复制 URL 参数 safe。\n登录支持 Safe#备注 和批量换行；查询当前能量积分，授权后同步变量 zmnlyl。\n指令：战马登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`战马执行失败：${e?.message || e}`));

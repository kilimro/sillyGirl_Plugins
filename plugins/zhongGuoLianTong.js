// [title: 中国联通]
// [name: zhongGuoLianTong]
// [desc: 联通 ecs_token 绑定、话费红包、通用积分/今日积分/到期积分及待领卡券查询、授权和青龙同步。]
// [author: yuhualhh]
// [version: v1.1.0]
// [rule: raw ^中国联通(登录|登陆|查询|管理|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/中国联通_v1.1.0_By.yuhualhh.py]
// [depe: ["./mrconliAccountRuntime.js","./unicomAssetCore.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const core = require("./unicomAssetCore.js");
const rt = createAccountRuntime({
  title: "中国联通",
  shortName: "中国联通",
  prefix: "yuhua_zglt",
  defaultEnvName: "chinaUnicomCookie",
  orderPrefix: "UNICOM",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 ecs_token 或完整 Cookie，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean)) {
      const d = await core.get(ctx, raw),
        account = d.phone || crypto.createHash("md5").update(core.normalize(raw)).digest("hex").slice(0, 16);
      rows.push({ account, token: d.token, remark: d.phone || account });
    }
    return rows;
  },
  async query(ctx, item) {
    const d = await core.get(ctx, item.token);
    return `📱 手机：${d.phone || "未知"}\n💰 话费红包：${d.tel}元${Number(d.telExp) ? `（${d.telMonth}月到期 ${d.telExp}元）` : ""}\n🎯 通用积分：${d.score}\n📈 今日积分：${d.today}\n⏰ 本月到期积分：${d.expire}\n🎫 待领卡券：${d.coupons.length ? d.coupons.join("、") : "暂无"}`;
  },
  async cronCheck(ctx, item) {
    const d = await core.get(ctx, item.token);
    return `凭证有效，话费红包${d.tel}元，积分${d.score}，今日+${d.today}，待领卡券${d.coupons.length}张`;
  },
  envValue(_c, i) {
    return core.normalize(i.token);
  },
  tutorial:
    "抓包中国联通 App Cookie 中的 ecs_token；查询话费红包、积分、今日积分、到期积分与待领卡券，授权后同步青龙。",
});
rt.main().catch((e) => s.reply(`中国联通执行失败：${e?.message || e}`));

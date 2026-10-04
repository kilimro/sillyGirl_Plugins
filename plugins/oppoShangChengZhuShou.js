// [title: OPPO商城助手]
// [name: oppoShangChengZhuShou]
// [desc: OPPO商城手机号/NEWOPPOSID批量绑定、实时积分查询、会话失效检测、授权和青龙/呆呆面板同步。]
// [author: 8165799]
// [version: v1.7.0]
// [rule: raw ^OPPO商城(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 15 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/oppo商城_v1.7_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const URL = "https://store.oppo.com/api/mobile/account/user/credits";
function headers(token) {
  return {
    host: "store.oppo.com",
    connection: "keep-alive",
    "source-type": "501",
    "client-type": "1",
    accept: "application/json, text/plain, */*",
    xweb_xhr: "1",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
    "content-type": "application/x-www-form-urlencoded",
    referer: "https://store.oppo.com/cn/m/task/center/index?clearance=1",
    "accept-language": "zh-CN,zh;q=0.9",
    cookie: `NEWOPPOSID=${token}`,
  };
}
async function credits(ctx, token) {
  const d = await ctx.requestJson(URL, { headers: headers(token) });
  if (Number(d?.code) !== 0) throw new Error(d?.msg || "积分查询失败");
  return d?.data?.credits ?? 0;
}
const rt = createAccountRuntime({
  title: "OPPO商城",
  shortName: "OPPO商城",
  prefix: "dd_oppo",
  defaultEnvName: "OPPOCK",
  orderPrefix: "OPPO",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：手机号#NEWOPPOSID[#备注]，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = line.trim().split("#"),
          phone = p.shift(),
          token = p.shift(),
          remark = p.join("#") || phone;
        if (!/^1[3-9]\d{9}$/.test(phone) || !token) throw new Error("格式错误");
        await credits(ctx, token);
        rows.push({ account: phone, token, remark });
      } catch (e) {
        await ctx.sender.reply(`OPPO登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    return `📱 手机：${ctx.mask(item.account)}\n💰 当前积分：${await credits(ctx, item.token)}\n🔐 NEWOPPOSID：有效`;
  },
  async cronCheck(ctx, item) {
    try {
      return `会话有效，当前积分${await credits(ctx, item.token)}`;
    } catch (e) {
      return `NEWOPPOSID失效：${e?.message || e}`;
    }
  },
  envValue(_ctx, item) {
    return `${item.account}#${item.token}`;
  },
  tutorial:
    "=====OPPO商城教程=====\n抓包 store.oppo.com，从 Cookie 中取得 NEWOPPOSID\n格式：手机号#Token#备注，备注可省略，支持批量\n实时查询商城积分，并同步至青龙/呆呆面板\n指令：OPPO商城登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`OPPO商城执行失败：${e?.message || e}`));

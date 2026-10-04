// [title: 牛牛短剧]
// [name: niuNiuDuanJu]
// [desc: 牛牛短剧Token批量绑定、JWT用户ID提取、用户资料/金币/现金余额查询、授权及双面板同步。]
// [author: huawei]
// [version: v1.1.0]
// [rule: raw ^牛牛(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 16 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/牛牛短剧_v1.1_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://api.tianjinzhitongdaohe.com/sqx_fast";
async function get(ctx, token, path) {
  return ctx.requestJson(BASE + path, { headers: { "content-type": "application/x-www-form-urlencoded", token } });
}
function jwtId(token) {
  try {
    return String(JSON.parse(Buffer.from(String(token).split(".")[1], "base64url")).sub || "");
  } catch (_) {
    return "";
  }
}
function profileData(d) {
  return d && typeof d.data === "object" ? d.data : {};
}
async function snapshot(ctx, token) {
  const profile = await get(ctx, token, "/app/user/selectUserById");
  if (Number(profile?.code) !== 0) throw new Error(profile?.msg || "Token校验失败");
  const p = profileData(profile),
    id = jwtId(token) || String(p.id || p.userId || p.uid || "");
  if (!id) throw new Error("无法提取userId");
  const gold = await get(ctx, token, "/app/integral/selectByUserId"),
    cash = await get(ctx, token, "/app/invite/selectInviteMoney").catch(() => ({})),
    c = profileData(cash),
    invite = c.inviteMoney && typeof c.inviteMoney === "object" ? c.inviteMoney : {};
  let money = "未知";
  for (const key of ["money", "moneySum", "cashOut"])
    if (invite[key] != null) {
      money = invite[key];
      break;
    }
  if (money === "未知")
    for (const key of ["money", "balance", "userMoney", "amount", "cash", "withdrawableMoney"])
      if (c[key] != null) {
        money = c[key];
        break;
      }
  return {
    id,
    name: p.nickName || p.nickname || p.name || p.userName || p.username || p.mobile || "未知",
    gold: profileData(gold).integralNum ?? 0,
    money,
  };
}
const rt = createAccountRuntime({
  title: "牛牛短剧",
  shortName: "牛牛",
  prefix: "G_NNDJ",
  defaultEnvName: "G_NNDJ_TOKEN",
  orderPrefix: "NNDJ",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：备注#token，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const cut = line.indexOf("#"),
          remark = line.slice(0, cut).trim(),
          token = line.slice(cut + 1).trim();
        if (cut < 0 || !remark || !token) throw new Error("格式错误");
        const x = await snapshot(ctx, token);
        rows.push({ account: x.id, token, remark });
      } catch (e) {
        await ctx.sender.reply(`牛牛登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await snapshot(ctx, item.token);
    return `🏷 备注：${item.remark}\n👤 用户：${x.name}\n🆔 用户ID：${x.id}\n💰 金币：${x.gold}\n💵 余额：${x.money}`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = await snapshot(ctx, item.token);
      return `Token有效，金币${x.gold}，余额${x.money}`;
    } catch (_) {
      return "牛牛Token已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====牛牛短剧教程=====\n抓包取得Token，按备注#token提交，支持批量\n实时查询用户资料、金币和现金余额；授权后同步至青龙/呆呆面板\n指令：牛牛登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`牛牛短剧执行失败：${e?.message || e}`));

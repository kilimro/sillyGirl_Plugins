// [title: 森选直播]
// [name: chaJianSenXuanZhiBo]
// [desc: 森选直播token批量登录、直播间活动验证与直播列表查询、授权、青龙同步、订阅式定时推送。]
// [author: huawei]
// [version: v1.5.4]
// [rule: raw ^森选直播(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: */10 * * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/【插件】-森选直播_v1.5.3_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const cryptoL = require("node:crypto");
const { sender: sl } = require("sillygirl");
const { createAccountRuntime: createL } = require("./mrconliAccountRuntime");
const API = "https://yh.sentezhenxuan.com/api/mobile/shop-live/room",
  P = { source_type: 2314, source_from: 2321, source_lang: "zh_CN", currency_id: 86, site_id: "" };
function hl(token = "") {
  const h = {
    "content-type": "application/x-www-form-urlencoded",
    "app-sign": "wx1b482e08a5617509",
    referer: "https://servicewechat.com/wx1b482e08a5617509/7/page-frame.html",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
  };
  if (token) h.authorization = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  return h;
}
function ul(path, extra = {}) {
  const u = new URL(API + path);
  Object.entries({ ...P, ...extra }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u;
}
function jid(token) {
  try {
    return String(
      JSON.parse(
        Buffer.from(
          String(token)
            .replace(/^bearer\s+/i, "")
            .split(".")[1],
          "base64url",
        ),
      ).id || "",
    );
  } catch (_) {
    return "";
  }
}
async function verify(ctx, token) {
  const d = await ctx.requestJson(ul("/getLiveRoomActivity", { roomId: 2781 }), { headers: hl(token) });
  if (Number(d?.code) !== 0) throw new Error(d?.msg || "直播API验证失败");
  return jid(token) || `sxzb_${cryptoL.createHash("md5").update(token).digest("hex").slice(0, 10)}`;
}
async function rooms(ctx, token = "") {
  const d = await ctx.requestJson(ul("/getLiveRoomList"), { headers: hl(token) });
  if (Number(d?.code) !== 0) throw new Error(d?.msg || "直播列表获取失败");
  return Array.isArray(d.data) ? d.data : Array.isArray(d?.data?.items) ? d.data.items : [];
}
function roomText(r) {
  return `${r.roomName || r.title || r.name || "直播间"}${r.anchorName ? `（${r.anchorName}）` : ""}${r.status !== undefined ? ` 状态:${r.status}` : ""}`;
}
const rl = createL({
  title: "森选直播",
  shortName: "森选直播",
  prefix: "G_SXZB",
  defaultEnvName: "G_SXZB",
  orderPrefix: "SXZB",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入token或备注#token，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const i = line.indexOf("#"),
          remark = i >= 0 ? line.slice(0, i) : "默认账号",
          token = (i >= 0 ? line.slice(i + 1) : line).replace(/^bearer\s+/i, "").trim(),
          id = await verify(ctx, token);
        rows.push({ account: id, token, remark });
      } catch (error) {
        await ctx.sender.reply(`森选直播登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    await verify(ctx, item.token);
    const rs = await rooms(ctx, item.token);
    return `✅ Token有效\n📺 直播间数量：${rs.length}${rs.length ? `\n${rs.slice(0, 10).map(roomText).join("\n")}` : ""}`;
  },
  async cronCheck(ctx, item) {
    await verify(ctx, item.token);
    const rs = await rooms(ctx, item.token);
    return rs.length ? `发现${rs.length}个直播间：\n${rs.slice(0, 5).map(roomText).join("\n")}` : "";
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====森选直播教程=====\n提交token或备注#token，支持批量\n验证直播活动接口、查询直播列表；定时发现直播间后推送\n指令：森选直播登录、查询、管理、授权、清理、教程\n==================",
});
rl.main().catch(async (e) => sl.reply(`森选直播执行失败：${e?.message || e}`));

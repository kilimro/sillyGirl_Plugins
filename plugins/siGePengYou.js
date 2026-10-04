// [title: 四个朋友]
// [name: siGePengYou]
// [desc: 四个朋友 user_id 批量绑定、金币/签到/广告任务/待领奖查询、授权及双面板同步。]
// [author: huawei]
// [version: v1.0.1]
// [rule: raw ^(四个朋友|四友)(登录|登陆|上车|查询|管理|授权|清理|教程|上传|上传青龙|上传呆呆)$]
// [cron: 30 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/四个朋友_v1.0.1_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const OEM = "300ab330835844d58a8bccfc1c8b0800",
  SECRET = "sgpy@2023!hsjt05";
function sign(o) {
  return crypto
    .createHash("md5")
    .update(
      Object.keys(o)
        .sort()
        .map((k) => `${k}=${o[k]}`)
        .join("") + SECRET,
    )
    .digest("hex");
}
async function snapshot(ctx, userId) {
  const form = { user_id: userId, userId, oemId: OEM, api_version_interceptor: 1, timestamp: Date.now(), oemType: 1 };
  form.sign = sign(form);
  const d = await ctx.requestJson("https://iot.hs499.com/applet/activity/welfare/index", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "*/*",
      "user-agent": "Mozilla/5.0 MicroMessenger/8.0.53 MiniProgramEnv/android",
    },
    form,
  });
  if (Number(d?.code) !== 1) throw new Error(d?.msg || "user_id无效");
  return d.result || {};
}
function fmt(d) {
  const si = d.signInfo || {},
    ad = (d.taskInfoList || []).find((x) => Number(x.type) === 13),
    u = d.unclaimedPrizeList || [];
  return `💰 金币：${d.userInfo?.goldBalance ?? 0}\n📅 签到：${Number(si.todayIsSign) === 1 ? "已签到" : Number(si.isAllowSign) === 1 ? "未签到" : "不可签到"}，连续${si.continuousQuantity ?? 0}天\n📺 ${ad?.name || "广告任务"}：${Number(ad?.isComplete) === 1 ? "已完成" : "未完成"}\n🎁 待领奖：${u.length}${u[0]?.prizeAbstracts ? `（${u[0].prizeAbstracts}）` : ""}`;
}
const rt = createAccountRuntime({
  title: "四个朋友",
  shortName: "四友",
  prefix: "G_SGPY",
  defaultEnvName: "G_SGPY_UID",
  orderPrefix: "SGPY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：备注#user_id，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.indexOf("#"),
          remark = raw.slice(0, p).trim(),
          uid = raw.slice(p + 1).trim();
        if (p < 1 || !uid) throw new Error("格式错误");
        await snapshot(ctx, uid);
        rows.push({ account: uid, token: uid, remark });
      } catch (e) {
        await ctx.sender.reply(`四友登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    return fmt(await snapshot(ctx, item.token));
  },
  async cronCheck(ctx, item) {
    try {
      return fmt(await snapshot(ctx, item.token));
    } catch (_) {
      return "四个朋友 user_id 已失效";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====四个朋友教程=====\n抓包 iot.hs499.com，取得接口参数 user_id。\n登录格式：备注#user_id；查询金币、签到状态、广告任务和待领奖。\n授权后可按运行时配置同步青龙或呆呆面板，默认变量 G_SGPY_UID。\n指令：四友登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`四个朋友执行失败：${e?.message || e}`));

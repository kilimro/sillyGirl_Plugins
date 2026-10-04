// [title: 腾讯地图]
// [name: tengXunDiTu]
// [desc: 腾讯地图user_id批量绑定、签名验证、余额/金币明细查询、签到、抽奖、自动提现和授权管理。]
// [author: rujingxianghai]
// [version: v2.3.0]
// [rule: raw ^地图(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 40 7 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/腾讯地图_v2.3_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://mmapgwh.map.qq.com",
  ACT = 1721983577;
function headers(uid, path) {
  const id = crypto.randomUUID(),
    ms = String(Date.now()),
    ts = ms.slice(0, -3),
    def = crypto
      .createHash("md5")
      .update(`mapinst=0&mapnonce=0&reqid=${id}&reqtime=${ms}${path}03a9875e795c3ecff15f617085e72d4cc`)
      .digest("hex"),
    sign = crypto
      .createHash("sha256")
      .update(`request_id=${id}&from_source=wx7643d5f831302ab0&timestamp=${ts}&token=e643d512f085d621bf6c9e80310d0498`)
      .digest("hex")
      .toUpperCase();
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    from_source: "wx7643d5f831302ab0",
    request_id: id,
    "tmap-nonce": "0",
    "tmap-engine": "web",
    "tmap-reqid": id,
    sign,
    user_id: uid,
    "tmap-reqtime": ms,
    timestamp: ts,
    "tmap-install-id": "0",
    "tmap-default-sign": def,
  };
}
async function post(ctx, uid, path, json) {
  return ctx.requestJson(BASE + path, { method: "POST", headers: headers(uid, path), json });
}
async function detail(ctx, uid) {
  const d = await post(ctx, uid, "/activity/v1/lottery/detail", {
    activity_id: ACT,
    game_id: 3,
    rule_id: "tencent_map_lottery",
  });
  if (d?.message !== "ok") throw new Error(d?.message || "账号验证失败");
  return d.data || {};
}
async function wallet(ctx, uid) {
  const d = await post(ctx, uid, "/activity/v1/withdraw/home", {
    activity_id: ACT,
    game_id: 4,
    rule_id: "tencent_map_withdraw",
  });
  if (d?.message !== "ok") throw new Error(d?.message || "余额查询失败");
  return {
    coins: Number(d.data?.coins || 0) / 100,
    withdrawable: Number(d.data?.withdrawable_amount || 0) / 100,
    threshold: Number(d.data?.current_withdraw_threshold || 0) / 100,
    raw: d.data || {},
  };
}
async function history(ctx, uid) {
  const d = await post(ctx, uid, "/activity/v1/coins/history", { activity_id: ACT, state: "normal", last_id: "" });
  return d?.message === "ok" ? (d.data?.list || []).slice(0, 5) : [];
}
async function run(ctx, uid) {
  const out = [];
  const c = await post(ctx, uid, "/activity/v1/checkin", { activity_id: ACT, game_id: 1 });
  out.push(
    `📝 签到：${c?.message === "ok" ? (c.data?.prizes || []).map((v) => v.name).join("、") || "成功" : c?.message || "失败"}`,
  );
  const d = await detail(ctx, uid),
    tickets = Number(d.available_ticket_number || 0),
    wins = [];
  for (let i = 0; i < tickets; i++) {
    const r = await post(ctx, uid, "/activity/v1/lottery", { activity_id: ACT, game_id: 3 });
    wins.push(
      r?.message === "ok" ? (r.data?.prizes || []).map((v) => v.name).join("、") || "无奖励" : r?.message || "失败",
    );
    await new Promise((x) => setTimeout(x, 500));
  }
  out.push(`🎰 抽奖：${tickets}次${wins.length ? `（${wins.join("；")}）` : ""}`);
  const w = await wallet(ctx, uid);
  if (Number(w.raw.withdrawable_amount) >= Number(w.raw.current_withdraw_threshold)) {
    const r = await post(ctx, uid, "/activity/v1/withdraw", { activity_id: ACT, game_id: 4 });
    out.push(`💸 提现：${r?.message || "已提交"}`);
  } else out.push(`💸 提现：未达到阈值${w.threshold.toFixed(2)}元`);
  out.push(`💰 金币：${w.coins.toFixed(2)}，可提现：${w.withdrawable.toFixed(2)}元`);
  return out.join("\n");
}
const rt = createAccountRuntime({
  title: "腾讯地图",
  shortName: "地图",
  prefix: "S_TXDT",
  defaultEnvName: "S_TXDT",
  orderPrefix: "TXDT",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：备注#user_id，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const cut = line.indexOf("#"),
          remark = line.slice(0, cut).trim(),
          uid = line.slice(cut + 1).trim();
        if (cut < 0 || !remark || uid.length < 10) throw new Error("格式错误");
        await detail(ctx, uid);
        rows.push({ account: uid, token: uid, remark });
      } catch (e) {
        await ctx.sender.reply(`地图登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const w = await wallet(ctx, item.account),
      h = await history(ctx, item.account),
      lines = [
        `💰 金币：${w.coins.toFixed(2)}`,
        `💴 可提现：${w.withdrawable.toFixed(2)}元`,
        `🎯 提现阈值：${w.threshold.toFixed(2)}元`,
      ];
    if (h.length) {
      lines.push("最近明细：");
      for (const x of h) {
        const t = new Date(Number(x.created_time) * 1000);
        lines.push(
          `🧧${(Number(x.amount || 0) / 100).toFixed(2)}金币 ${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
        );
      }
    }
    return lines.join("\n");
  },
  async cronCheck(ctx, item) {
    return run(ctx, item.account);
  },
  envValue(_ctx, item) {
    return item.account;
  },
  tutorial:
    "=====腾讯地图教程=====\n抓包活动请求取得 user_id，按备注#user_id提交，支持批量\n查询金币及明细；每天自动签到、用完抽奖次数、达到阈值后提现\n指令：地图登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`腾讯地图执行失败：${e?.message || e}`));

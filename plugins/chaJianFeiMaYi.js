// [title: 飞蚂蚁]
// [name: chaJianFeiMaYi]
// [desc: 飞蚂蚁token批量登录、豆子查询、投注/签到/三次步数兑换、授权、青龙同步和定时运行。]
// [author: huawei]
// [version: v1.1.1]
// [rule: raw ^蚂蚁(登录|登陆|上车|查询|管理|授权|清理|教程|一键运行)$]
// [cron: 23 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/【插件】-飞蚂蚁_v1.1_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://openapp.fmy90.com",
  PARAMS = {
    type: "1",
    version: "V2.00.01",
    platformKey: "F2EE24892FBF66F0AFF8C0EB532A9394",
    mini_scene: "1256",
    partner_ext_infos: "",
  };
function headers(token) {
  return {
    host: "openapp.fmy90.com",
    "device-model": "microsoft",
    "device-version": "Windows 10 x64",
    xweb_xhr: "1",
    authorization: `bearer ${String(token).replace(/^bearer\s+/i, "")}`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
    "content-type": "application/json;charset=UTF-8",
    accept: "*/*",
    referer: "https://servicewechat.com/wx501990400906c9ff/450/page-frame.html",
  };
}
function url(path) {
  const u = new URL(BASE + path);
  Object.entries(PARAMS).forEach(([k, v]) => u.searchParams.set(k, v));
  return u;
}
function jwtId(token) {
  try {
    const d = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url"));
    return String(d.uid || d.id || "");
  } catch (_) {
    return "";
  }
}
async function profile(ctx, token) {
  const h = headers(token),
    b = await ctx.requestJson(url("/user/new/beans/info"), { headers: h });
  if (Number(b?.code) !== 200) throw new Error(b?.message || "token验证失败");
  const i = await ctx.requestJson(url("/user/info"), { headers: h }).catch(() => ({})),
    u = i?.data?.user || {};
  return {
    account: String(u.mobile || jwtId(token) || ""),
    name: u.userName || "未知用户",
    beans: b?.data?.totalCount ?? 0,
  };
}
async function post(ctx, token, path, body) {
  return ctx.requestJson(BASE + path, { method: "POST", headers: headers(token), json: body });
}
async function tasks(ctx, token) {
  const before = await profile(ctx, token),
    out = [`💰 账户豆子：${before.beans}`],
    base = {
      version: "V2.00.01",
      platformKey: "F2EE24892FBF66F0AFF8C0EB532A9394",
      mini_scene: 1256,
      partner_ext_infos: "",
    };
  try {
    const d = await post(ctx, token, "/active/pool/bet", base);
    out.push(
      `🎲 投注：${Number(d?.code) === 200 || String(d?.message).includes("已投") ? "成功" : "失败"} - ${d?.message || ""}`,
    );
  } catch (e) {
    out.push(`🎲 投注异常：${e.message}`);
  }
  try {
    const d = await post(ctx, token, "/sign/new/do", base);
    out.push(
      `📝 签到：${Number(d?.code) === 200 || /已.*签到/.test(String(d?.message)) ? "成功" : "失败"} - ${d?.message || ""}${d?.data?.sign_red_amount ? `，红包${d.data.sign_red_amount}` : ""}`,
    );
  } catch (e) {
    out.push(`📝 签到异常：${e.message}`);
  }
  for (let i = 1; i <= 3; i++)
    try {
      const d = await post(ctx, token, "/step/exchange", { ...base, steps: 20000, exchangeType: "bean" });
      out.push(
        `👟 第${i}次兑换：${Number(d?.code) === 200 || String(d?.message).includes("最多兑换") ? "成功" : "失败"} - ${d?.message || ""}`,
      );
    } catch (e) {
      out.push(`👟 第${i}次兑换异常：${e.message}`);
    }
  const after = await profile(ctx, token);
  out.push(`💰 当前豆子：${after.beans}（变化：${Number(after.beans) - Number(before.beans)}）`);
  return out.join("\n");
}
const rt = createAccountRuntime({
  title: "飞蚂蚁",
  shortName: "蚂蚁",
  prefix: "G_fmy",
  defaultEnvName: "G_fmy",
  orderPrefix: "FMY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入token或备注#token，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const i = line.indexOf("#"),
          remark = i >= 0 ? line.slice(0, i) : "",
          token = (i >= 0 ? line.slice(i + 1) : line).replace(/^bearer\s+/i, "").trim(),
          x = await profile(ctx, token);
        if (!x.account) throw new Error("Token未包含账号ID");
        rows.push({ account: x.account, token, remark: remark || x.name || x.account });
      } catch (error) {
        await ctx.sender.reply(`飞蚂蚁登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await profile(ctx, item.token);
    return `👤 用户：${x.name}\n💰 豆子数量：${x.beans}`;
  },
  async cronCheck(ctx, item) {
    return tasks(ctx, item.token);
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====飞蚂蚁教程=====\n提交token或备注#token，支持批量\n查询豆子；定时执行投注、签到和三次20000步兑换\n指令：蚂蚁登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`飞蚂蚁执行失败：${e?.message || e}`));

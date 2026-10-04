// [title: 【插件】-森选质享]
// [name: chaJianSenXuanZhiXiang]
// [desc: 银辉云选Token批量绑定、余额与奖励/提现记录查询、视频任务、授权、青龙同步和过期清理。]
// [author: huawei]
// [version: v1.7.1]
// [rule: raw ^(森选|sz)(登录|登陆|查询|管理|授权|教程|清理|上传|一键运行)$]
// [cron: 15 22 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/【插件】-森选质享_v1.7.1_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js","./vortoUtils.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://yb.yuanhukj.com/api/mobile";
const COMMON = { source_type: "2314", source_from: "2321", source_lang: "zh_CN", currency_id: "86", site_id: "" };

function cleanToken(value) {
  return String(value || "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}
function authHeaders(token, json = false) {
  return {
    "accept-encoding": "gzip, deflate, br",
    "content-type": json ? "application/json" : "application/x-www-form-urlencoded",
    connection: "keep-alive",
    referer: "https://servicewechat.com/wx243e6a357085251f/4/page-frame.html",
    authorization: `Bearer ${cleanToken(token)}`,
    "app-sign": "wx243e6a357085251f",
    host: "yb.yuanhukj.com",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows XWEB/16965",
    xweb_xhr: "1",
    accept: "*/*",
    "cb-lang": "zh-CN",
  };
}
function endpoint(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}
function jwtPayload(token) {
  try {
    const part = cleanToken(token).split(".");
    if (part.length !== 3) return null;
    return JSON.parse(Buffer.from(part[1], "base64url").toString("utf8"));
  } catch (_) {
    return null;
  }
}
async function verify(ctx, token) {
  const payload = jwtPayload(token);
  if (payload && (!payload.exp || Number(payload.exp) * 1000 >= Date.now()))
    return { id: String(payload.id || payload.user_id || ""), data: payload };
  const result = await ctx.requestJson(endpoint("/account/commission", { page: 1, limit: 5 }), {
    headers: authHeaders(token, true),
  });
  if (Number(result?.code) !== 0 || !result?.data) throw new Error(result?.msg || "Token验证失败");
  const records = result.data.records || result.data.list || [],
    first = records[0] || {};
  return { id: String(first.uid || first.user_id || ""), data: result.data };
}
async function overview(ctx, token) {
  const result = await ctx.requestJson(endpoint("/account/user/overview_my", { ...COMMON, isOrder: 1 }), {
    headers: authHeaders(token),
  });
  if (Number(result?.code) !== 0 || !result?.data) throw new Error(result?.msg || "账号信息获取失败");
  return result.data;
}
async function consumeRecords(ctx, token, rows = 20) {
  const result = await ctx.requestJson(
    endpoint("/pay/index/consumeRecord", { ...COMMON, change_type: 0, page: 1, rows }),
    { headers: authHeaders(token) },
  );
  if (Number(result?.code) !== 0 || !result?.data) return null;
  return { records: result.data.items || [], income: result.data.income || 0, total: result.data.total || 0 };
}
async function commission(ctx, token) {
  const result = await ctx.requestJson(endpoint("/account/commission", { page: 1, limit: 5 }), {
    headers: authHeaders(token),
  });
  if (Number(result?.code) !== 0 || !result?.data) return [];
  return result.data.records || result.data.list || [];
}
function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
async function queryAccount(ctx, token) {
  const user = await overview(ctx, token),
    balance = money(user.user_money || user.now_money),
    consume = await consumeRecords(ctx, token);
  const out = [`💰 当前余额：¥${balance.toFixed(2)}`, `🎬 待完成视频：${Number(user.video_answer_not || 0)}个`];
  if (consume?.records?.length) {
    const rewards = consume.records.filter((row) => !String(row.record_title || "").includes("提现"));
    const withdraws = consume.records.filter((row) => String(row.record_title || "").includes("提现"));
    out.push(
      `🎁 今日奖励：¥${rewards.reduce((sum, row) => sum + money(row.record_money), 0).toFixed(2)}`,
      `📋 奖励记录：${rewards.length}条`,
    );
    if (rewards.length) {
      out.push("最近奖励：");
      for (const row of rewards.slice(0, 3))
        out.push(
          `- ¥${row.record_money || 0} ${row.record_title || "未知"} ${String(row.record_time || "未知").slice(0, 10)}`,
        );
    }
    out.push(
      `💸 提现：${withdraws.length}笔  合计：¥${withdraws.reduce((sum, row) => sum + money(row.record_money), 0).toFixed(2)}`,
    );
    for (const row of withdraws.slice(0, 3))
      out.push(`- ¥${row.record_money || 0} ${String(row.record_time || "未知").slice(0, 10)}`);
  } else {
    const records = await commission(ctx, token),
      withdraws = records.filter((row) => row.type === "user_tx");
    out.push(
      `💸 提现：${withdraws.length}笔  合计：¥${withdraws.reduce((sum, row) => sum + money(row.number), 0).toFixed(2)}`,
    );
    for (const row of withdraws.slice(0, 5)) out.push(`现金${row.number || 0}元-${row.add_time || "未知"}`);
  }
  return out.join("\n");
}
async function call(ctx, token, method, path, params = {}, json) {
  const options = { method, headers: authHeaders(token, json !== undefined) };
  if (json !== undefined) options.json = json;
  return ctx.requestJson(endpoint(path, params), options);
}
async function dailyTask(ctx, token) {
  const before = await overview(ctx, token),
    list = await call(ctx, token, "GET", "/video/list", {
      ...COMMON,
      page: 1,
      limit: 10,
      status: 1,
      source: 0,
      isXn: 1,
    });
  const videos =
    Number(list?.code) === 0 && Array.isArray(list?.data?.items)
      ? list.data.items.map((row) => row.id).filter(Boolean)
      : [];
  let completed = 0,
    rewarded = 0,
    failed = 0;
  for (const vid of videos) {
    try {
      const detail = await call(ctx, token, "GET", "/video/getOneVideo", { ...COMMON, vid }),
        wait = Math.max(0, Number.parseInt(detail?.data?.wait_time || 10, 10) || 10);
      const viewed = await call(
        ctx,
        token,
        "POST",
        "/video/addUserViewNum",
        { ...COMMON, vid, playMode: 0 },
        { baseVersion: "3.12.1", playMode: 0 },
      );
      if (Number(viewed?.status) === 500) {
        failed++;
        continue;
      }
      const startTime = Date.now(),
        endTime = startTime + wait * 1000 + 1000;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      const job = await call(
        ctx,
        token,
        "POST",
        "/video/addVideoJob",
        {},
        { ...COMMON, currency_id: "86", vid, startTime, endTime, baseVersion: "3.12.1", playMode: 0 },
      );
      if (Number(job?.code) !== 0) {
        failed++;
        continue;
      }
      completed++;
      const reward = await call(ctx, token, "GET", "/video/rewardUserSmallChange");
      if (Number(reward?.code) === 0) rewarded++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (_) {
      failed++;
    }
  }
  const after = await overview(ctx, token);
  return {
    videos: videos.length,
    completed,
    rewarded,
    failed,
    before: money(before.user_money || before.now_money),
    balance: money(after.user_money || after.now_money),
  };
}
function taskMessage(result) {
  return `🎬 视频：${result.completed}/${result.videos}，奖励${result.rewarded}，失败${result.failed}\n💰 余额：¥${result.balance.toFixed(2)}（变化：¥${(result.balance - result.before).toFixed(2)}）`;
}

const runtime = createAccountRuntime({
  title: "森选质享",
  shortName: "森选",
  prefix: "G_szyx",
  defaultEnvName: "S_SZYX",
  orderPrefix: "SZYX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入Token或备注#Token，支持批量换行", 300000);
    if (input === null) return [];
    const rows = [],
      lines = input
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter(Boolean);
    for (let index = 0; index < lines.length; index++)
      try {
        const cut = lines[index].indexOf("#"),
          remark = cut >= 0 ? lines[index].slice(0, cut).trim() : `账号${index + 1}`,
          token = cleanToken(cut >= 0 ? lines[index].slice(cut + 1) : lines[index]);
        if (token.length < 20) throw new Error("Token过短");
        const checked = await verify(ctx, token);
        const account = checked.id || `szyx_${crypto.createHash("md5").update(token).digest("hex").slice(0, 10)}`;
        rows.push({ account, token, remark });
      } catch (error) {
        await ctx.sender.reply(`森选第${index + 1}行绑定失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    return queryAccount(ctx, item.token);
  },
  async cronCheck(ctx, item) {
    return taskMessage(await dailyTask(ctx, item.token));
  },
  async handle(ctx, content) {
    if (/上传/.test(content)) {
      if (!(await ctx.sender.isAdmin())) return ctx.sender.reply("❌ 您不是管理员");
      return ctx.sender.reply("请在『森选管理』选择账号后使用“提交青龙”同步环境变量");
    }
    if (/一键运行/.test(content)) {
      if (!(await ctx.sender.isAdmin())) return ctx.sender.reply("❌ 您不是管理员");
      const userIds = await ctx.users.keys();
      let success = 0,
        failed = 0,
        videos = 0;
      await ctx.sender.reply(`⛳ 开始处理 ${userIds.length} 个用户的已授权账号，请稍候...`);
      for (const userId of userIds)
        for (const account of require("./vortoUtils").parseStoredList(await ctx.users.get(userId, "[]"))) {
          const expires = require("./vortoUtils").extractExpireDate(await ctx.auth.get(account, ""));
          if (!expires || expires < new Date().toISOString().slice(0, 10)) continue;
          try {
            const token = await ctx.tokens.get(account, ""),
              result = await dailyTask(ctx, token);
            success++;
            videos += result.completed;
          } catch (_) {
            failed++;
          }
        }
      return ctx.sender.reply(`森选一键运行汇总\n成功: ${success} 失败: ${failed}\n完成视频: ${videos}`);
    }
    return undefined;
  },
  envValue(_ctx, item) {
    return `${item.remark}#${cleanToken(item.token)}`;
  },
  tutorial:
    "=====森选质享教程=====\n入口：#小程序://银辉云选/mpcwyYtMQegcNjc\n抓包域名：yb.yuanhukj.com，取 authorization 并去掉 Bearer\n格式：备注#token，支持批量；查询余额、奖励与提现记录；定时执行视频任务\n指令：森选登录、查询、管理、授权、清理、上传、一键运行、教程\n==================",
});
runtime.main().catch(async (error) => s.reply(`森选质享执行失败：${error?.message || error}`));

// [title: 达能益生]
// [name: daNengYiSheng]
// [desc: 达能益生Token/openId/unionId批量绑定、账号验证、自护力调研、事件上报、挑战开启与每日打卡任务。]
// [author: rujingxianghai]
// [version: v1.0.1]
// [rule: raw ^达能(登录|登陆|上车|查询|管理|授权|清理|教程|一键运行)$]
// [cron: 0 0 0 0 0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/达能益生_v1.0.1_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://api.digital4danone.com.cn";
function state(raw) {
  const p = String(raw).split("#");
  return { token: p[0] || "", openId: p[1] || "", unionId: p.slice(2).join("#") || "" };
}
function headers(x, challenge = false) {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "mini-path": challenge ? "%2Fpages%2Fchallenge3%2Fchallenge3" : "%2Fpages%2Fmine%2Fmine",
    source: "wechat_default",
    "content-type": "application/json",
    sdk: challenge ? "3.8.9" : "3.3.5",
    xweb_xhr: "1",
    privacysource: "base",
    platform: "wechat",
    "x-access-token": x.token,
    referer: `https://servicewechat.com/wx28fabbff88261f5f/${challenge ? 91 : 93}/page-frame.html`,
  };
}
async function api(ctx, x, method, path, json, challenge = false) {
  return ctx.requestJson(BASE + path, { method, headers: headers(x, challenge), json });
}
async function calendar(ctx, x) {
  const d = await api(ctx, x, "GET", "/healthyaging/danone/wx/ha/selfcare/getCalendar");
  if (Number(d?.code) !== 200) throw new Error(d?.message || "账号验证失败");
  return d;
}
async function execute(ctx, x, task) {
  const options = task.optionList || [],
    rules = task.ruleList || [];
  let ids = [],
    value = null;
  if (task.viewCode === "PICKER") {
    const o = options.find((v) => Number(v.checkinStatus) === 1);
    if (o) {
      ids = [o.id];
      value = o.name;
    }
  } else if (task.viewCode === "WATER" && options.length) {
    const o = options.at(-1);
    ids = [o.id];
    value = o.name;
  } else if (task.viewCode === "MULTI") {
    const a = options.filter((v) => Number(v.checkinStatus) === 1);
    ids = a.map((v) => v.id);
    value = a.map((v) => v.name || "").join(",");
  } else ids = [rules[0]?.id || task.id];
  if (!ids.filter(Boolean).length) ids = [task.id];
  const d = await api(ctx, x, "POST", "/healthyaging/danone/wx/clockin/clickIn", {
    ruleIds: ids.filter(Boolean),
    taskDataCode: "Auto",
    taskDataValue: value,
    userTaskDetailId: task.userTaskDetailId,
  });
  return `${Number(d?.code) === 200 ? "✅" : "⚠️"} ${task.simpleName || "任务"}：${d?.message || (Number(d?.code) === 200 ? "完成" : "失败")}`;
}
async function question(ctx, x) {
  const c = await calendar(ctx, x),
    challengeId = c?.result?.lastChallengeId,
    d = await api(ctx, x, "GET", "/healthyaging/danone/wx/ha/csq/get?type=feedback_v3"),
    q = d?.result?.csqQuestionList?.[0];
  if (!q) return "✅ 无需提交问题";
  const body = { answers: [{ questionId: q.id, value: [q.optionList?.[0]?.id] }], csqId: d.result.csqId, challengeId },
    r = await api(ctx, x, "POST", "/healthyaging/danone/wx/ha/csq/submit", body);
  return `${Number(r?.code) === 200 ? "✅" : "⚠️"} 调研：${r?.message || "已提交"}`;
}
async function event(ctx, x) {
  const d = await api(ctx, x, "POST", "/healthyaging/danone/wx/config/eventReport", {
    content: "挑战页-浏览",
    name: "maievent-page-view",
    type: "view",
    mobile: "",
    openId: x.openId,
    unionId: x.unionId,
    page: "/pages/challenge3/challenge3",
    source: "wechat-default",
    sdk: "ha-default",
  });
  return `${Number(d?.code) === 200 ? "✅" : "⚠️"} 事件上报：${d?.message || "完成"}`;
}
async function tasks(ctx, x) {
  const out = [await question(ctx, x), await event(ctx, x)];
  for (let retry = 0; retry < 2; retry++) {
    const d = await calendar(ctx, x),
      list = d?.result?.taskCalendarList || [],
      today = list.find((v) => v.istoday);
    if (today) {
      out.push(`📅 ${today.taskDate || "今日"}`);
      for (const task of today.taskDetailsVoList || []) {
        if (Number(task.status) === 1) {
          out.push(await execute(ctx, x, task));
          await new Promise((r) => setTimeout(r, 3000));
        } else out.push(`✅ 已完成 ${task.simpleName || "任务"}`);
      }
    } else out.push("🔍 今日无可用任务");
    await new Promise((r) => setTimeout(r, 5000));
    const opened = await api(ctx, x, "POST", "/healthyaging/danone/wx/ha/selfcare/openChallenge", {}, true);
    out.push(`${Number(opened?.code) === 200 ? "✅" : "⚠️"} 开启挑战：${opened?.message || "完成"}`);
    if (Number(opened?.code) !== 200) break;
  }
  return out.join("\n");
}
const rt = createAccountRuntime({
  title: "达能益生",
  shortName: "达能",
  prefix: "S_DNYS",
  defaultEnvName: "S_DNYS",
  orderPrefix: "DNYS",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：备注#X-Access-Token#openId#unionId，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = line.trim().split("#"),
          remark = p.shift(),
          token = p.shift(),
          openId = p.shift(),
          unionId = p.join("#");
        if (!remark || !token || !openId || !unionId) throw new Error("格式错误");
        await calendar(ctx, { token, openId, unionId });
        rows.push({ account: `${openId}_${unionId}`, token: `${token}#${openId}#${unionId}`, remark });
      } catch (e) {
        await ctx.sender.reply(`达能登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = state(item.token),
      d = await calendar(ctx, x),
      today = (d?.result?.taskCalendarList || []).find((v) => v.istoday),
      all = today?.taskDetailsVoList || [],
      done = all.filter((v) => Number(v.status) !== 1).length;
    return `📝 备注：${item.remark}\n📅 任务日期：${today?.taskDate || "无"}\n✅ 已完成：${done}/${all.length}\n🆔 openId：${ctx.mask(x.openId)}`;
  },
  async cronCheck(ctx, item) {
    return tasks(ctx, state(item.token));
  },
  envValue(_ctx, item) {
    return `${item.remark}#${item.token}`;
  },
  tutorial:
    "=====达能益生教程=====\n抓包 api.digital4danone.com.cn 获取 X-Access-Token、openId、unionId\n格式：备注#token#openId#unionId\n定时提交自护力调研、事件上报、开启挑战并完成当天任务\n指令：达能登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`达能益生执行失败：${e?.message || e}`));

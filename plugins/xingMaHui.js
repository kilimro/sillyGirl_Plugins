// [title: 星妈会]
// [name: xingMaHui]
// [desc: 星妈会 Authorization 与飞鹤 Token 联合绑定、积分查询、签到任务、授权及青龙同步。]
// [author: sky2022]
// [version: v1.0.3]
// [rule: raw ^星妈会(登录|登陆|查询|管理|一键运行|授权|清理|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/星妈会_v1.0.3_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const MOM = "https://momclub.feihe.com/capis/c",
  FEI = "https://www.feihevip.com/api",
  KEY = "TwUQ01lKS1Km5zlV2f7amsZc5EQYkTbv";
function parse(x) {
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
function nonce() {
  const a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from({ length: 16 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}
function fhHeaders(token) {
  const n = nonce(),
    t = Math.floor(Date.now() / 1000),
    id = "xmyx",
    sig = crypto
      .createHash("md5")
      .update(`fhAppid${id}fhNonceStr${n}fhTimestamp${t}{}${KEY}`)
      .digest("hex")
      .toUpperCase();
  return {
    token,
    fhAppid: id,
    fhNonceStr: n,
    fhTimestamp: String(t),
    fhSign: sig,
    source: "1",
    "user-agent": "Mozilla/5.0 Mobile MicroMessenger/8.0.48",
    referer: "https://servicewechat.com/wx4205ec55b793245e/215/page-frame.html",
  };
}
function momHeaders(a) {
  return {
    authorization: a,
    "content-type": "application/json",
    locale: "zh_CN",
    "user-agent": "Mozilla/5.0 MicroMessenger MiniProgramEnv/Windows",
    referer: "https://servicewechat.com/wxc83b55d61c7fc51d/75/page-frame.html",
  };
}
async function feiInfo(ctx, t) {
  const d = await ctx.requestJson(`${FEI}/starMember/getMemberInfo`, {
    method: "POST",
    headers: fhHeaders(t),
    json: {},
  });
  if (String(d?.code) !== "200" || !d.data) throw new Error(d?.msg || "飞鹤Token无效");
  const b = d.data.baseInfo || {},
    p = d.data.memberPoints || {};
  return {
    id: String(b.mobile || b.fullName || b.openId || ""),
    name: b.nickName || b.fullName || "",
    points: p.scoreBalance ?? 0,
  };
}
async function momInfo(ctx, a) {
  const d = await ctx.requestJson(`${MOM}/user/memberInfo`, { headers: momHeaders(a) });
  if (!d?.success || !d.data) throw new Error(d?.message || "星妈会Authorization无效");
  const x = d.data;
  return {
    id: String(x.mobile || x.phone || ""),
    name: x.nickname || x.name || "",
    points: x.credits ?? x.credit ?? x.points ?? 0,
  };
}
async function feiRun(ctx, t) {
  const out = [],
    sd = await ctx.requestJson(`${FEI}/member/signin/sign`, { method: "POST", headers: fhHeaders(t), json: {} });
  out.push(`飞鹤签到：${String(sd?.code) === "200" ? "成功或已签" : sd?.msg || "失败"}`);
  const ld = await ctx.requestJson(`${FEI}/member/signin/getTaskList`, { headers: fhHeaders(t) });
  for (const x of ld?.data || []) {
    const name = x.taskName || x.name,
      type = x.taskType || x.type;
    if (!type || /购买任意商品/.test(name)) continue;
    await ctx.requestJson(`${FEI}/member/signin/tofinish?taskType=${encodeURIComponent(type)}`, {
      headers: fhHeaders(t),
    });
    const d = await ctx.requestJson(`${FEI}/member/signin/completeTask?taskType=${encodeURIComponent(type)}`, {
      headers: fhHeaders(t),
    });
    out.push(`飞鹤 ${name}：${String(d?.code) === "200" ? "完成" : d?.msg || "失败"}`);
  }
  return out;
}
async function momRun(ctx, a) {
  const h = momHeaders(a),
    d = await ctx.requestJson(`${MOM}/activity/todo/list?mockTime=${Date.now()}`, { headers: h }),
    todo = d?.data;
  if (!d?.success || !todo) throw new Error(d?.message || "任务列表失败");
  const out = [];
  if (todo.checkInTodo) {
    const c = todo.checkInTodo,
      r = (c.checkInExtra?.joinRecord || []).find((x) => x.today);
    if (r?.joined) out.push("星妈会今日已签到");
    else {
      const z = await ctx.requestJson(`${MOM}/activity/todo/checkIn`, {
        method: "POST",
        headers: h,
        json: { activityId: c.id, mockTime: Date.now() },
      });
      out.push(`星妈会签到：${z?.success ? `成功 +${z?.data?.credits || 0}分` : z?.message || "失败"}`);
    }
  }
  for (const t of todo.taskTodo || []) {
    const e = t.taskTodoExtra || {};
    if (
      ["Perfect", "AddQw", "FirstOrder"].includes(e.type) ||
      e.status === "3" ||
      Number(e.completeCount) >= Number(e.completeLimit || 1)
    )
      continue;
    let z = await ctx.requestJson(`${MOM}/activity/todo/receive`, {
      method: "POST",
      headers: h,
      json: { activityId: t.id, mockTime: Date.now() },
    });
    if (z?.success)
      z = await ctx.requestJson(`${MOM}/activity/todo/complete`, {
        method: "POST",
        headers: h,
        json: { activityId: t.id, mockTime: Date.now() },
      });
    out.push(`星妈会 ${t.name || "任务"}：${z?.success ? `完成 +${e.credits || 0}分` : z?.message || "失败"}`);
  }
  return out;
}
const rt = createAccountRuntime({
  title: "星妈会",
  shortName: "星妈会",
  prefix: "G_xmh",
  defaultEnvName: "XING_MA_HUI",
  orderPrefix: "XMH",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "请输入 飞鹤token#星妈会Authorization（任一项可留空），支持批量换行",
      120000,
    );
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      let [fei, mom] = line.split("#"),
        infos = [];
      if (!mom && fei) {
        try {
          infos.push(await feiInfo(ctx, fei));
        } catch {
          mom = fei;
          fei = "";
        }
      }
      if (fei && !infos.length) infos.push(await feiInfo(ctx, fei));
      if (mom) infos.push(await momInfo(ctx, mom));
      if (!infos.length) continue;
      const u = infos.find((x) => x.id) || infos[0],
        account = u.id || `xmh_${crypto.createHash("md5").update(line).digest("hex").slice(0, 16)}`;
      rows.push({ account, token: JSON.stringify({ fei, mom }), remark: u.name || account });
    }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      out = [];
    if (x.fei) {
      const u = await feiInfo(ctx, x.fei);
      out.push(`飞鹤账号：${u.id}\n飞鹤积分：${u.points}`);
    }
    if (x.mom) {
      const u = await momInfo(ctx, x.mom);
      out.push(`星妈会账号：${u.id}\n星妈会积分：${u.points}`);
    }
    return out.join("\n");
  },
  async handle(ctx, content) {
    if (!/一键运行/.test(content)) return;
    const uid = await ctx.currentUserId(),
      accounts = JSON.parse(await ctx.users.get(uid, "[]"));
    if (!accounts.length) return ctx.sender.reply("❌ 未找到星妈会账号");
    for (const account of accounts) {
      const x = parse(await ctx.tokens.get(account, "{}")),
        out = [];
      try {
        if (x.fei) out.push(...(await feiRun(ctx, x.fei)));
        if (x.mom) out.push(...(await momRun(ctx, x.mom)));
        await ctx.sender.reply(`=====星妈会运行=====\n${out.join("\n")}\n==================`);
      } catch (e) {
        await ctx.sender.reply(`❌ ${await ctx.remarks.get(account, account)}：${e?.message || e}`);
      }
    }
  },
  async cronCheck(ctx, item) {
    const x = parse(item.token),
      out = [];
    if (x.fei) out.push(...(await feiRun(ctx, x.fei)));
    if (x.mom) out.push(...(await momRun(ctx, x.mom)));
    return out.join("\n");
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.fei || ""}#${x.mom || ""}`;
  },
  tutorial:
    "抓包飞鹤星妈 token 和/或星妈会请求头 Authorization，格式：飞鹤token#Authorization。支持积分查询、签到和日常任务。",
});
rt.main().catch((e) => s.reply(`星妈会执行失败：${e?.message || e}`));

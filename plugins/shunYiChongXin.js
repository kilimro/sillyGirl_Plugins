// [title: 顺易充（新）]
// [name: shunYiChongXin]
// [desc: 顺易充短信登录、Token刷新、每日签到、任务领奖及积分查询]
// [author: huawei]
// [version: v1.1.7]
// [rule: ^(顺易充|syc)(教程|登录|登陆|绑定|管理|查询|授权|运行|一键运行|清理|刷新|一键刷新)$]
// [cron: 0 20 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/顺易充（新）_v1.1.7_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createHash, createCipheriv } = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://app.wodeev.com",
  KEY = Buffer.from("+7+hkq4l97VMgGHTufKDEHzfH8FzQ0aw", "base64");
function md5(v) {
  return createHash("md5").update(v).digest("hex");
}
function signed(keyword, value) {
  const n = String(Math.floor(100 + Math.random() * 900)),
    now = Date.now(),
    raw = `${n[0]}${keyword}${n[1]}${value}${n[2]}${now}${n}`,
    c = createCipheriv("des-ede3", KEY, null);
  c.setAutoPadding(true);
  return {
    timestamp: String(now) + n,
    sign: Buffer.concat([c.update(md5(raw), "utf8"), c.final()]).toString("base64"),
  };
}
function headers(token = "") {
  return {
    accept: "application/json, text/plain, */*",
    authorization: token ? `Bearer ${String(token).replace(/^Bearer\s+/i, "")}` : "",
    "client-version": "5.10.0",
    lang: "1",
    loginChannel: "07",
    "user-agent": "okhttp/4.9.0",
  };
}
async function req(ctx, path, opt = {}) {
  const r = await ctx.requestJson(BASE + path, opt);
  if (Number(r?.ret) !== 200) throw new Error(r?.msg || `接口失败 ret=${r?.ret}`);
  return r;
}
async function sendSms(ctx, phone) {
  const x = signed("mobile", phone);
  return req(
    ctx,
    `/cst-front/v2.0/sms?verifyType=05&mobile=${phone}&timestamp=${x.timestamp}&sign=${encodeURIComponent(x.sign)}&countryAreaTelCode=86`,
    {
      headers: {
        ...headers(),
        authorization: "Bearer",
        Origin: "https://www.wodeev.com",
        Referer: "https://www.wodeev.com/",
        "x-requested-with": "com.longshine.nanwang.electric.charge",
      },
    },
  );
}
async function login(ctx, phone, code) {
  const regions = [
      ["440100", "440000"],
      ["320500", "320000"],
      ["330100", "330000"],
      ["510100", "510000"],
    ],
    r = regions[Math.floor(Math.random() * regions.length)],
    v = await req(ctx, "/cst-front/open/v3.0/login", {
      method: "POST",
      json: {
        cityCode: r[0],
        countryCode: "中国",
        loginType: "02",
        mobile: phone,
        verifyCode: code,
        countryAreaTelCode: "86",
        provinceCode: r[1],
        rsaFlag: "1",
        deviceId: "",
        deviceModel: "Android",
        systemVersion: "Android 13",
      },
      headers: headers(),
    });
  if (!v.token) throw new Error("登录响应缺少token");
  return {
    phone,
    token: v.token,
    refreshToken: v.refreshToken || "",
    custInfo: v.custInfo || {},
    updatedAt: new Date().toISOString(),
  };
}
async function refresh(ctx, x) {
  if (!x.refreshToken) throw new Error("refreshToken为空");
  const sg = signed("token", x.refreshToken),
    r = await req(ctx, "/cst-front/open/v2.0/refreshToken", {
      method: "POST",
      json: { sign: sg.sign, refreshToken: x.refreshToken, timestamp: sg.timestamp },
      headers: headers(),
    });
  return { ...x, token: r.token, refreshToken: r.refreshToken || x.refreshToken, updatedAt: new Date().toISOString() };
}
function sess(raw) {
  return typeof raw === "string" && raw.trim().startsWith("{") ? JSON.parse(raw) : { token: String(raw || "") };
}
async function score(ctx, x) {
  const r = await req(ctx, "/bil-front/v2.0/accounts/myScoreRank?scoreType=02", { headers: headers(x.token) });
  return { score: r.data?.myScores || 0, available: r.data?.myAvailableScores || 0, rank: r.data?.myRank || "未知" };
}
async function run(ctx, x) {
  const lines = [];
  try {
    const r = await ctx.requestJson(BASE + "/bil-front/v2.0/activity/getWelfare", {
      method: "POST",
      json: { type: "1201", taskNo: "20221231" },
      headers: headers(x.token),
    });
    if (Number(r?.ret) === 200) lines.push("签到成功");
    else if (Number(r?.ret) === 400 && String(r.msg).includes("超过最大可领取次数")) lines.push("今日已签到");
    else lines.push(`签到失败:${r?.msg || r?.ret}`);
  } catch (e) {
    lines.push(`签到异常:${e.message}`);
  }
  let claimed = 0;
  try {
    const list = await req(ctx, "/bil-front/v2.0/activity/queryWelfareList", { headers: headers(x.token) });
    for (const task of list.data?.list || []) {
      if (Number(task.status) !== 0 || String(task.type) === "1216") continue;
      try {
        await req(ctx, "/bil-front/v2.0/activity/getWelfare", {
          method: "POST",
          json: { type: task.type, taskNo: task.taskNo },
          headers: headers(x.token),
        });
        claimed++;
      } catch (_) {}
    }
    lines.push(`领取任务奖励${claimed}个`);
  } catch (e) {
    lines.push(`任务检查异常:${e.message}`);
  }
  const q = await score(ctx, x);
  return { lines, q };
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    a = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!a.length) throw new Error("未绑定顺易充账号");
  return Promise.all(
    a.map(async (account) => ({
      account,
      remark: await ctx.remarks.get(account, account),
      x: sess(await ctx.tokens.get(account, "")),
    })),
  );
}
async function runAll(ctx) {
  const out = [];
  for (const a of await owned(ctx)) {
    try {
      const r = await run(ctx, a.x);
      out.push(`${a.remark}：${r.lines.join("；")}；积分${r.q.score}，可用${r.q.available}，排名${r.q.rank}`);
    } catch (e) {
      out.push(`${a.remark}：${e.message}`);
    }
  }
  return ctx.sender.reply(out.join("\n"));
}
async function refreshAll(ctx) {
  const out = [];
  for (const a of await owned(ctx)) {
    try {
      const x = await refresh(ctx, a.x);
      await ctx.tokens.set(a.account, JSON.stringify(x));
      out.push(`${a.remark}：刷新成功`);
    } catch (e) {
      out.push(`${a.remark}：${e.message}`);
    }
  }
  return ctx.sender.reply(out.join("\n"));
}
const rt = createAccountRuntime({
  title: "顺易充（新）",
  shortName: "顺易充",
  prefix: "G_SYC",
  defaultEnvName: "G_SYC_TOKEN",
  orderPrefix: "SYC",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入11位手机号，多账号换行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const phone of raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)) {
      if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error(`${phone}手机号错误`);
      await sendSms(ctx, phone);
      const code = await ctx.prompt(
        ctx.sender,
        `${phone.slice(0, 3)}****${phone.slice(-4)} 验证码已发送，请输入验证码`,
        120000,
      );
      if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误");
      const x = await login(ctx, phone, code);
      await score(ctx, x);
      out.push({ account: phone, token: JSON.stringify(x), remark: phone.slice(0, 3) + "****" + phone.slice(-4) });
    }
    return out;
  },
  async query(ctx, item) {
    const q = await score(ctx, sess(item.token));
    return `🏆 总积分：${q.score}\n💰 可用积分：${q.available}\n📊 排名：${q.rank}`;
  },
  async handle(ctx, c) {
    if (/刷新/.test(c)) return refreshAll(ctx);
    if (/运行/.test(c)) return runAll(ctx);
  },
  async cronCheck(ctx, item) {
    const r = await run(ctx, sess(item.token));
    return `${r.lines.join("；")}；积分${r.q.score}`;
  },
  envValue(_c, item) {
    return item.token;
  },
  tutorial:
    "发送“顺易充登录”输入手机号和短信验证码。顺易充运行执行签到及可领取任务，顺易充查询查看积分，顺易充刷新使用 refreshToken 更新登录凭证。",
});
rt.main().catch((e) => s.reply(`顺易充执行失败：${e?.message || e}`));

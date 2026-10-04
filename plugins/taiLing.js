// [title: 台铃]
// [name: taiLing]
// [desc: 台铃 smartToken/Authorization 绑定、积分签到、社区与商品任务、授权及双面板同步。]
// [author: huawei]
// [version: v1.2.1]
// [rule: raw ^台铃(登录|登陆|上车|查询|管理|运行|授权|清理|教程|上传|上传青龙|上传呆呆|菜单)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/台铃_v1.2.1_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const SIGN = "https://www.tailgdd.com/v1/api/shop/app/integral/sign",
  TASK = "https://www.tailgdd.com/v1/api/shop/app/integral/user",
  SOCIAL = "https://www.tailgdd.com/v8/social/app",
  AUTH = "https://www.tailgdd.com/v8/auth/login",
  DEFAULT_CLIENT = "63baf6871f7aee49dbe800e7672b2bec",
  PUB =
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC+8L8XYhymaIuORzzlT+/mn76PuK1ixqkaOsCuw1zj6V/gOXD2i8NNOh4RrllCuNe6PSGttlmIKRlGS48pk1YctNzxDOdm17pngBWTx78p21ZR6q9AGiga/gYpcKLE5Eni7F/MBp4fqJUUbrAnyFgbYP2pTWm2lAeBxWmXRWyEvwIDAQAB";
const TASKS = {
  like_comment_trend: "每日点赞",
  trend_share: "每日分享",
  social_view: "社区浏览",
  product_view: "商品浏览",
  product_add_cart: "商品加购",
};
function parse(v) {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}
function headers(auth, client = "") {
  return {
    "user-agent": "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json;charset=UTF-8",
    origin: "https://www.tailgdd.com",
    referer: "https://www.tailgdd.com/travel/tailg-shop-h5/",
    "x-requested-with": "XMLHttpRequest",
    authorization: auth,
    ...(client ? { clientid: client, "client-origin": "h5" } : {}),
  };
}
async function post(ctx, url, auth, json = {}, client = "") {
  return ctx.requestJson(url, { method: "POST", headers: headers(auth, client), json });
}
function date() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}
async function summary(ctx, x) {
  const day = date(),
    month = day.slice(0, 8) + "01",
    [v, i, g, r] = await Promise.all([
      post(ctx, `${SIGN}/verifySign`, x.auth, { signDate: day }),
      post(ctx, `${TASK}/getIntegralUserSummary`, x.auth),
      post(ctx, `${SIGN}/getSign`, x.auth, { signDate: day, signMonthDate: month }),
      post(ctx, `${SIGN}/getProceedSignReward`, x.auth, { signDate: day }),
    ]);
  if (Number(v?.code) !== 0) throw new Error(v?.msg || "Authorization失效");
  const rs = r?.data?.result || [],
    next = rs.find((y) => !y.isReceived && !y.received);
  return {
    signed: !!v.data,
    points: i?.data?.availableTotalIntegral ?? 0,
    days: g?.data?.signDay ?? 0,
    cycle: (g?.data?.signList || []).filter((y) => String(y.isSign) === "1").length,
    next: next ? `${next.signDay || next.day || "?"}天 ${next.awardName || next.rewardName || "奖励"}` : "",
  };
}
async function bearer(ctx, x) {
  const key = crypto.randomBytes(24).toString("base64").slice(0, 32),
    key64 = Buffer.from(key).toString("base64"),
    pem = `-----BEGIN PUBLIC KEY-----\n${PUB.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`,
    ek = crypto
      .publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(key64))
      .toString("base64"),
    plain = JSON.stringify({ clientId: x.clientId, grantType: "smartToken", smartToken: x.auth, tenantId: "000000" }),
    cipher = crypto.createCipheriv("aes-256-ecb", Buffer.from(key), null),
    body = Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64"),
    d = await ctx.requestJson(AUTH, {
      method: "POST",
      headers: { ...headers(x.auth), "encrypt-key": ek, "content-type": "application/json; charset=utf-8" },
      body,
    });
  if (Number(d?.code) !== 200) throw new Error(d?.msg || "Bearer获取失败");
  return `Bearer ${d.data.access_token}`;
}
async function run(ctx, x) {
  const out = [],
    q = await summary(ctx, x);
  if (q.signed) out.push("今日已签到");
  else {
    const d = await post(ctx, `${SIGN}/saveIntegralSignIn`, x.auth, {});
    out.push(
      Number(d?.code) === 0 && d?.success
        ? `签到成功：${d?.data?.award_num ?? 0} ${d?.data?.awardName || ""}`
        : `签到失败：${d?.msg || ""}`,
    );
  }
  const lr = await post(ctx, `${TASK}/listUserIntegralTask`, x.auth, { taskType: "1" }),
    todos = (lr?.data || [])
      .filter((t) => TASKS[t.eventCode] && t.taskStatus)
      .map((t) => ({ ...t, left: Number(t.maxTaskDrawNum || 0) - Number(t.completeTaskDrawNum || 0) }))
      .filter((t) => t.left > 0);
  let ba = "";
  if (todos.some((t) => /^(like_comment_trend|trend_share|social_view)$/.test(t.eventCode)))
    try {
      ba = await bearer(ctx, x);
    } catch (e) {
      out.push(`社区任务跳过：${e?.message || e}`);
    }
  let trends = [];
  if (ba) {
    const d = await ctx.requestJson(`${SOCIAL}/trends/recommend/list?pageNum=1&pageSize=10`, {
      headers: headers(ba, x.clientId),
    });
    trends = (d?.rows || []).map((y) => y.id).filter(Boolean);
  }
  let products = [];
  if (todos.some((t) => /^product_/.test(t.eventCode))) {
    const d = await post(ctx, "https://www.tailgdd.com/v1/api/shop/app/product/app/category/listProduct", x.auth, {
      productCategoryId: 1,
      limit: 6,
    });
    for (const c of d?.data || []) for (const p of c.products || []) products.push(p.id);
  }
  for (const t of todos) {
    for (let i = 0; i < t.left; i++) {
      let d = { code: -1 };
      if (t.eventCode === "like_comment_trend" && ba && trends.length)
        d = await ctx.requestJson(`${SOCIAL}/trends/like?trendsId=${trends[i % trends.length]}&isLike=1`, {
          headers: headers(ba, x.clientId),
        });
      else if (t.eventCode === "trend_share" && ba && trends.length) {
        d = await ctx.requestJson(`${SOCIAL}/trends/share?trendsId=${trends[i % trends.length]}`, {
          headers: headers(ba, x.clientId),
        });
        if (Number(d?.code) === 200)
          await post(ctx, `${TASK}/drawEventAward`, x.auth, { taskType: 1, eventCode: "trend_share" });
      } else if (t.eventCode === "social_view" && ba)
        d = await post(ctx, `${SOCIAL}/task/completeTask`, ba, { taskType: "social_view" }, x.clientId);
      else if (t.eventCode === "product_view" && products.length)
        d = await post(ctx, `${TASK}/completeDailyTask`, x.auth, {
          taskType: 1,
          eventCode: "product_view",
          businessId: String(products[i % products.length]),
        });
      else break;
      out.push(`${TASKS[t.eventCode]}${i + 1}：${[0, 200].includes(Number(d?.code)) ? "成功" : d?.msg || "失败"}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return out;
}
const rt = createAccountRuntime({
  title: "台铃",
  shortName: "台铃",
  prefix: "G_TLG",
  defaultEnvName: "G_TLG_TOKEN",
  orderPrefix: "TLG",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "格式：备注#smartToken或Authorization#clientId（clientId可省略），支持批量换行",
      120000,
    );
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.split("#"),
          remark = p.shift(),
          auth = p.shift(),
          clientId = p.shift() || DEFAULT_CLIENT;
        if (!remark || !auth) throw new Error("格式错误");
        const x = { auth, clientId };
        await summary(ctx, x);
        rows.push({
          account: `tlg_${crypto.createHash("sha256").update(`${auth}_${clientId}`).digest("hex").slice(0, 16)}`,
          token: JSON.stringify(x),
          remark,
        });
      } catch (e) {
        await ctx.sender.reply(`台铃登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const q = await summary(ctx, parse(item.token));
    return `💰 总积分：${q.points}\n📅 今日签到：${q.signed ? "已签到" : "未签到"}\n🔥 累计签到：${q.days}天\n🗓️ 本周期已签：${q.cycle}天${q.next ? `\n🎁 下个奖励：${q.next}` : ""}`;
  },
  async handle(ctx, content) {
    if (!/运行/.test(content)) return;
    const userId = await ctx.currentUserId(),
      accounts = JSON.parse(await ctx.users.get(userId, "[]"));
    if (!accounts.length) return ctx.sender.reply("❌ 未找到账号，发送“台铃登录”绑定");
    for (const account of accounts) {
      const expires = String(await ctx.auth.get(account, "")),
        remark = await ctx.remarks.get(account, account);
      if (!expires || expires < date()) {
        await ctx.sender.reply(`❌ ${remark} 未授权或授权已过期`);
        continue;
      }
      try {
        const out = await run(ctx, parse(await ctx.tokens.get(account, "{}")));
        await ctx.sender.reply(
          `=====台铃运行=====\n👤 ${remark}\n${out.join("\n") || "没有待执行任务"}\n==================`,
        );
      } catch (e) {
        await ctx.sender.reply(`❌ ${remark} 运行失败：${e?.message || e}`);
      }
    }
  },
  async cronCheck(ctx, item) {
    return (await run(ctx, parse(item.token))).join("\n");
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${item.remark}#${x.auth}#${x.clientId}`;
  },
  tutorial:
    "=====台铃教程=====\n抓包 www.tailgdd.com 请求头 Authorization/smartToken；clientId可从请求头获取。\n登录格式：备注#Authorization#clientId。查询积分/签到，运行签到及社区、商品任务；授权后同步面板。\n指令：台铃登录、查询、运行、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`台铃执行失败：${e?.message || e}`));

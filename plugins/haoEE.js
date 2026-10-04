// [title: 好饿饿]
// [name: haoEE]
// [desc: 饿了么 Cookie 自动绑定、用户/吃货豆/乐园币/余额/果园/夺宝查询、授权及青龙同步。]
// [author: Lxg-021002]
// [version: v2.2.6]
// [rule: raw ^.*cookie2=.*$]
// [rule: raw ^(饿了么|饿了|好饿饿)(登录|登陆|上车|查询|管理|夺宝|授权|清理|教程)$]
// [cron: 28 8,18,21 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 60]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/好饿饿_v2.2.6_By.Lxg-021002.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const APP = "12574478";
function md5(x) {
  return crypto.createHash("md5").update(String(x)).digest("hex");
}
function cookieMap(c) {
  return Object.fromEntries(
    String(c || "")
      .replace(/^(chushi|zhuli);?/i, "")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.includes("="))
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), x.slice(i + 1)];
      }),
  );
}
function mergeCookie(c, set) {
  const m = cookieMap(c),
    raw = Array.isArray(set) ? set.join(";") : String(set || "");
  for (const key of ["_m_h5_tk", "_m_h5_tk_enc"]) {
    const x = raw.match(new RegExp(`${key}=([^;,]+)`));
    if (x) m[key] = x[1];
  }
  return (
    Object.entries(m)
      .map(([k, v]) => `${k}=${v}`)
      .join(";") + ";"
  );
}
async function refresh(ctx, c) {
  const r = await ctx.request(
      "https://waimai-guide.ele.me/h5/mtop.alsc.personal.queryminecenter/1.0/?jsv=2.6.2&appKey=12574478",
      { headers: { cookie: c, "user-agent": "Mozilla/5.0 Chrome/120.0" } },
    ),
    set = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : r.headers.get("set-cookie");
  return mergeCookie(c, set);
}
async function mtop(ctx, c, api, data, v = "1.0") {
  c = await refresh(ctx, c);
  const m = cookieMap(c),
    token = String(m._m_h5_tk || "").split("_")[0];
  if (!token) throw new Error("Cookie缺少_m_h5_tk");
  const t = Date.now(),
    sign = md5(`${token}&${t}&${APP}&${data}`),
    url = `https://guide-acs.m.taobao.com/h5/${api}/${v}/?jsv=2.6.1&appKey=${APP}&t=${t}&sign=${sign}&api=${api}&v=${v}&type=originaljson&dataType=json`,
    d = await ctx.requestJson(url, {
      method: "POST",
      headers: {
        cookie: c,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile",
      },
      form: { data },
    });
  if (/FAIL|过期|未登录/.test(JSON.stringify(d?.ret || d?.message || ""))) throw new Error("Cookie已失效");
  return { d, c };
}
async function user(ctx, c) {
  const r = await mtop(ctx, c, "mtop.alsc.user.detail.query", JSON.stringify({})),
    x = r.d?.data || {};
  if (!x.localId) throw new Error("未获取用户信息");
  return { localId: String(x.localId), mobile: x.encryptMobile || "", name: x.userName || "饿了么用户", cookie: r.c };
}
async function detail(ctx, c) {
  const u = await user(ctx, c),
    eat = (
      await mtop(
        ctx,
        c,
        "mtop.alibaba.svip.langrisser.query",
        JSON.stringify({
          lgrsRequestItems: '[{"backup":false,"count":1,"data":{"needHead":true,"month":""},"resId":"867018"}]',
          latitude: "33.76706790179014",
          longitude: "114.37013771384954",
        }),
      )
    ).d,
    ed = eat?.data?.data?.["867018"]?.data?.[0] || {},
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    todayEat = (ed.accountMonthRecords?.[0]?.records || [])
      .filter((x) => String(x.createdTime || "").startsWith(today) && Number(x.optType) !== 2)
      .reduce((n, x) => n + Number(x.count || 0), 0);
  let money = "--";
  try {
    const w = await ctx.requestJson("https://wallet.ele.me/api/storedcard/queryBalanceBycardType?cardType=platform", {
      headers: { cookie: c },
    });
    money = Number(w?.data?.totalAvailableAmount || 0) / 100;
  } catch {}
  let coin = "--";
  try {
    const r = await mtop(
      ctx,
      c,
      "mtop.koubei.interaction.center.common.queryintegralproperty.v2",
      JSON.stringify({ templateIds: '["1404"]' }),
    );
    coin = r.d?.data?.data?.["1404"]?.count ?? "--";
  } catch {}
  let orchard = "--";
  try {
    const r = await mtop(
        ctx,
        c,
        "mtop.alsc.playgame.orchard.index.batch.query",
        JSON.stringify({
          blockRequestList:
            '[{"blockCode":"603040_6723057310","status":"PUBLISH","tagCallWay":"SYNC","useRequestBlockTags":false}]',
          source: "KB_ORCHARD",
          bizCode: "main",
          locationInfos: '[{"latitude":"99.597472842782736","longitude":"99.75325090438128"}]',
          extData: '{"ORCHARD_ELE_MARK":"KB_ORCHARD","orchardVersion":"20240624"}',
        }),
      ),
      role = r.d?.data?.data?.["603040_6723057310"]?.blockData?.role?.tagData?.[0]?.result?.[0]?.roleInfoDtoList?.[0],
      e = role?.roleLevelExpInfoDto;
    if (e) orchard = `${(100 - Number(e.remainingProgress || 0)).toFixed(2)}/${e.levelName || ""}`;
  } catch {}
  return { u, eat: ed.peaCount ?? "--", todayEat, money, coin, orchard };
}
async function wins(ctx, c) {
  const d = (
    await mtop(
      ctx,
      c,
      "mtop.koubei.interactioncenter.snatch.mine.page",
      JSON.stringify({
        bizScene: "duobao_external",
        blockList: '["participants","wonDetail","noWonPrize"]',
        channel: "ELMC",
        pageSize: "50",
        rightId: "",
      }),
    )
  ).d;
  return (d?.data?.list || [])
    .filter(
      (x) =>
        !["ONLINE", "DRAWN"].includes(x.status) &&
        !["not_won_wait_accept", "not_won_has_finished"].includes(x.awardStatus),
    )
    .map((x) => x?.baseInfo?.title || "未知奖品");
}
const rt = createAccountRuntime({
  title: "好饿饿",
  shortName: "饿了么",
  prefix: "Yzyxmm_elm",
  defaultEnvName: "elmck",
  orderPrefix: "ELM",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入完整饿了么Cookie，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const c of input.split(/\r?\n/).filter(Boolean))
      try {
        const u = await user(ctx, c);
        rows.push({ account: u.localId, token: u.cookie || c.trim(), remark: u.name || u.mobile || u.localId });
      } catch (e) {
        await ctx.sender.reply(`饿了么登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async handle(ctx, content) {
    if (content.includes("cookie2=")) {
      try {
        const u = await user(ctx, content),
          userId = await ctx.currentUserId(),
          accounts = JSON.parse(await ctx.users.get(userId, "[]"));
        if (!accounts.includes(u.localId)) accounts.push(u.localId);
        await ctx.users.set(userId, JSON.stringify(accounts));
        await ctx.tokens.set(u.localId, u.cookie || content);
        await ctx.remarks.set(u.localId, u.name || u.mobile || u.localId);
        return ctx.sender.reply(`✅ 饿了么Cookie绑定成功：${u.name || u.mobile || u.localId}`);
      } catch (e) {
        return ctx.sender.reply(`❌ 饿了么Cookie绑定失败：${e?.message || e}`);
      }
    }
    if (/夺宝/.test(content)) {
      const userId = await ctx.currentUserId(),
        accounts = JSON.parse(await ctx.users.get(userId, "[]"));
      if (!accounts.length) return ctx.sender.reply("❌ 未找到账号，发送“饿了么登录”绑定");
      for (const account of accounts) {
        const remark = await ctx.remarks.get(account, account);
        try {
          const w = await wins(ctx, await ctx.tokens.get(account, ""));
          await ctx.sender.reply(`🍡 ${remark} 夺宝中奖：${w.join("、") || "暂无"}`);
        } catch (e) {
          await ctx.sender.reply(`❌ ${remark} 夺宝查询失败：${e?.message || e}`);
        }
      }
    }
  },
  async query(ctx, item) {
    const d = await detail(ctx, item.token),
      w = await wins(ctx, item.token);
    return `👤 用户：${d.u.name}\n📱 手机：${d.u.mobile}\n🍚 吃货豆：${d.eat}（今日+${d.todayEat}）\n🎮 乐园币：${d.coin}\n💵 余额：${d.money}元\n🍒 果树：${d.orchard}\n🍡 夺宝中奖：${w.join("、") || "暂无"}`;
  },
  async cronCheck(ctx, item) {
    try {
      const d = await detail(ctx, item.token),
        w = await wins(ctx, item.token);
      return `Cookie有效，吃货豆${d.eat}，今日+${d.todayEat}，乐园币${d.coin}${w.length ? `，夺宝中奖：${w.join("、")}` : ""}`;
    } catch (_) {
      return "饿了么Cookie已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====好饿饿教程=====\n抓包饿了么请求，复制包含 cookie2、_m_h5_tk 等字段的完整Cookie。\n查询吃货豆、今日收入、乐园币、余额、果园和夺宝中奖，授权后同步青龙变量 elmck。\n指令：饿了么登录、查询、管理、夺宝、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`好饿饿执行失败：${e?.message || e}`));

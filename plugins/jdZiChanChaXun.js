// [title: 京东资产查询]
// [name: jdZiChanChaXun]
// [desc: 查询京豆收支、余额、红包、优惠券及账号资料，支持个人/全局今日排名和程序化查询]
// [author: funyhook,qingge,hunyan,xiaoqing]
// [version: v2.7.0]
// [rule: ^(豆豆|豆豆查询|豆豆明细|京豆|资产查询|今日排名|昨日排名|京豆排名|个人排名|京豆统计|豆豆统计)$]
// [rule: ^指定明细\s+([\s\S]+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 查询类]
// [icon: https://www.jd.com/favicon.ico]
// [carry: true]
// [origin: backup/jd_今日京豆_v11_By.funyhook.txt;backup/jd_今日京豆_v11_By.xiaoqing.js;backup/JD豆豆明细_vv1.1.1_By.qingge.js;backup/O-资产查询_v2.6.3_By.xiaoqing.txt;backup/Y_查询_v2.1.1_By.hunyan.js;backup/Y_查询_v2.1.1_By.hunyan.txt;backup/今日京豆排名_v1.3.2_By.qingge.js;backup/今日京豆排名_v1.3.2_By.qingge.txt]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin, sender: s } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const notify = new Bucket("jdNotify");

const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙编号").min(1).default(1),
  env_name: plugin.Form.string().title("Cookie 环境变量名").default("JD_COOKIE"),
  query_all_for_admin: plugin.Form.boolean().title("管理员查询全部账号").default(true),
  max_detail_pages: plugin.Form.integer().title("京豆明细最多页数").min(1).max(20).default(4),
  show_red_packet: plugin.Form.boolean().title("查询红包").default(true),
  show_coupon: plugin.Form.boolean().title("查询优惠券").default(true),
  route_token: plugin.Form.string().title("程序化查询 Token").default(""),
});

async function main() {
  const cfg = normalize((await form.get()) || {});
  const content = String((await s.getMsg()) || "").trim();
  try {
    const ql = new container.QingLong({ id: cfg.qinglongId });
    let accounts = await visibleAccounts(ql, cfg);
    const selected = content.match(/^指定明细\s+(.+)$/)?.[1];
    if (selected) accounts = accounts.filter((item) => matchesPin(item, selected));
    if (!accounts.length) throw new Error("没有可查询的京东账号；请先提交 Cookie 并建立 jdNotify 绑定");
    const summaries = [];
    for (const account of accounts) summaries.push(await queryCookie(account.value, cfg, account));
    if (/排名|统计/.test(content)) return s.reply(renderRank(summaries, content));
    const detailed = /明细|豆豆/.test(content);
    return s.reply(summaries.map((item) => renderAssets(item, detailed)).join("\n\n"));
  } catch (error) {
    return s.reply(`京东资产查询失败：${core.errorText(error)}`);
  }
}

async function visibleAccounts(ql, cfg) {
  const rows = await core.activeCookies(ql, cfg.envName);
  if ((await s.isAdmin()) && cfg.queryAllForAdmin) return rows;
  const userId = String((await s.getUserId()) || ""),
    platform = String((await s.getPlatform()) || "");
  const allowed = new Set();
  const all = notify.getAll() || {};
  for (const [pin, raw] of Object.entries(all)) {
    let value = raw;
    try {
      value = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {}
    if (
      String(value?.user_id ?? value?.userId ?? value) === userId &&
      (!value?.imType || String(value.imType) === platform)
    )
      allowed.add(pin);
  }
  return rows.filter((item) => allowed.has(core.ptPin(item.value)) || allowed.has(core.decode(core.ptPin(item.value))));
}

async function queryCookie(cookie, cfg = normalize({}), account = {}) {
  const pin = core.ptPin(cookie);
  const result = {
    pin,
    name: account.remarks || account.remark || core.decode(pin),
    valid: true,
    bean: 0,
    todayIncome: 0,
    todayExpense: 0,
    yesterdayIncome: 0,
    yesterdayExpense: 0,
    redPacket: null,
    coupons: null,
    details: [],
  };
  try {
    const profile = await core.requestJson("https://me-api.jd.com/user_new/info/GetJDUserInfoUnion", {
      headers: core.cookieHeaders(cookie, { Referer: "https://home.m.jd.com/" }),
    });
    const base = profile?.data?.userInfo?.baseInfo || profile?.userInfo?.baseInfo || {};
    const asset = profile?.data?.assetInfo || profile?.assetInfo || {};
    result.name = base.nickname || base.curPin || result.name;
    result.bean = number(asset.beanNum ?? asset.jdBeanNum ?? base.jdNum ?? 0);
  } catch (error) {
    result.profileError = core.errorText(error);
  }
  for (let page = 1; page <= cfg.maxDetailPages; page += 1) {
    try {
      const data = await core.requestJson(`https://bean.m.jd.com/beanDetail/detail.json?page=${page}`, {
        headers: core.cookieHeaders(cookie, { Referer: "https://bean.m.jd.com/beanDetail/index.action" }),
      });
      const list = data?.jingDetailList || data?.detailList || data?.data?.detailList || [];
      if (!Array.isArray(list) || !list.length) break;
      for (const row of list) {
        const date = String(row.date || row.createDate || row.createTime || "");
        const amount = number(row.amount ?? row.beanNum ?? row.count ?? 0);
        const item = {
          date,
          amount,
          title: String(row.eventMassage || row.eventMessage || row.title || row.eventType || "京豆变动"),
        };
        result.details.push(item);
        const day = date.slice(0, 10);
        if (day === localDate(0)) amount >= 0 ? (result.todayIncome += amount) : (result.todayExpense += -amount);
        if (day === localDate(-1))
          amount >= 0 ? (result.yesterdayIncome += amount) : (result.yesterdayExpense += -amount);
      }
      if (
        list.length < 20 ||
        !list.some((row) => String(row.date || row.createDate || "").slice(0, 10) >= localDate(-1))
      )
        break;
    } catch (error) {
      result.detailError = core.errorText(error);
      break;
    }
  }
  if (cfg.showRedPacket) {
    try {
      const body = encodeURIComponent(
        JSON.stringify({ appId: "appHongBao", appToken: "apphongbao_token", platformId: "appHongBao" }),
      );
      const data = await core.requestJson(
        `https://api.m.jd.com/client.action?functionId=myhongbao_balance&body=${body}&appid=swat_miniprogram&client=android&clientVersion=12.1.4`,
        { headers: core.cookieHeaders(cookie) },
      );
      result.redPacket = number(data?.result?.balance ?? data?.data?.balance ?? data?.balance ?? 0);
    } catch (error) {
      result.redPacketError = core.errorText(error);
    }
  }
  if (cfg.showCoupon) {
    try {
      const data = await core.requestJson(
        "https://wq.jd.com/activeapi/queryjdcouponlistwithfinance?state=1&wxadd=1&filterswitch=1&_=" + Date.now(),
        { headers: core.cookieHeaders(cookie, { Referer: "https://wqs.jd.com/" }) },
      );
      const list = data?.coupon?.useable || data?.data?.couponList || data?.couponList || [];
      result.coupons = Array.isArray(list) ? list.length : number(data?.data?.count ?? 0);
    } catch (error) {
      result.couponError = core.errorText(error);
    }
  }
  result.valid = !result.profileError || result.details.length > 0;
  return result;
}

function renderAssets(value, detailed) {
  const lines = [
    `${value.name}（${core.decode(value.pin)}）`,
    `京豆：${value.bean}`,
    `今日：+${value.todayIncome} / -${value.todayExpense}`,
    `昨日：+${value.yesterdayIncome} / -${value.yesterdayExpense}`,
  ];
  if (value.redPacket !== null) lines.push(`红包：${value.redPacket}`);
  if (value.coupons !== null) lines.push(`可用优惠券：${value.coupons}`);
  if (detailed)
    lines.push(
      ...value.details
        .filter((item) => item.date.slice(0, 10) === localDate(0))
        .slice(0, 20)
        .map((item) => `${item.amount >= 0 ? "+" : ""}${item.amount} ${item.title}`),
    );
  if (value.profileError && !value.details.length) lines.push(`状态：${value.profileError}`);
  return lines.join("\n");
}

function renderRank(values, command) {
  const yesterday = command.startsWith("昨日");
  const field = yesterday ? "yesterdayIncome" : "todayIncome";
  const title = yesterday ? "昨日京豆排名" : "今日京豆排名";
  const sorted = [...values].sort((a, b) => b[field] - a[field]);
  return [
    title,
    ...sorted.map(
      (item, index) =>
        `${index + 1}. ${item.name} +${item[field]}（支出 ${yesterday ? item.yesterdayExpense : item.todayExpense}）`,
    ),
  ].join("\n");
}
function matchesPin(item, value) {
  const wanted = String(value).trim();
  return (
    core.ptPin(item.value) === wanted ||
    core.decode(core.ptPin(item.value)) === wanted ||
    String(item.remarks || item.remark || "").includes(wanted)
  );
}
function localDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function number(value) {
  const result = Number.parseFloat(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(result) ? result : 0;
}
function normalize(value) {
  return {
    qinglongId: Number(value.qinglong_id) || 1,
    envName: String(value.env_name || "JD_COOKIE"),
    queryAllForAdmin: value.query_all_for_admin !== false,
    maxDetailPages: Math.max(1, Math.min(20, Number(value.max_detail_pages) || 4)),
    showRedPacket: value.show_red_packet !== false,
    showCoupon: value.show_coupon !== false,
    routeToken: String(value.route_token || ""),
  };
}

main();
module.exports = { queryCookie, renderAssets, renderRank };

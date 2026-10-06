// [title: 京东农场管理]
// [name: jdNongChang]
// [desc: 新旧农场状态、浇水、助力、奖品推送及青龙农场任务管理]
// [author: qingge,specter,xiaoqing]
// [version: v4.4.0]
// [rule: ^(农场浇水|浇水|慢浇水|旧农场推送|新农场奖品推送|新农场助力|新农场助力2|新农场管理|新农场开通|新农场开关重置|单助力|新农场火爆|火爆推送|农场状态)$]
// [rule: ^新助力码助力\s+([\s\S]+)$]
// [rule: ^([\s\S]+)农场$]
// [cron: 59 8,14,18,23 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999999]
// [class: 工具类]
// [icon: https://fc-ccimage.baidu.com/0/pic/-1452396718_1569556084_-7398448.jpg]
// [carry: true]
// [origin: backup/东东农场推送版_v1.6.6_By.xiaoqing.txt;backup/农场浇水_v0.7.9_By.xiaoqing.txt;backup/农场管理_v4.3.9_By.specter.txt;backup/新农场助力_v0.3.2_By.qingge.txt]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin, sender: s, utils } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const state = new Bucket("jdNongChang"),
  notify = new Bucket("jdNotify");

const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙编号").min(1).default(1),
  env_name: plugin.Form.string().title("Cookie 环境变量名").default("JD_COOKIE"),
  h5st_api: plugin.Form.string()
    .title("H5ST 签名接口")
    .description("支持返回完整 URL、query 或 {body,data}")
    .default(""),
  water_times: plugin.Form.integer().title("每次浇水次数").min(1).max(100).default(10),
  water_delay_ms: plugin.Form.integer().title("浇水间隔毫秒").min(0).max(30000).default(1200),
  old_farm_task: plugin.Form.string().title("旧农场青龙任务关键词").default("东东农场"),
  new_farm_task: plugin.Form.string().title("新农场青龙任务关键词").default("新农场"),
  help_task: plugin.Form.string().title("农场助力任务关键词").default("农场助力"),
  push_admin: plugin.Form.boolean().title("定时结果推送管理员").default(true),
});

async function main() {
  const cfg = normalize((await form.get()) || {}),
    content = String((await s.getMsg()) || "").trim();
  try {
    const ql = new container.QingLong({ id: cfg.qinglongId });
    if (/开关重置/.test(content)) {
      state.deleteAll();
      return s.reply("新农场用户开关已重置");
    }
    if (/管理|开通/.test(content) || (/农场$/.test(content) && !/^(农场浇水|慢浇水|浇水)$/.test(content)))
      return manageUser(content);
    if (/助力|火爆/.test(content)) return runTask(ql, cfg.helpTask, content || "农场助力");
    const accounts = await visibleAccounts(ql, cfg.envName);
    if (!accounts.length) throw new Error("没有当前用户可用的 JD_COOKIE");
    if (/浇水/.test(content)) return waterAll(accounts, cfg, content === "慢浇水");
    if (/推送/.test(content) || !content) return pushStatus(accounts, cfg);
    return showStatus(accounts, cfg);
  } catch (error) {
    return s.reply(`京东农场执行失败：${core.errorText(error)}`);
  }
}

async function manageUser(content) {
  const key = `${await s.getPlatform()}:${await s.getUserId()}`;
  const old = parse(state.get(key));
  if (/关闭|停用/.test(content)) {
    state.set(key, JSON.stringify({ ...old, enabled: false }));
    return s.reply("你的农场自动任务已关闭");
  }
  state.set(key, JSON.stringify({ ...old, enabled: true, updated_at: Date.now() }));
  return s.reply("你的农场自动任务已开启；发送“农场浇水”“农场状态”执行");
}

async function visibleAccounts(ql, envName) {
  const rows = await core.activeCookies(ql, envName);
  if (await s.isAdmin()) return rows;
  const uid = String((await s.getUserId()) || ""),
    platform = String((await s.getPlatform()) || ""),
    pins = new Set();
  for (const [pin, raw] of Object.entries(notify.getAll() || {})) {
    const item = parse(raw);
    if (String(item.user_id ?? item.userId ?? item) === uid && (!item.imType || item.imType === platform))
      pins.add(pin);
  }
  return rows.filter((item) => pins.has(core.ptPin(item.value)) || pins.has(core.decode(core.ptPin(item.value))));
}

async function showStatus(accounts, cfg) {
  const lines = ["京东农场状态"];
  for (const account of accounts) {
    const value = await farmHome(account.value, cfg);
    lines.push(formatStatus(account, value));
  }
  return s.reply(lines.join("\n\n"));
}

async function pushStatus(accounts, cfg) {
  const report = [];
  for (const account of accounts) {
    try {
      report.push(formatStatus(account, await farmHome(account.value, cfg)));
    } catch (error) {
      report.push(`${label(account)}：${core.errorText(error)}`);
    }
  }
  const message = `农场奖品/成熟状态\n${report.join("\n\n")}`;
  if (cfg.pushAdmin) await s.pushAdmin(message);
  return s.reply(message);
}

async function waterAll(accounts, cfg, slow) {
  if (!cfg.h5stApi) return runTask(new container.QingLong({ id: cfg.qinglongId }), cfg.oldFarmTask, "农场浇水");
  const reports = [];
  for (const account of accounts) {
    let success = 0,
      last = "";
    for (let index = 0; index < cfg.waterTimes; index += 1) {
      const home = await farmHome(account.value, cfg);
      const body = {
        babelChannel: "121",
        version: 19,
        channel: 1,
        farmId: home.farmId || home.farmUserPro?.farmId || "",
      };
      const data = await signedCall("farm_water", body, account.value, cfg);
      last = String(data?.message || data?.msg || data?.result?.message || "");
      if (data?.code === 0 || data?.success === true || data?.resultCode === 0) success += 1;
      else break;
      await utils.sleep(slow ? Math.max(cfg.waterDelayMs, 5000) : cfg.waterDelayMs);
    }
    reports.push(`${label(account)}：成功浇水 ${success} 次${last ? `，${last}` : ""}`);
  }
  return s.reply(reports.join("\n"));
}

async function farmHome(cookie, cfg) {
  const body = { babelChannel: "121", version: 19, channel: 1, lat: "", lng: "" };
  if (cfg.h5stApi) return signedCall("farm_home", body, cookie, cfg);
  const url = `https://api.m.jd.com/client.action?appid=signed_wh5&functionId=farm_home&body=${encodeURIComponent(JSON.stringify(body))}&t=${Date.now()}&client=android&clientVersion=12.2.2`;
  return core.requestJson(url, { headers: core.cookieHeaders(cookie, { Referer: "https://h5.m.jd.com/" }) });
}

async function signedCall(functionId, body, cookie, cfg) {
  const endpoint = cfg.h5stApi.replace(/\/+$/, "");
  const signPayload = await core.requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fn: functionId,
      functionId,
      body,
      appId: "signed_wh5",
      appid: "signed_wh5",
      client: "android",
      clientVersion: "12.2.2",
    }),
  });
  let url = signPayload?.url || signPayload?.data?.url;
  if (!url) {
    const query = signPayload?.body || signPayload?.data?.convertUrl || signPayload?.data?.body || signPayload?.query;
    url = `https://api.m.jd.com/client.action?functionId=${functionId}&${String(query || "body=" + encodeURIComponent(JSON.stringify(body)))}`;
  }
  return core.requestJson(url, {
    method: signPayload?.method || "GET",
    headers: core.cookieHeaders(cookie, { Referer: "https://h5.m.jd.com/" }),
  });
}

async function runTask(ql, keyword, labelText) {
  const tasks = core
    .unwrap(await ql.request("GET", "/crons", null, { searchValue: keyword }))
    .filter((item) => `${item.name || ""}\n${item.command || ""}`.includes(keyword));
  const ids = tasks.map(core.envId).filter(Boolean);
  if (!ids.length) throw new Error(`未找到青龙任务：${keyword}`);
  await ql.request("PUT", "/crons/run", ids);
  return s.reply(`${labelText}：已运行 ${tasks.length} 个青龙任务`);
}

function formatStatus(account, value) {
  const data = value?.data || value?.result || value || {},
    farm = data.farmUserPro || data.farmUser || data;
  const tree = farm.treeName || farm.name || "农场";
  const progress =
    farm.treeEnergy !== undefined && farm.treeTotalEnergy
      ? `${farm.treeEnergy}/${farm.treeTotalEnergy}`
      : farm.progress || "未知";
  const water = farm.totalEnergy ?? farm.water ?? data.totalEnergy ?? "未知";
  const prize = data.prizeName || farm.prizeName || data.goodsName || "未返回";
  return `${label(account)}\n作物：${tree}\n进度：${progress}\n水滴：${water}\n奖品：${prize}`;
}
function label(account) {
  return String(account.remarks || account.remark || core.decode(core.ptPin(account.value)) || "京东账号");
}
function parse(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch (_) {
    return {};
  }
}
function normalize(value) {
  return {
    qinglongId: Number(value.qinglong_id) || 1,
    envName: String(value.env_name || "JD_COOKIE"),
    h5stApi: String(value.h5st_api || "").trim(),
    waterTimes: Math.max(1, Math.min(100, Number(value.water_times) || 10)),
    waterDelayMs: Math.max(0, Number(value.water_delay_ms) || 1200),
    oldFarmTask: String(value.old_farm_task || "东东农场"),
    newFarmTask: String(value.new_farm_task || "新农场"),
    helpTask: String(value.help_task || "农场助力"),
    pushAdmin: value.push_admin !== false,
  };
}

main();
module.exports = { farmHome, signedCall, waterAll, pushStatus };

// [title: 京东活动监控]
// [name: jdHuoDongJianKong]
// [desc: 解析关注有礼、接收活动通知、缓存未来活动并监控 GitHub 开卡脚本，按需拉库及运行青龙任务]
// [author: funyhook,hdbjlizhe,qingge,zq8884]
// [version: v1.8.0]
// [rule: raw ^([\s\S]*关注有礼[\s\S]*)$]
// [rule: ^(开卡监控|kkjk|kk|开卡监控配置|未来活动|活动监控状态)$]
// [rule: ^活动通知\s+([\s\S]+)$]
// [cron: */1 * * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 777777777]
// [class: 工具类]
// [icon: https://www.jd.com/favicon.ico]
// [carry: true]
// [origin: backup/JD关注有礼_vv1.0.6_By.hdbjlizhe.txt;backup/JD未来活动定时pro_v1.7.5_By.zq8884.txt;backup/JD未来活动通知_v1.3.3_By.qingge.js;backup/开卡监控pro_v10_By.funyhook.txt]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin, sender: s } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const cache = new Bucket("jdHuoDongJianKong");

const form = new plugin.Form({
  qinglong_ids: plugin.Form.string().title("青龙编号").description("多个用逗号分隔").default("1"),
  github_repos: plugin.Form.string()
    .title("监控仓库")
    .description("owner/repo:branch，每行一个")
    .widget("textarea")
    .default(
      "9Rebels/jdmax:main\nfeverrun/my_scripts:main\nHarbourJ/HarbourToulu:main\nsmiek2121/scripts:master\nshufflewzc/faker3:main\nwalle1798/WALL.E:master\n6dylan6/jdpro:main",
    ),
  github_token: plugin.Form.string().title("GitHub Token").default(""),
  script_keywords: plugin.Form.string().title("开卡脚本关键词").default("open,dplh,jd_card"),
  subscription_keywords: plugin.Form.string().title("拉库任务关键词").default(""),
  activity_task_keyword: plugin.Form.string()
    .title("未来活动青龙任务关键词")
    .default("M_UTOPIA,M_WX_LUCK_DRAW,M_WX_SHOP_GIFT"),
  push_admin: plugin.Form.boolean().title("新脚本/活动推送管理员").default(true),
  activity_advance_seconds: plugin.Form.integer().title("活动提前运行秒数").min(0).max(3600).default(30),
  notification_blacklist: plugin.Form.string().title("通知黑名单关键词").default(""),
});

async function main() {
  const cfg = normalize((await form.get()) || {}),
    content = String((await s.getMsg()) || "").trim();
  try {
    if (content.includes("关注有礼")) return followGift(content, cfg);
    if (content.startsWith("活动通知 ")) return handleNotification(content.slice(5), cfg);
    if (content === "开卡监控配置" || content === "活动监控状态") return status(cfg);
    if (/^(开卡监控|kkjk|kk)$/.test(content)) {
      if (!(await s.isAdmin())) return s.reply("仅管理员可运行开卡监控");
      return monitorRepositories(cfg, true);
    }
    if (content === "未来活动") return listActivities();
    if (!content) {
      await runDueActivities(cfg);
      return monitorRepositories(cfg, false);
    }
    return status(cfg);
  } catch (error) {
    return s.reply(`京东活动监控失败：${core.errorText(error)}`);
  }
}

async function followGift(content, cfg) {
  const shorts = [
    ...new Set(
      [...content.matchAll(/(?:https?:\/\/)?u\.jd\.com\/[0-9a-zA-Z]{7}/g)].map((item) =>
        item[0].startsWith("http") ? item[0] : `https://${item[0]}`,
      ),
    ),
  ];
  if (!shorts.length) throw new Error("未找到 u.jd.com 七位短链");
  const urls = [],
    shopIds = [];
  for (const short of shorts) {
    const response = await core.request(short);
    let target =
      response.headers.location ||
      response.text.match(/hrl=['"](.+?)['"]/i)?.[1] ||
      response.text.match(/location\.href\s*=\s*['"](.+?)['"]/i)?.[1] ||
      "";
    if (target) {
      try {
        const followed = await core.request(target);
        target = followed.headers.location || target;
      } catch (_) {}
      urls.push(target);
      const shopId = target.match(/[?&]shopId=(\d{5,})/i)?.[1];
      if (shopId) shopIds.push(shopId);
    }
  }
  if (!urls.length) throw new Error("短链中未解析到活动地址");
  const reports = [`export M_FOLLOW_SHOP_ARGV="${urls[0]}"`];
  if (shopIds.length) reports.push(`export jd_shopFollowGiftId="${[...new Set(shopIds)].join("&")}"`);
  for (const id of cfg.qinglongIds) {
    const ql = new container.QingLong({ id });
    await upsertRawEnv(ql, "M_FOLLOW_SHOP_ARGV", urls.join("@"));
    if (shopIds.length) await upsertRawEnv(ql, "jd_shopFollowGiftId", [...new Set(shopIds)].join("&"));
    await runMatchingCrons(ql, ["关注有礼", "shopFollow", "M_FOLLOW_SHOP"]);
  }
  return s.reply(reports.join("\n"));
}

async function handleNotification(input, cfg = normalize({})) {
  let payload = input;
  try {
    payload = typeof input === "string" && /^\s*[[{]/.test(input) ? JSON.parse(input) : input;
  } catch (_) {}
  const text =
    typeof payload === "string"
      ? payload
      : String(payload?.message || payload?.content || payload?.msg || JSON.stringify(payload));
  if (cfg.blacklist.some((word) => text.includes(word))) return { ignored: true, reason: "blacklist" };
  const activities = extractActivities(text),
    stored = loadActivities();
  for (const item of activities) if (!stored.some((old) => old.key === item.key)) stored.push(item);
  saveActivities(stored);
  const beans = [...text.matchAll(/(?:京豆|豆豆)[^\d]{0,8}(\d+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  const physical = /实物|奖品|中奖/.test(text);
  if (cfg.pushAdmin && (activities.length || beans || physical))
    await s.pushAdmin(
      `京东活动通知\n${text.slice(0, 1800)}\n识别活动：${activities.length}，京豆：${beans}${physical ? "，含实物信息" : ""}`,
    );
  return { accepted: true, activities: activities.length, beans, physical };
}

function extractActivities(text) {
  const urls = [
    ...new Set([...String(text).matchAll(/https?:\/\/[^\s"'<>]+/g)].map((item) => item[0].replace(/[),，。]+$/, ""))),
  ];
  const dates = [
    ...String(text).matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/g),
  ];
  const result = [];
  for (const match of dates) {
    const startAt = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
    ).getTime();
    const url =
      urls.find(
        (value) => String(text).indexOf(value) >= match.index - 500 && String(text).indexOf(value) <= match.index + 500,
      ) ||
      urls[0] ||
      "";
    result.push({
      key: `${startAt}:${url}`,
      start_at: startAt,
      url,
      text: String(text).slice(Math.max(0, match.index - 120), match.index + 220),
      status: "pending",
      created_at: Date.now(),
    });
  }
  return result;
}

async function runDueActivities(cfg) {
  const rows = loadActivities(),
    now = Date.now();
  let changed = false;
  for (const item of rows) {
    if (item.status !== "pending" || item.start_at - cfg.advanceSeconds * 1000 > now || item.start_at + 3600000 < now)
      continue;
    for (const id of cfg.qinglongIds) {
      const ql = new container.QingLong({ id });
      if (item.url) await upsertRawEnv(ql, activityEnvName(item.url), item.url);
      await runMatchingCrons(ql, cfg.activityTaskKeywords);
    }
    item.status = "run";
    item.run_at = now;
    changed = true;
  }
  if (changed) saveActivities(rows);
}

async function monitorRepositories(cfg, interactive) {
  const additions = [];
  for (const repo of cfg.repos) {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "sillyGirl-jd-monitor" };
    if (cfg.githubToken) headers.Authorization = `Bearer ${cfg.githubToken}`;
    const data = await core.requestJson(
      `https://api.github.com/repos/${repo.name}/git/trees/${encodeURIComponent(repo.branch)}?recursive=1`,
      { headers },
    );
    const paths = (data?.tree || [])
      .filter((item) => item.type === "blob")
      .map((item) => item.path)
      .filter((path) => cfg.scriptKeywords.some((word) => path.toLowerCase().includes(word.toLowerCase())));
    const key = `repo:${repo.name}:${repo.branch}`;
    const old = parseArray(cache.get(key));
    const fresh = old.length ? paths.filter((path) => !old.includes(path)) : [];
    cache.set(key, JSON.stringify(paths));
    if (fresh.length) {
      additions.push({ repo, paths: fresh });
      for (const id of cfg.qinglongIds) {
        const ql = new container.QingLong({ id });
        await runMatchingSubscriptions(
          ql,
          cfg.subscriptionKeywords.length ? cfg.subscriptionKeywords : [repo.name.split("/")[1], repo.name],
        );
        await runMatchingCrons(
          ql,
          fresh.map((path) =>
            path
              .split("/")
              .pop()
              .replace(/\.[^.]+$/, ""),
          ),
        );
      }
    }
  }
  if (additions.length) {
    const message = [
      "开卡监控发现新脚本",
      ...additions.flatMap((item) => [`${item.repo.name}@${item.repo.branch}`, ...item.paths.slice(0, 30)]),
    ].join("\n");
    if (cfg.pushAdmin) await s.pushAdmin(message);
    if (interactive) return s.reply(message);
  }
  if (interactive) return s.reply(`开卡监控完成：${cfg.repos.length} 个仓库，无新增匹配脚本`);
}

async function runMatchingSubscriptions(ql, keywords) {
  for (const api of ["/subscriptions", "/crons"]) {
    const rows = core.unwrap(await ql.request("GET", api));
    const matched = rows.filter((item) =>
      keywords.some((word) => `${item.name || ""}\n${item.command || ""}`.includes(word)),
    );
    const ids = matched.map(core.envId).filter(Boolean);
    if (ids.length) {
      await ql.request("PUT", `${api}/run`, ids);
      return ids.length;
    }
  }
  return 0;
}
async function runMatchingCrons(ql, keywords) {
  const rows = core.unwrap(await ql.request("GET", "/crons"));
  const matched = rows.filter((item) =>
    keywords.some(
      (word) => word && `${item.name || ""}\n${item.command || ""}`.toLowerCase().includes(String(word).toLowerCase()),
    ),
  );
  const ids = matched.map(core.envId).filter(Boolean);
  if (ids.length) await ql.request("PUT", "/crons/run", ids);
  return ids.length;
}
async function upsertRawEnv(ql, name, value) {
  const rows = core.unwrap(await ql.getEnvs({ searchValue: name })).filter((item) => item.name === name),
    old = rows[0];
  if (old) await ql.updateEnv({ id: core.envId(old), name, value, remarks: old.remarks || "京东活动监控" });
  else await ql.createEnv({ name, value, remarks: "京东活动监控" });
}
function activityEnvName(url) {
  if (/lzkj|wxDraw|luck/i.test(url)) return "M_WX_LUCK_DRAW_URL";
  if (/shopGift|follow/i.test(url)) return "M_FOLLOW_SHOP_ARGV";
  return "M_UTOPIA_ACTINFO";
}
async function status(cfg) {
  return s.reply(
    `京东活动监控\n青龙：${cfg.qinglongIds.join(",")}\n仓库：${cfg.repos.length}\n脚本关键词：${cfg.scriptKeywords.join(",")}\n未来活动：${loadActivities().filter((item) => item.status === "pending").length}`,
  );
}
async function listActivities() {
  const rows = loadActivities()
    .filter((item) => item.status === "pending")
    .sort((a, b) => a.start_at - b.start_at);
  return s.reply(
    rows.length
      ? [
          "未来活动",
          ...rows
            .slice(0, 30)
            .map((item, index) => `${index + 1}. ${new Date(item.start_at).toLocaleString()} ${item.url || item.text}`),
        ].join("\n")
      : "暂无未来活动",
  );
}
function loadActivities() {
  return parseArray(cache.get("activities"));
}
function saveActivities(rows) {
  cache.set("activities", JSON.stringify(rows.filter((item) => item.start_at > Date.now() - 86400000).slice(-500)));
}
function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const data = JSON.parse(String(value || "[]"));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}
function normalize(value) {
  const repos = String(value.github_repos || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.lastIndexOf(":");
      return index > line.indexOf("/")
        ? { name: line.slice(0, index).replace(/\.git$/, ""), branch: line.slice(index + 1) || "main" }
        : { name: line.replace(/\.git$/, ""), branch: "main" };
    });
  return {
    qinglongIds: core.parseIds(value.qinglong_ids, [1]),
    repos,
    githubToken: String(value.github_token || ""),
    scriptKeywords: split(value.script_keywords || "open,dplh,jd_card"),
    subscriptionKeywords: split(value.subscription_keywords),
    activityTaskKeywords: split(value.activity_task_keyword || "M_UTOPIA,M_WX_LUCK_DRAW,M_WX_SHOP_GIFT"),
    pushAdmin: value.push_admin !== false,
    advanceSeconds: Math.max(0, Number(value.activity_advance_seconds) || 30),
    blacklist: split(value.notification_blacklist),
  };
}
function split(value) {
  return String(value || "")
    .split(/[,，;；\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

main();
module.exports = { followGift, handleNotification, extractActivities, runDueActivities, monitorRepositories };

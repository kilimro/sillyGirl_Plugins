// [title: 京东工具]
// [name: jingDongGongJu]
// [desc: 合并 Python 中重复的京东维护入口，使用 SillyGirl 青龙导出完成 CK 去重、失效汇总、跨容器传输和任务触发]
// [author: sillyGirl]
// [version: v1.0.0]
// [rule: ^(COOKIE处理|JD失效通知|传输CK|JD店铺签到|M实物查询|实物查询|自动评价|京东工具)$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/shopping-cart.svg]
// [origin: backup/COOKIE处理_v2.5.0_By.1934103887.py;backup/JD失效通知_v1.2.2_By.chuan.py;backup/JD店铺签到_v3.0.10_By.buzhi.py;backup/M实物查询_v2.0.6_By.buzhi.py;backup/传输CK_v2.2_By.zq8884.py;backup/查询实物中奖—全支持版_v1.3.0_By.ahhhahh.py;backup/自动评价_v1.4.8_By.specter.py]
// [depe: []]

const { container, plugin, sender: s } = require("sillygirl");

const form = new plugin.Form({
  source_id: plugin.Form.integer().title("源青龙编号").min(1).default(1),
  target_id: plugin.Form.integer().title("目标青龙编号").min(1).default(2),
  env_name: plugin.Form.string().title("CK 环境变量名").default("JD_COOKIE"),
  transfer_limit: plugin.Form.integer().title("最多传输数量").min(1).default(50),
  shop_task: plugin.Form.string().title("店铺签到任务关键词").default("店铺签到"),
  prize_task: plugin.Form.string().title("实物查询任务关键词").default("实物查询"),
  review_task: plugin.Form.string().title("自动评价任务关键词").default("自动评价"),
});

async function main() {
  try {
    if (!(await s.isAdmin())) return s.reply("仅管理员可用");
    const cfg = normalize(await form.get());
    const content = String((await s.getMsg()) || "").trim();
    const source = new container.QingLong({ id: cfg.sourceId });
    if (content === "COOKIE处理") return dedupe(source, cfg.envName);
    if (content === "JD失效通知") return invalidReport(source, cfg.envName);
    if (content === "传输CK") return transfer(source, new container.QingLong({ id: cfg.targetId }), cfg);
    if (content === "JD店铺签到") return runTask(source, cfg.shopTask, "店铺签到");
    if (/^(M实物查询|实物查询)$/.test(content)) return runTask(source, cfg.prizeTask, "实物查询");
    if (content === "自动评价") return runTask(source, cfg.reviewTask, "自动评价");
    const envs = named(await source.getEnvs({ searchValue: cfg.envName }), cfg.envName);
    return s.reply(
      `京东工具：CK ${envs.length} 个，启用 ${envs.filter((item) => !item.status).length} 个\n指令：COOKIE处理 / JD失效通知 / 传输CK / JD店铺签到 / 实物查询 / 自动评价`,
    );
  } catch (error) {
    return s.reply(`京东工具执行失败：${err(error)}`);
  }
}

async function dedupe(ql, envName) {
  const rows = named(await ql.getEnvs({ searchValue: envName }), envName);
  const seen = new Map();
  const duplicateIds = [];
  for (const item of rows) {
    const pin = ptPin(item.value);
    if (!pin) continue;
    const old = seen.get(pin);
    if (!old || (old.status && !item.status)) {
      if (old && envId(old)) duplicateIds.push(envId(old));
      seen.set(pin, item);
    } else if (envId(item)) duplicateIds.push(envId(item));
  }
  if (duplicateIds.length) await ql.disableEnvs(duplicateIds);
  return s.reply(`COOKIE处理完成：总数 ${rows.length}，唯一账号 ${seen.size}，禁用重复 ${duplicateIds.length}`);
}

async function invalidReport(ql, envName) {
  const rows = named(await ql.getEnvs({ searchValue: envName }), envName);
  const disabled = rows.filter((item) => Boolean(item.status));
  const text = [
    `JD失效账号：${disabled.length}/${rows.length}`,
    ...disabled
      .slice(0, 80)
      .map((item, index) => `${index + 1}. ${decode(ptPin(item.value) || item.remarks || "未知")}`),
  ].join("\n");
  await s.pushAdmin(text);
  return s.reply(text);
}

async function transfer(source, target, cfg) {
  const sourceRows = named(await source.getEnvs({ searchValue: cfg.envName }), cfg.envName)
    .filter((item) => !item.status)
    .slice(-cfg.limit);
  const targetRows = named(await target.getEnvs({ searchValue: cfg.envName }), cfg.envName);
  let created = 0;
  let updated = 0;
  for (const item of sourceRows) {
    const pin = ptPin(item.value);
    const old = targetRows.find((row) => ptPin(row.value) === pin);
    const env = { name: cfg.envName, value: item.value, remarks: item.remarks || item.remark || decode(pin) };
    if (old) {
      await target.updateEnv({ ...env, id: envId(old) });
      updated += 1;
    } else {
      await target.createEnv(env);
      created += 1;
    }
  }
  return s.reply(`传输CK完成：新增 ${created}，更新 ${updated}，目标容器 #${cfg.targetId}`);
}

async function runTask(ql, keyword, label) {
  const response = await ql.request("GET", "/crons", null, { searchValue: keyword });
  const tasks = list(response).filter((task) => `${task.name || ""}\n${task.command || ""}`.includes(keyword));
  const ids = tasks.map(envId).filter((id) => id !== undefined && id !== null);
  if (!ids.length) return s.reply(`未找到青龙任务：${keyword}`);
  await ql.request("PUT", "/crons/run", ids);
  return s.reply(`${label}已触发：${tasks.length} 个任务`);
}

function named(value, name) {
  return list(value).filter((item) => item?.name === name);
}
function list(value) {
  let data = value;
  for (let i = 0; i < 4 && data && !Array.isArray(data); i += 1) data = data.data ?? data.items ?? data.list;
  return Array.isArray(data) ? data : [];
}
function ptPin(cookie) {
  return String(cookie || "").match(/(?:^|;\s*)pt_pin=([^;]+)/)?.[1] || "";
}
function decode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}
function envId(item) {
  return item?.id ?? item?._id;
}
function normalize(raw) {
  const value = raw || {};
  const envName = String(value.env_name || "JD_COOKIE").trim();
  if (!/^[A-Za-z_]\w*$/.test(envName)) throw new Error("环境变量名格式错误");
  return {
    sourceId: Number(value.source_id) || 1,
    targetId: Number(value.target_id) || 2,
    envName,
    limit: Number(value.transfer_limit) || 50,
    shopTask: String(value.shop_task || "店铺签到").trim(),
    prizeTask: String(value.prize_task || "实物查询").trim(),
    reviewTask: String(value.review_task || "自动评价").trim(),
  };
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

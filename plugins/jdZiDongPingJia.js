// [title: 京东自动评价]
// [name: jdZiDongPingJia]
// [desc: 按用户 PIN 排队运行青龙自动评价任务，支持 6dy/盖亚任务、直接评价接口、进度检测和状态恢复]
// [author: qingge,hunyan,specter]
// [version: v1.5.0]
// [rule: ^(评价|自动评价|京东自动评价|检测评价|评价重置|评价版本)$]
// [cron: 5 */1 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 99999]
// [class: 工具类]
// [icon: https://www.jd.com/favicon.ico]
// [carry: true]
// [origin: backup/JD自动评价_v0.1.0_By.qingge.js;backup/京东自动评价_v1.0.3_By.hunyan.js;backup/自动评价_v1.4.8_By.specter.py;backup/自动评价_v1.4.8_By.specter.txt]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin, sender: s, utils } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const queueStore = new Bucket("jdZiDongPingJia.queue"),
  notify = new Bucket("jdNotify");

const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙编号").min(1).default(1),
  env_name: plugin.Form.string().title("Cookie 环境变量名").default("JD_COOKIE"),
  task_keyword: plugin.Form.string().title("评价任务关键词").default("自动评价"),
  direct_api: plugin.Form.string()
    .title("直接评价接口")
    .description("留空使用青龙任务；填写后 POST {cookie,pin}")
    .default(""),
  admin_all_accounts: plugin.Form.boolean().title("管理员评价全部账号").default(true),
  isolate_accounts: plugin.Form.boolean().title("运行时仅启用本次账号").default(true),
  wait_timeout_minutes: plugin.Form.integer().title("任务超时分钟").min(1).max(180).default(30),
  process_on_submit: plugin.Form.boolean().title("提交后立即处理队列").default(true),
});

async function main() {
  const cfg = normalize((await form.get()) || {}),
    content = String((await s.getMsg()) || "").trim();
  try {
    if (content === "评价版本") return s.reply("京东自动评价 v1.5.0：队列、账号隔离、青龙任务/直接接口双模式");
    if (content === "评价重置") return resetQueue();
    if (content === "检测评价") return reportQueue();
    if (!content) return processNext(cfg);
    if (/^(评价|自动评价|京东自动评价)$/.test(content)) return enqueue(cfg);
    return reportQueue();
  } catch (error) {
    return s.reply(`京东自动评价失败：${core.errorText(error)}`);
  }
}

async function enqueue(cfg) {
  const ql = new container.QingLong({ id: cfg.qinglongId }),
    rows = await visibleAccounts(ql, cfg);
  if (!rows.length) throw new Error("当前用户没有可评价的京东账号");
  const queue = loadQueue(),
    existing = new Set(
      queue.filter((job) => job.status === "pending" || job.status === "running").flatMap((job) => job.pins),
    );
  const pins = rows.map((item) => core.ptPin(item.value)).filter((pin) => !existing.has(pin));
  if (!pins.length) return s.reply("你的账号已经在评价队列中");
  queue.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    user_id: String((await s.getUserId()) || ""),
    platform: String((await s.getPlatform()) || ""),
    pins,
    created_at: Date.now(),
    status: "pending",
    result: "",
  });
  saveQueue(queue);
  await s.reply(
    `已加入自动评价队列：${pins.length} 个账号，当前排队 ${queue.filter((job) => job.status === "pending").length} 组`,
  );
  if (cfg.processOnSubmit && !queue.some((job) => job.status === "running")) return processNext(cfg);
}

async function processNext(cfg) {
  const queue = loadQueue(),
    running = queue.find((job) => job.status === "running");
  if (running) return s.reply(`评价任务正在运行：${running.pins.length} 个账号`);
  const job = queue.find((item) => item.status === "pending");
  if (!job) return undefined;
  job.status = "running";
  job.started_at = Date.now();
  saveQueue(queue);
  const ql = new container.QingLong({ id: cfg.qinglongId });
  try {
    const rows = await core.qlEnvs(ql, cfg.envName),
      selected = rows.filter((item) => job.pins.includes(core.ptPin(item.value)));
    if (!selected.length) throw new Error("队列中的 Cookie 已不存在");
    let result;
    if (cfg.directApi) result = await runDirectApi(selected, cfg);
    else result = await runQingLong(selected, rows, ql, cfg);
    job.status = "done";
    job.result = result;
    job.finished_at = Date.now();
    saveQueue(queue);
    await s.pushAdmin(`自动评价完成：${selected.length} 个账号\n${result}`);
    return s.reply(`自动评价完成：${result}`);
  } catch (error) {
    job.status = "failed";
    job.result = core.errorText(error);
    job.finished_at = Date.now();
    saveQueue(queue);
    throw error;
  }
}

async function runDirectApi(rows, cfg) {
  const reports = [];
  for (const item of rows) {
    const data = await core.requestJson(cfg.directApi, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookie: item.value,
        pin: core.ptPin(item.value),
        remark: item.remarks || item.remark || "",
      }),
    });
    reports.push(
      `${item.remarks || core.decode(core.ptPin(item.value))}：${data?.message || data?.msg || (data?.success === false ? "失败" : "已提交")}`,
    );
  }
  return reports.join("\n");
}

async function runQingLong(selected, allRows, ql, cfg) {
  const tasks = core
    .unwrap(await ql.request("GET", "/crons", null, { searchValue: cfg.taskKeyword }))
    .filter((item) => `${item.name || ""}\n${item.command || ""}`.includes(cfg.taskKeyword));
  if (!tasks.length) throw new Error(`未找到评价任务：${cfg.taskKeyword}`);
  const initiallyEnabled = allRows
      .filter((item) => !item.status)
      .map(core.envId)
      .filter(Boolean),
    selectedIds = selected.map(core.envId).filter(Boolean);
  try {
    if (cfg.isolateAccounts) {
      const disableIds = allRows
        .filter((item) => !item.status && !selectedIds.includes(core.envId(item)))
        .map(core.envId)
        .filter(Boolean);
      if (disableIds.length) await ql.disableEnvs(disableIds);
      if (selectedIds.length && typeof ql.enableEnvs === "function") await ql.enableEnvs(selectedIds);
    }
    const taskIds = tasks.map(core.envId).filter(Boolean);
    await ql.request("PUT", "/crons/run", taskIds);
    await waitTasks(ql, taskIds, cfg.waitTimeoutMinutes * 60000);
    const logs = [];
    for (const task of tasks) {
      try {
        const value = await ql.request("GET", `/crons/${core.envId(task)}/log`);
        const text = String(value?.data ?? value?.value ?? value ?? "");
        logs.push(`${task.name || task.command}: ${tail(text, 4)}`);
      } catch (_) {}
    }
    return logs.join("\n") || `已运行 ${tasks.length} 个青龙评价任务`;
  } finally {
    if (cfg.isolateAccounts) {
      const current = await core.qlEnvs(ql, cfg.envName),
        activeNow = current
          .filter((item) => !item.status)
          .map(core.envId)
          .filter(Boolean),
        shouldDisable = activeNow.filter((id) => !initiallyEnabled.includes(id)),
        shouldEnable = initiallyEnabled.filter((id) => !activeNow.includes(id));
      if (shouldDisable.length) await ql.disableEnvs(shouldDisable);
      if (shouldEnable.length && typeof ql.enableEnvs === "function") await ql.enableEnvs(shouldEnable);
    }
  }
}

async function waitTasks(ql, ids, timeout) {
  const deadline = Date.now() + timeout;
  await utils.sleep(2500);
  while (Date.now() < deadline) {
    const tasks = core.unwrap(await ql.request("GET", "/crons"));
    const selected = tasks.filter((item) => ids.includes(core.envId(item)));
    if (selected.length && selected.every((item) => !item.isRunning && !item.pid)) return;
    await utils.sleep(5000);
  }
  throw new Error("青龙评价任务运行超时");
}

async function visibleAccounts(ql, cfg) {
  const rows = await core.activeCookies(ql, cfg.envName);
  if ((await s.isAdmin()) && cfg.adminAllAccounts) return rows;
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

async function resetQueue() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可重置评价队列");
  queueStore.set("jobs", "[]");
  return s.reply("自动评价队列已重置");
}
async function reportQueue() {
  const queue = loadQueue(),
    counts = {};
  for (const job of queue) counts[job.status] = (counts[job.status] || 0) + 1;
  return s.reply(
    `自动评价队列\n等待：${counts.pending || 0}\n运行：${counts.running || 0}\n完成：${counts.done || 0}\n失败：${counts.failed || 0}`,
  );
}
function loadQueue() {
  const value = parse(queueStore.get("jobs"));
  return Array.isArray(value) ? value : [];
}
function saveQueue(value) {
  queueStore.set("jobs", JSON.stringify(value.slice(-200)));
}
function parse(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "[]"));
  } catch (_) {
    return [];
  }
}
function tail(value, lines) {
  return String(value || "")
    .trim()
    .split(/\r?\n/)
    .slice(-lines)
    .join(" | ")
    .slice(0, 500);
}
function normalize(value) {
  return {
    qinglongId: Number(value.qinglong_id) || 1,
    envName: String(value.env_name || "JD_COOKIE"),
    taskKeyword: String(value.task_keyword || "自动评价"),
    directApi: String(value.direct_api || "").trim(),
    adminAllAccounts: value.admin_all_accounts !== false,
    isolateAccounts: value.isolate_accounts !== false,
    waitTimeoutMinutes: Math.max(1, Math.min(180, Number(value.wait_timeout_minutes) || 30)),
    processOnSubmit: value.process_on_submit !== false,
  };
}

main();
module.exports = { enqueue, processNext, runDirectApi, runQingLong };

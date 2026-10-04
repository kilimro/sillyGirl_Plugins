// [title: 青龙改定时]
// [name: qingLongGaiDingShi]
// [desc: 使用傻妞青龙内联客户端批量调整青龙任务的分钟字段]
// [author: sn_jmh]
// [version: v1.0.11]
// [rule: ^改$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/青龙改定时_v0.0.7_By.sn_jmh.py]
// [depe: []]

const { container, plugin, sender: s } = require("sillygirl");

const config = new plugin.Form({
  qinglong_id: plugin.Form.integer()
    .title("青龙编号")
    .description("后台青龙容器页面里的编号，从 1 开始")
    .widget("qinglong-panel")
    .min(1)
    .default(1),
  task_keywords: plugin.Form.string()
    .title("任务关键词")
    .description("多个关键词用逗号分隔；只修改名称或命令包含关键词的任务")
    .default(""),
  minute_delta: plugin.Form.integer()
    .title("分钟增量")
    .description("在原定时表达式的分钟字段上增加该数值，可填负数")
    .min(-59)
    .max(59)
    .default(1),
  dry_run: plugin.Form.boolean().title("仅预览").description("开启后只显示变化，不写入青龙").default(false),
});

async function main() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可用");
  const cfg = normalizeConfig(await config.get());
  if (!cfg.keywords.length) return s.reply("请先在插件设置中填写任务关键词");

  try {
    const ql = new container.QingLong({ id: cfg.qinglongId });
    const tasks = await findTasks(ql, cfg.keywords);
    if (!tasks.length) return s.reply("没有找到匹配的青龙任务");

    const changes = tasks.map((task) => buildChange(task, cfg.minuteDelta));
    if (!cfg.dryRun) {
      for (const change of changes) {
        await ql.request("PUT", "/crons", change.payload);
      }
    }

    const lines = changes.map((item) => `${item.name}\n${item.before} -> ${item.after}`);
    await s.reply(
      [
        cfg.dryRun ? "青龙定时预览完成" : "青龙定时修改完成",
        `容器：#${cfg.qinglongId}`,
        `任务：${changes.length} 个`,
        ...lines,
      ].join("\n"),
    );
  } catch (error) {
    await s.reply(`青龙改定时失败：${errorMessage(error)}`);
  }
}

function normalizeConfig(raw) {
  const value = raw || {};
  const qinglongId = Number(value.qinglong_id || 1);
  const minuteDelta = Number(value.minute_delta ?? 1);
  if (!Number.isInteger(qinglongId) || qinglongId < 1) throw new Error("青龙编号必须从 1 开始");
  if (!Number.isInteger(minuteDelta) || minuteDelta < -59 || minuteDelta > 59) {
    throw new Error("分钟增量必须是 -59 到 59 的整数");
  }
  return {
    qinglongId,
    minuteDelta,
    dryRun: value.dry_run === true,
    keywords: String(value.task_keywords || "")
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

async function findTasks(ql, keywords) {
  const found = new Map();
  for (const keyword of keywords) {
    const response = await ql.request("GET", "/crons", null, { searchValue: keyword });
    for (const task of unwrapList(response)) {
      const text = `${task.name || ""}\n${task.command || ""}`;
      if (!text.includes(keyword)) continue;
      const id = task.id ?? task._id;
      if (id !== undefined && id !== null) found.set(String(id), task);
    }
  }
  return [...found.values()];
}

function unwrapList(value) {
  let current = value;
  for (let index = 0; index < 4 && current && !Array.isArray(current); index += 1) {
    current = current.data ?? current.items ?? current.list;
  }
  return Array.isArray(current) ? current : [];
}

function buildChange(task, delta) {
  const before = String(task.schedule || "").trim();
  const fields = before.split(/\s+/);
  if (fields.length < 5) throw new Error(`${task.name || task.id} 的定时表达式无效：${before}`);
  if (!/^\d+$/.test(fields[0])) throw new Error(`${task.name || task.id} 的分钟字段不是固定数字：${fields[0]}`);
  const minute = Number(fields[0]) + delta;
  if (minute < 0 || minute > 59) throw new Error(`${task.name || task.id} 修改后分钟超出 0-59：${minute}`);
  fields[0] = String(minute);
  const after = fields.join(" ");
  return {
    name: String(task.name || task.id || "未命名任务"),
    before,
    after,
    payload: {
      id: task.id ?? task._id,
      name: task.name,
      command: task.command,
      schedule: after,
      labels: Array.isArray(task.labels) ? task.labels : [],
    },
  };
}

function errorMessage(error) {
  return String(error && error.message ? error.message : error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

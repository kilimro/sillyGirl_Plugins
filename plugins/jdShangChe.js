// [title: 京东上车]
// [name: jdShangChe]
// [desc: 用户在Web端提交京东CK，自动同步到青龙容器]
// [author: Mianpro官方]
// [version: v1.0.1]
// [rule: ^京东上车$]
// [cron: 0 0 * * *]
// [web: true]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://fc-ccimage.baidu.com/0/pic/-1452396718_1569556084_-7398448.jpg]
// [origin: 自定义]
// [depe: []]

const { user, plugin, sender: s, container, Bucket } = require("sillygirl");

// 用户表单：用户在 Web 端提交 CK
user
  .Form({
    cookie: user.Form.string().title("京东Cookie").description("格式：pt_key=xxx;pt_pin=xxx;").required(),
    remark: user.Form.string().title("备注（选填）").description("给CK起个名字").default(""),
  })
  .multiple(5);

// 管理员配置
const config = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  env_name: plugin.Form.string().title("CK环境变量名").default("JD_COOKIE"),
});

async function main() {
  const content = String((await s.getMsg()) || "").trim();
  if (content === "京东上车") return manualSync();
  // cron 触发
  await doSync();
}

async function manualSync() {
  const result = await doSync();
  return s.reply(`京东上车手动同步完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`);
}

async function doSync() {
  const cfg = (await config.get()) || {};
  const ql = new container.QingLong({ id: Number(cfg.qinglong_id) || 1 });
  const envName = String(cfg.env_name || "JD_COOKIE");

  // 获取青龙已有 CK
  const existing = await ql.getEnvs({ searchValue: envName });
  const existingList = Array.isArray(existing) ? existing : existing?.data || existing?.items || [];
  const pinMap = new Map();
  for (const item of existingList) {
    const pin = ptPin(item.value);
    if (pin) pinMap.set(pin, item);
  }

  // 读取所有用户提交的表单记录
  const records = await readAllUserRecords();
  let created = 0,
    updated = 0,
    skipped = 0;

  for (const rec of records) {
    const cookie = String(rec.values.cookie || "").trim();
    if (!cookie) continue;
    const pin = ptPin(cookie);
    if (!pin) {
      skipped++;
      continue;
    }

    const remark = String(rec.values.remark || "").trim() || decodeURIComponent(pin);
    const old = pinMap.get(pin);

    try {
      if (old) {
        await ql.updateEnv({ id: old.id, name: envName, value: cookie, remarks: remark });
        updated++;
      } else {
        await ql.createEnv({ name: envName, value: cookie, remarks: remark });
        created++;
      }
    } catch (e) {
      console.error(`[京东上车] 同步失败 pin=${pin}: ${e.message}`);
    }
  }

  return { created, updated, skipped };
}

async function readAllUserRecords() {
  // plugin_user_form_records 的 key 是 userID:pluginUUID
  // 我们需要读取所有记录
  const bucket = new Bucket("plugin_user_form_records");
  const keys = await bucket.keys();
  const results = [];
  for (const key of keys) {
    if (!key.includes(":jdShangChe")) continue;
    const raw = await bucket.get(key, "");
    if (!raw) continue;
    try {
      const records = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));
      if (Array.isArray(records)) {
        for (const r of records) {
          results.push({ key, values: r.values || r });
        }
      }
    } catch (_) {}
  }
  return results;
}

function ptPin(cookie) {
  const m = String(cookie || "").match(/pt_pin=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

main().catch((e) => console.error(`[京东上车] 异常: ${e.message}`));

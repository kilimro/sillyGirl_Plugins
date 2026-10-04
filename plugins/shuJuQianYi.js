// [title: 数据迁移工具]
// [name: shuJuQianYi]
// [desc: 合并 Python 数据导出、用户桶迁移、闪电娘账密迁移和分发接收，直接使用 SillyGirl Bucket]
// [author: sillyGirl]
// [version: v1.1.0]
// [rule: ^(数据导出|代码导出|autman插件迁移|数据迁移|闪电娘账密迁移|分发接收)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/autman数据导出_v1.1.0_By.sky2022.py;backup/分发接收助手_v1.0.5_By.yuhualhh.py;backup/数据迁移_v1.0.6_By.sky2022.py;backup/闪电娘账密迁移_v1.0.1_By.chuan.py]
// [depe: []]

const { Bucket, plugin, sender: s } = require("sillygirl");
const form = new plugin.Form({
  autman_url: plugin.Form.string().title("AutMan接口地址").default(""),
  autman_user: plugin.Form.string().title("AutMan用户名").default(""),
  autman_password: plugin.Form.string().title("AutMan密码").default(""),
  target_url: plugin.Form.string().title("目标API地址").default(""),
  target_user: plugin.Form.string().title("目标账号").default(""),
  target_password: plugin.Form.string().title("目标密码").default(""),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(3000).max(120000).default(30000),
});
let cfg = {};

async function main() {
  try {
    cfg = (await form.get()) || {};
    const content = String((await s.getMsg()) || "").trim();
    if (content === "数据导出") return exportData();
    if (/^(代码导出|autman插件迁移)$/.test(content)) return exportCode();
    if (content === "数据迁移") return migrateKey();
    if (content === "闪电娘账密迁移") return migrateLightning();
    if (content === "分发接收") return receiveDistribution();
  } catch (error) {
    return s.reply(`数据迁移失败：${err(error)}`);
  }
}

async function exportData() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可导出数据");
  const session = await migrationSession();
  const buckets = await api(`${session.autman}/buckets`, { headers: authHeaders(session.autmanCookie) });
  const available = (buckets.data || []).map((x) => x?.name).filter(Boolean);
  if (Number(buckets.code) !== 200 || !available.length)
    throw new Error(buckets.message || "未获取到 AutMan 数据桶列表");
  await s.reply("请输入要导出的数据桶，多个用逗号或换行分隔，输入 q 取消。");
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 120000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const input = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(input)) return "已取消";
      const names = new Set();
      for (const pattern of input
        .split(/[,，\r\n]+/)
        .map((x) => x.trim())
        .filter(Boolean)) {
        const rx = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i");
        for (const name of available) if (rx.test(name)) names.add(name);
      }
      if (!names.size) return next.reply("没有匹配到有效数据桶");
      let success = 0,
        failed = 0,
        skipped = 0;
      const reports = [];
      for (const name of names) {
        const rows = await new Bucket(name).getAll(),
          entries = Object.entries(rows || {});
        if (!entries.length) {
          skipped += 1;
          continue;
        }
        let ok = 0,
          bad = 0;
        for (const [key, raw] of entries) {
          const value = typed(raw);
          try {
            const result = await api(`${session.target}/api/databucket/${encodeURIComponent(name)}/data`, {
              method: "POST",
              headers: authHeaders(session.targetCookie, true),
              body: JSON.stringify({ key, value }),
            });
            if (result.success) {
              ok += 1;
              success += 1;
            } else {
              bad += 1;
              failed += 1;
            }
          } catch (_) {
            bad += 1;
            failed += 1;
          }
        }
        reports.push(`${name}: ${ok}成功/${bad}失败`);
      }
      return next.reply(
        [
          "=====导出完成=====",
          `处理数据桶：${names.size}`,
          `跳过空桶：${skipped}`,
          `成功上传：${success}`,
          `上传失败：${failed}`,
          ...reports,
        ].join("\n"),
      );
    },
  });
}

async function exportCode() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可迁移插件");
  const session = await migrationSession();
  const menu = await api(`${session.autman}/js/menu?language=python`, { headers: authHeaders(session.autmanCookie) });
  const plugins = Array.isArray(menu.data) ? menu.data : [];
  if (Number(menu.code) !== 200 || !plugins.length) throw new Error(menu.message || "获取插件列表失败");
  await s.reply(
    [
      `共 ${plugins.length} 个 Python 插件`,
      "0. 全部迁移",
      ...plugins.map((x, i) => `${i + 1}. ${x.disable ? "🔴" : "🟢"} ${x.name}`),
      "请输入序号，多选用逗号，Q退出",
    ].join("\n"),
  );
  const child = await s.listen({ timeout: 120000 });
  if (!child) return s.reply("输入超时");
  const input = String((await child.getMsg()) || "").trim();
  if (/^q$/i.test(input)) return s.reply("已退出代码导出流程");
  const selected =
    input === "0"
      ? plugins
      : [
          ...new Set(
            input
              .split(/[,，]/)
              .map(Number)
              .filter((n) => n >= 1 && n <= plugins.length),
          ),
        ].map((n) => plugins[n - 1]);
  if (!selected.length) return s.reply("未选择有效插件");
  let success = 0;
  const failed = [];
  for (const row of selected) {
    try {
      const codeResult = await api(
        `${session.autman}/js/content?language=python&name=${encodeURIComponent(row.name)}`,
        { headers: authHeaders(session.autmanCookie) },
      );
      if (Number(codeResult.code) !== 200 || !codeResult.data) throw new Error(codeResult.message || "获取代码失败");
      const file = encodeURIComponent(`python/${row.name}.py`);
      const upload = await api(`${session.target}/api/plugins/${file}/code`, {
        method: "POST",
        headers: authHeaders(session.targetCookie, true),
        body: JSON.stringify({ code: codeResult.data }),
      });
      if (!upload.success) throw new Error(upload.message || "上传失败");
      success += 1;
    } catch (error) {
      failed.push(`${row.name}: ${err(error)}`);
    }
  }
  return s.reply(["=====插件迁移完成=====", `成功：${success}`, `失败：${failed.length}`, ...failed].join("\n"));
}

async function migrationSession() {
  const autman = base(cfg.autman_url),
    target = base(cfg.target_url);
  if (!autman || !cfg.autman_user || !cfg.autman_password || !target || !cfg.target_user || !cfg.target_password)
    throw new Error("请完整配置 AutMan 与目标服务器地址、账号、密码");
  const a = await raw(`${autman}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body: `username=${cfg.autman_user}&password=${cfg.autman_password}`,
  });
  if (Number(a.data?.code) !== 200) throw new Error(`AutMan登录失败：${a.data?.message || a.status}`);
  const autmanCookie = cookieOf(a.headers, "autMan");
  if (!autmanCookie) throw new Error("AutMan登录未返回Cookie");
  const t = await raw(`${target}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: cfg.target_user, password: cfg.target_password, remember: true }),
  });
  if (!(t.data?.message === "登录成功" || t.data?.user_info))
    throw new Error(`目标登录失败：${t.data?.message || t.status}`);
  const targetCookie = cookieOf(t.headers, "session");
  if (!targetCookie) throw new Error("目标登录未返回Cookie");
  return { autman, target, autmanCookie, targetCookie };
}

async function raw(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(Number(cfg.timeout_ms) || 30000) });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return { status: response.status, headers: response.headers, data };
}
async function api(url, init) {
  return (await raw(url, init)).data;
}
function cookieOf(headers, name) {
  const text = headers.get("set-cookie") || "";
  return (
    text
      .split(/,(?=[^;,]+=)/)
      .map((x) => x.split(";", 1)[0].trim())
      .find((x) => x.startsWith(`${name}=`)) || text.split(";", 1)[0]
  );
}
function authHeaders(cookie, json = false) {
  return {
    cookie,
    accept: "*/*",
    ...(json ? { "content-type": "application/json" } : { "x-requested-with": "XMLHttpRequest" }),
  };
}
function base(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function typed(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_) {}
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : value;
}

async function migrateKey() {
  await s.reply("请输入：数据桶#原ID；数据将迁移到当前用户ID，输入 q 取消。");
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 120000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const input = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(input)) return "已取消";
      const [bucketName, oldId, ...extra] = input.split("#").map((x) => x.trim());
      if (!bucketName || !oldId || extra.length) return next.reply("格式应为：数据桶#原ID");
      const targetId = await next.getUserId();
      const bucket = new Bucket(bucketName);
      const value = await bucket.get(oldId, undefined);
      if (value === undefined || value === "") return next.reply("原ID没有数据");
      const existing = await bucket.get(targetId, undefined);
      if (existing !== undefined && existing !== "") {
        await next.reply("目标ID已有数据，回复 y 覆盖，其它内容取消。");
        const confirm = await next.listen({ rules: ["raw ^(\\S+)$"], timeout: 30000, allow_users: [targetId] });
        if (!confirm || !/^y$/i.test(await confirm.param(1))) return next.reply("已取消");
      }
      await bucket.set(targetId, value);
      await bucket.delete(oldId);
      return next.reply(`迁移成功：${bucketName} ${oldId} -> ${targetId}`);
    },
  });
}

async function migrateLightning() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可迁移闪电娘账密");
  const source = await new Bucket("AutoJdck").getAll();
  const target = new Bucket("chuan_jd_accountPassword");
  let success = 0;
  for (const [pin, raw] of Object.entries(source)) {
    const row = parseJSON(raw);
    if (!row.account || !row.password || !row.user || !row.platform) continue;
    await new Bucket(`pin${String(row.platform).toUpperCase()}`).set(pin, row.user);
    await target.set(pin, `${row.account}#${row.password}`);
    success += 1;
  }
  return s.reply(`闪电娘账密迁移完成：${success}/${Object.keys(source).length}`);
}

async function receiveDistribution() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可接收分发数据");
  await s.reply('请发送 JSON：{"bucket":"桶名","key":"键","value":"值"}，输入 q 取消。');
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 120000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const input = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(input)) return "已取消";
      const data = parseJSON(input);
      if (!/^[\w.-]{1,100}$/.test(data.bucket || "") || typeof data.key !== "string" || !("value" in data))
        return next.reply("分发数据格式错误");
      await new Bucket(data.bucket).set(
        data.key,
        typeof data.value === "string" ? data.value : JSON.stringify(data.value),
      );
      return next.reply(`分发接收完成：${data.bucket}/${data.key}`);
    },
  });
}

function parseJSON(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

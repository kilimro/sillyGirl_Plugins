// [title: 京东 Cookie 管理]
// [name: jdCookieGuanLi]
// [desc: 接收并校验 Cookie/WSKEY，维护 jdNotify，支持多青龙同步、指定 PIN、排序、失效推送和规则化导出]
// [author: qingge,specter]
// [version: v1.2.0]
// [rule: raw ^([\s\S]*(pt_key|pt_pin|wskey|pwdt_id)=[\s\S]+)$]
// [rule: ^(同步qls|指定CK同步|失效通知|失效禁用|失效全部|导出ck|规则管理|COOKIE状态)$]
// [rule: ^调整(?:\s+([\s\S]+))?$]
// [rule: ^COOKIE接口\s+([\s\S]+)$]
// [cron: 5 1,11 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 99999999]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/key.svg]
// [carry: true]
// [origin: backup/COOKIE_v1.1.9_By.qingge.txt;backup/COOKIE接口_v1.0.3_By.qingge.txt;backup/导出ck定制版_v1.0.1_By.specter.txt;backup/指定CK同步_v0.1.0_By.qingge.txt;backup/指定PIN调整排名_v0.3.1_By.qingge.js;backup/检查账号-渠道推送_v1.0.5_By.qingge.js]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin, sender: s } = require("sillygirl");
const core = require("./jdLegacyCore.js");
const notify = new Bucket("jdNotify"),
  wskeys = new Bucket("BBK_WSCK");

const form = new plugin.Form({
  source_id: plugin.Form.integer().title("源青龙编号").min(1).default(1),
  target_ids: plugin.Form.string().title("同步目标青龙编号").description("多个用逗号分隔").default(""),
  env_name: plugin.Form.string().title("Cookie 环境变量名").default("JD_COOKIE"),
  wskey_env_name: plugin.Form.string().title("WSKEY 环境变量名").default("JD_WSCK"),
  selected_pins: plugin.Form.string().title("指定同步 PIN").description("留空同步全部；多个用逗号分隔").default(""),
  start_index: plugin.Form.integer().title("数量模式起始序号").min(1).default(1),
  sync_limit: plugin.Form.integer().title("同步数量；0 为不限").min(0).default(0),
  validate_cookie: plugin.Form.boolean().title("上传及失效扫描时检测 Cookie").default(true),
  disable_invalid: plugin.Form.boolean().title("扫描后禁用失效 Cookie").default(true),
  export_template: plugin.Form.string()
    .title("导出模板")
    .description("支持 {index} {pin} {cookie} {remark}")
    .default("{cookie}"),
});

async function main() {
  const cfg = normalize((await form.get()) || {});
  const content = String((await s.getMsg()) || "").trim();
  try {
    if (content === "COOKIE状态" || content === "规则管理") return status(cfg);
    if (content === "导出ck") return exportCookies(cfg);
    if (content === "同步qls" || content === "指定CK同步") return requireAdmin(() => syncCookies(cfg));
    if (content.startsWith("调整")) return requireAdmin(() => reorder(cfg, content.replace(/^调整\s*/, "")));
    if (/^失效(通知|禁用|全部)$/.test(content) || !content) return requireAdmin(() => scanInvalid(cfg, content));
    if (content.startsWith("COOKIE接口 ")) return upload(cfg, content.slice(9));
    if (/(?:pt_key|pt_pin|wskey|pwdt_id)=/i.test(content)) return upload(cfg, content);
    return status(cfg);
  } catch (error) {
    return s.reply(`京东 Cookie 管理失败：${core.errorText(error)}`);
  }
}

async function requireAdmin(action) {
  if (!(await s.isAdmin())) return s.reply("该操作仅管理员可用");
  return action();
}

async function upload(cfg, input) {
  let payload = input;
  try {
    if (/^\s*[[{]/.test(input)) payload = JSON.parse(input);
  } catch (_) {}
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const cookies = core.parseCookies(text);
  const wskeyMatches = [...text.matchAll(/(?:^|[\s"'])((?:pin|wskey)=[^;\s"']+;?\s*(?:pin|wskey)=[^;\s"']+;?)/gi)].map(
    (match) => match[1],
  );
  if (!cookies.length && !wskeyMatches.length) throw new Error("未识别到 pt_key/pt_pin 或 pin/wskey");
  const ql = new container.QingLong({ id: cfg.sourceId });
  const current = await core.qlEnvs(ql, cfg.envName);
  let created = 0,
    updated = 0,
    invalid = 0;
  for (const cookie of cookies) {
    if (cfg.validateCookie && !(await core.validateCookie(cookie))) {
      invalid += 1;
      continue;
    }
    const pin = core.ptPin(cookie);
    const result = await core.upsertEnv(ql, { name: cfg.envName, value: cookie, remarks: core.decode(pin) }, current);
    result.action === "created" ? (created += 1) : (updated += 1);
    const userId = String((await s.getUserId()) || ""),
      platform = String((await s.getPlatform()) || "");
    if (userId)
      notify.set(
        pin,
        JSON.stringify({ user_id: userId, imType: platform, nickname: core.decode(pin), updated_at: Date.now() }),
      );
  }
  for (const value of wskeyMatches) {
    const pin = core.wskeyPin(value);
    if (!pin) continue;
    wskeys.set(pin, value);
    await core.upsertEnv(ql, { name: cfg.wskeyEnvName, value, remarks: core.decode(pin) });
  }
  return s.reply(`凭据处理完成：新增 ${created}，更新 ${updated}，失效 ${invalid}，WSKEY ${wskeyMatches.length}`);
}

async function syncCookies(cfg) {
  const source = new container.QingLong({ id: cfg.sourceId });
  let rows = await core.activeCookies(source, cfg.envName);
  const selected = new Set(splitPins(cfg.selectedPins));
  if (selected.size)
    rows = rows.filter(
      (item) => selected.has(core.decode(core.ptPin(item.value))) || selected.has(core.ptPin(item.value)),
    );
  rows = rows.slice(Math.max(0, cfg.startIndex - 1));
  if (cfg.syncLimit) rows = rows.slice(0, cfg.syncLimit);
  if (!cfg.targetIds.length) throw new Error("未配置同步目标青龙编号");
  const reports = [];
  for (const id of cfg.targetIds) {
    const target = new container.QingLong({ id });
    const current = await core.qlEnvs(target, cfg.envName);
    let created = 0,
      updated = 0;
    for (const row of rows) {
      const result = await core.upsertEnv(
        target,
        {
          name: cfg.envName,
          value: row.value,
          remarks: row.remarks || row.remark || core.decode(core.ptPin(row.value)),
        },
        current,
      );
      result.action === "created" ? (created += 1) : (updated += 1);
    }
    reports.push(`#${id} 新增 ${created}/更新 ${updated}`);
  }
  return s.reply(`指定 CK 同步完成：${rows.length} 个\n${reports.join("\n")}`);
}

async function reorder(cfg, rawPins) {
  const ql = new container.QingLong({ id: cfg.sourceId });
  const rows = await core.qlEnvs(ql, cfg.envName);
  const pins = splitPins(rawPins || cfg.selectedPins);
  if (!pins.length) throw new Error("请在“调整”后填写 PIN，或在配置中填写指定 PIN");
  const rank = new Map(pins.map((pin, index) => [pin, index]));
  const ordered = [...rows].sort(
    (a, b) =>
      (rank.get(core.decode(core.ptPin(a.value))) ?? rank.get(core.ptPin(a.value)) ?? 999999) -
      (rank.get(core.decode(core.ptPin(b.value))) ?? rank.get(core.ptPin(b.value)) ?? 999999),
  );
  const payload = ordered.map((item) => ({
    id: core.envId(item),
    name: item.name,
    value: item.value,
    remarks: item.remarks || item.remark || "",
  }));
  await ql.request("PUT", "/envs/put", payload);
  return s.reply(`PIN 排名已调整：优先 ${pins.length} 个，总计 ${rows.length} 个`);
}

async function scanInvalid(cfg, command = "") {
  const ql = new container.QingLong({ id: cfg.sourceId });
  const rows = await core.qlEnvs(ql, cfg.envName);
  const invalid = [];
  for (const row of rows)
    if (row.status || (cfg.validateCookie && !(await core.validateCookie(row.value)))) invalid.push(row);
  if ((cfg.disableInvalid || command === "失效禁用" || command === "失效全部") && invalid.length)
    await ql.disableEnvs(invalid.map(core.envId).filter(Boolean));
  const message = [
    `京东失效账号：${invalid.length}/${rows.length}`,
    ...invalid
      .slice(0, 100)
      .map((item, index) => `${index + 1}. ${item.remarks || core.decode(core.ptPin(item.value))}`),
  ].join("\n");
  await s.pushAdmin(message);
  return s.reply(message);
}

async function exportCookies(cfg) {
  const ql = new container.QingLong({ id: cfg.sourceId });
  const rows = await core.activeCookies(ql, cfg.envName);
  const text = rows
    .map((item, index) =>
      cfg.exportTemplate
        .replaceAll("{index}", String(index + 1))
        .replaceAll("{pin}", core.decode(core.ptPin(item.value)))
        .replaceAll("{cookie}", item.value)
        .replaceAll("{remark}", String(item.remarks || item.remark || "")),
    )
    .join("\n");
  return s.reply(text || "没有可导出的有效 Cookie");
}

async function status(cfg) {
  const ql = new container.QingLong({ id: cfg.sourceId });
  const rows = await core.qlEnvs(ql, cfg.envName);
  return s.reply(
    `京东 Cookie 管理\n容器：#${cfg.sourceId}\n总数：${rows.length}\n启用：${rows.filter((item) => !item.status).length}\n目标：${cfg.targetIds.join(",") || "未配置"}\n指令：同步qls / 指定CK同步 / 失效通知 / 失效禁用 / 导出ck / 调整 PIN`,
  );
}

function splitPins(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[,，;；\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
function normalize(value) {
  return {
    sourceId: Number(value.source_id) || 1,
    targetIds: core.parseIds(value.target_ids),
    envName: String(value.env_name || "JD_COOKIE").trim(),
    wskeyEnvName: String(value.wskey_env_name || "JD_WSCK").trim(),
    selectedPins: String(value.selected_pins || ""),
    startIndex: Math.max(1, Number(value.start_index) || 1),
    syncLimit: Math.max(0, Number(value.sync_limit) || 0),
    validateCookie: value.validate_cookie !== false,
    disableInvalid: value.disable_invalid !== false,
    exportTemplate: String(value.export_template || "{cookie}"),
  };
}

main();
module.exports = { upload, syncCookies, scanInvalid, exportCookies, reorder };

// [title: smallcat登录]
// [name: smallcatDengLu]
// [desc: 通过 smallcat 二维码扫码登录和删除已保存账号]
// [author: sillyGirl]
// [version: v1.1.3]
// [rule: ^\s*sm(登录|退出)(?:\s+(.+))?\s*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 10]
// [class: 工具]
// [icon: https://api.iconify.design/lucide:bot.svg]
// [origin: 自定义]
// [depe: []]

const { sender: s, console, utils, plugin, container, user } = require("sillygirl");

const DEFAULTS = {
  smallcat_id: 1,
  account_mode: "authorized",
  manual_openids: "",
  login_type: 1,
  login_timeout: 180,
  poll_interval: 3,
  default_display_name: "",
};

const pluginConfig = new plugin.Form({
  smallcat_id: plugin.Form.integer()
    .title("smallcat 编号")
    .description("后台 smallcat 页面里的编号，从 1 开始")
    .widget("smallcat-panel")
    .default(1),
  account_mode: plugin.Form.string()
    .title("openid 获取模式")
    .description("普通用户授权：只显示已授权本插件的账号；手动填写：按下方 openid 显示，留空显示 SmallCat 全部账号")
    .options(["authorized", "manual"])
    .default("authorized"),
  manual_openids: plugin.Form.string()
    .title("手动 openid")
    .description("仅手动填写模式生效；多个用逗号、空格或换行分隔；留空读取全部账号")
    .widget("textarea")
    .default("").visibleWhen("account_mode", "==", "manual"),
  login_type: plugin.Form.integer()
    .title("登录类型")
    .description("传给 smallcat createQr/addUser 的 type，默认 1")
    .default(1),
  login_timeout: plugin.Form.integer().title("扫码超时秒数").min(30).max(600).default(180),
  poll_interval: plugin.Form.integer().title("轮询间隔秒数").min(1).max(10).default(3),
  default_display_name: plugin.Form.string()
    .title("默认备注")
    .description("sm登录 后面没写备注时使用；仍为空则由 smallcat 决定")
    .default(""),
});

async function main() {
  const cfg = normalizeConfig(await pluginConfig.get());

  const content = String((await s.getMsg()) || "").trim();
  const matched = content.match(/^sm(登录|退出)(?:\s+(.+))?$/);
  if (!matched) return;

  const action = matched[1];
  const arg = String(matched[2] || "").trim();
  const sm = new container.SmallCat({ id: cfg.smallcat_id });

  try {
    if (action === "登录") {
      await login(sm, cfg, arg);
      return;
    }
    await logout(sm, cfg, arg);
  } catch (error) {
    await s.reply(`smallcat${action}失败：${errorText(error)}`);
  }
}

async function login(sm, cfg, displayNameArg) {
  const displayName = displayNameArg || cfg.default_display_name;
  const created = unwrap(await sm.createQr({ type: cfg.login_type }));
  const uuid = firstString(created, ["uuid", "qrUUID", "qruuid"]);
  const qrcodeUrl = firstString(created, ["qrcodeUrl", "qrCodeDataUrl", "qr_url", "url"]);
  if (!uuid) {
    throw new Error(`createQr 未返回 uuid；返回字段=${Object.keys(created || {}).join(",") || "-"}`);
  }

  await s.reply(
    [
      "smallcat扫码登录",
      `编号：${cfg.smallcat_id}`,
      `UUID：${uuid}`,
      `请在 ${cfg.login_timeout} 秒内扫码确认`,
      qrcodeUrl ? utils.image(qrcodeUrl) : "二维码链接未返回，请在 smallcat 控制台查看",
    ].join("\n"),
  );

  const deadline = Date.now() + cfg.login_timeout * 1000;
  let lastState = "";
  while (Date.now() < deadline) {
    await utils.sleep(cfg.poll_interval * 1000);
    const checked = unwrap(await sm.checkQr(uuid));
    const state = firstString(checked, ["state", "status"]);
    const code = firstString(checked, ["wxCode", "wx_code", "code"]);
    if (state && state !== lastState) {
      lastState = state;
      if (state === "scanned") await s.reply("已扫码，请在手机上确认登录");
    }
    if (isExpiredState(state)) {
      await s.reply(`smallcat扫码已结束：${state}`);
      return;
    }
    if (isConfirmed(checked, state, code)) {
      if (!code) throw new Error("扫码已确认，但 checkQr 未返回 code");
      const saved = await sm.addUser({
        code,
        type: cfg.login_type,
        displayName,
      });
      const result = unwrap(saved);
      await s.reply(formatLoginSuccess(result, displayName));
      return;
    }
  }

  await s.reply("smallcat扫码登录超时，请重新发送 sm登录");
}

async function logout(sm, cfg, arg) {
  const openid = extractOpenid(arg);
  const accounts = await loadSmallcatAccounts(sm, cfg);
  if (!openid) {
    if (!accounts.length) {
      await s.reply("当前 smallcat 没有已保存账号");
      return;
    }
    await s.reply(
      [
        "请指定要退出的 openid：",
        "sm退出 OPENID",
        "",
        ...accounts.slice(0, 10).map((item, index) => `${index + 1}. ${accountName(item)} ${item.openid}`),
        accounts.length > 10 ? `... 还有 ${accounts.length - 10} 个` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }

  if (!accounts.some((item) => item.openid === openid)) {
    throw new Error(
      cfg.account_mode === "authorized"
        ? "该 openid 未获得普通用户授权"
        : "该 openid 不在手动范围或 SmallCat 账号列表中",
    );
  }

  if (typeof sm.request !== "function") {
    throw new Error("当前 SillyGirl 版本不支持 SmallCat.request，请先更新主程序");
  }
  const result = await sm.request("POST", "/api/accounts/delete", { openid });
  const unwrapped = unwrap(result);
  await s.reply(formatLogoutSuccess(unwrapped, openid, cfg));
}

function normalizeConfig(input) {
  const cfg = Object.assign({}, DEFAULTS, input || {});
  cfg.smallcat_id = positiveInt(cfg.smallcat_id, DEFAULTS.smallcat_id);
  cfg.account_mode = cfg.account_mode === "manual" ? "manual" : "authorized";
  cfg.manual_openids = String(cfg.manual_openids || "").trim();
  cfg.login_type = positiveInt(cfg.login_type, DEFAULTS.login_type);
  cfg.login_timeout = clamp(Number(cfg.login_timeout || DEFAULTS.login_timeout), 30, 600);
  cfg.poll_interval = clamp(Number(cfg.poll_interval || DEFAULTS.poll_interval), 1, 10);
  cfg.default_display_name = String(cfg.default_display_name || "").trim();
  return cfg;
}

async function loadSmallcatAccounts(sm, cfg) {
  if (typeof sm.request !== "function") throw new Error("当前 SillyGirl 版本缺少 SmallCat.request");
  const wanted =
    cfg.account_mode === "manual" ? new Set(splitOpenids(cfg.manual_openids)) : await authorizedOpenidSet();
  const accounts = normalizeAccounts(unwrap(await sm.request("GET", "/api/accounts")));
  return wanted.size ? accounts.filter((item) => wanted.has(item.openid)) : accounts;
}

async function authorizedOpenidSet() {
  if (!user || typeof user.getUserList !== "function") throw new Error("当前 SillyGirl 版本缺少 user.getUserList");
  const users = await user.getUserList();
  const allowed = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    if (!user || user.disabled || !user.authorized) continue;
    for (const openid of (user.bindings && user.bindings.smallcat_openids) || []) {
      const value = String(openid || "").trim();
      if (value) allowed.add(value);
    }
  }
  if (!allowed.size) throw new Error("没有普通用户授权的 SmallCat 账号");
  return allowed;
}

function splitOpenids(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[,，;；\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object") return { value: payload };
  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    if (payload.status === false) throw new Error(responseMessage(payload) || "smallcat 接口业务状态失败");
    if (Object.prototype.hasOwnProperty.call(payload, "data")) return unwrapData(payload.data);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "code") && Object.prototype.hasOwnProperty.call(payload, "data")) {
    const code = String(payload.code);
    if (!["0", "200", "201"].includes(code)) throw new Error(responseMessage(payload) || `接口业务状态异常：${code}`);
    return unwrapData(payload.data);
  }
  return payload;
}

function unwrapData(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  if (typeof data === "string" && /^[\s]*[[{]/.test(data)) {
    try {
      const decoded = JSON.parse(data);
      return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : { value: decoded };
    } catch (_) {}
  }
  return { value: data };
}

function firstString(payload, keys) {
  const value = nestedValue(payload, keys);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function nestedValue(payload, keys) {
  const wanted = new Set(keys);
  const lower = new Set(keys.map((key) => String(key).toLowerCase()));
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const found = nestedValue(item, keys);
        if (found !== undefined && found !== null && found !== "") return found;
      }
      return null;
    }
    for (const [key, value] of Object.entries(payload)) {
      if (
        (wanted.has(key) || lower.has(String(key).toLowerCase())) &&
        value !== undefined &&
        value !== null &&
        value !== ""
      )
        return value;
    }
    for (const value of Object.values(payload)) {
      const found = nestedValue(value, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
  return null;
}

function isConfirmed(payload, state, code) {
  if (code) return true;
  if (payload && payload.isConfirmed === true) return true;
  return ["confirmed", "success", "ok", "done"].includes(String(state || "").toLowerCase());
}

function isExpiredState(state) {
  return ["expired", "canceled", "cancelled", "timeout"].includes(String(state || "").toLowerCase());
}

function normalizeAccounts(payload) {
  let values = payload && (payload.value ?? payload.data ?? payload.list ?? payload.items);
  if (values && typeof values === "object" && !Array.isArray(values)) {
    values = values.data || values.list || values.items;
  }
  return (Array.isArray(values) ? values : [])
    .filter((item) => item && typeof item === "object")
    .map((item) =>
      Object.assign({}, item, {
        openid: String(item.openid || item.openId || item.id || "").trim(),
      }),
    )
    .filter((item) => item.openid);
}

function accountName(item) {
  return String(item.displayName || item.remark || item.nickname || item.name || "未命名").trim();
}

function extractOpenid(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(?:openid[:：=]\s*)?([A-Za-z0-9_-]{8,})/);
  return match ? match[1] : "";
}

function formatLoginSuccess(result, displayName) {
  const openid = firstString(result, ["openid", "openId"]);
  const message = responseMessage(result);
  return [
    "smallcat登录成功",
    openid ? `openid：${openid}` : "",
    displayName ? `备注：${displayName}` : "",
    message ? `message：${message}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatLogoutSuccess(result, openid) {
  const message = responseMessage(result);
  return ["smallcat退出成功", `openid：${openid}`, message ? `message：${message}` : ""].filter(Boolean).join("\n");
}

function responseMessage(payload) {
  const value = nestedValue(payload, ["message", "msg", "error", "errmsg", "errMsg"]);
  if (value && typeof value === "object") return JSON.stringify(value).slice(0, 300);
  return String(value || "")
    .trim()
    .slice(0, 300);
}

function errorText(error) {
  return error && error.message ? String(error.message) : String(error || "");
}

main().catch(async (error) => {
  try {
    await s.reply("smallcat登录异常：" + errorText(error));
  } catch (_) {
    console.error("smallcat登录异常", error);
  }
});

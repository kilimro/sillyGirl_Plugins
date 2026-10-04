// [title: Keep运动]
// [name: keepYunDong]
// [desc: 按 Python 流程校验 Keep Token，查询运动币、签到和抽奖记录，并同步青龙]
// [author: 8165799]
// [version: v1.2.0]
// [rule: ^([Kk]eep)(登录|登陆|查询|管理|清理|教程)$|^(登录|登陆|查询|管理|清理)([Kk]eep)$]
// [cron: 5 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/keep_v1.1_By.8165799.py]
// [depe: []]

const { createHash, randomBytes } = require("crypto");
const { container, plugin, sender: s } = require("sillygirl");

const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  env_name: plugin.Form.string().title("环境变量名").default("keep"),
});

async function main() {
  try {
    const cfg = normalize(await form.get());
    const content = String((await s.getMsg()) || "").trim();
    const ql = new container.QingLong({ id: cfg.qinglongId });
    if (!content) return maintain(ql, cfg.envName);
    if (/教程/.test(content)) return s.reply("发送 Keep登录，再提交 Bearer Token/JWT；可用 备注#Token，多账号换行。");
    if (/查询|管理/.test(content)) return queryAccounts(ql, cfg.envName);
    if (/清理/.test(content)) return removeAccounts(ql, cfg.envName);
    if (/登录|登陆/.test(content)) {
      await s.reply("请发送 Keep Token，支持 备注#Token，多账号换行，输入 q 取消。");
      return s.listen({
        rules: ["raw ^([\\s\\S]+)$"],
        timeout: 120000,
        user_id: await s.getUserId(),
        chat_id: await s.getChatId(),
        handle: async (next) => {
          const value = String((await next.param(1)) || "").trim();
          if (/^q$/i.test(value)) return "已取消";
          return saveAccounts(ql, cfg.envName, value, next);
        },
      });
    }
    return s.reply("指令：Keep登录 / Keep查询 / Keep管理 / Keep清理 / Keep教程");
  } catch (error) {
    return s.reply(`Keep处理失败：${err(error)}`);
  }
}

async function saveAccounts(ql, envName, input, reply) {
  try {
    const owner = await ownerKey(reply);
    const current = named(await ql.getEnvs({ searchValue: envName }), envName);
    let created = 0;
    let updated = 0;
    const reports = [];
    for (const row of parse(input)) {
      const info = await keepInfo(row.token);
      const old = current.find(
        (item) =>
          owned(item, owner) && (remark(item) === row.remark || uid(item) === info.uid || item.value === row.token),
      );
      const env = { name: envName, value: row.token, remarks: `${owner}|${row.remark}|${info.uid}` };
      if (old) {
        await ql.updateEnv({ ...env, id: envId(old) });
        updated += 1;
      } else {
        await ql.createEnv(env);
        created += 1;
      }
      reports.push(render(info, row.remark));
    }
    return reply.reply([`Keep同步完成：新增 ${created}，更新 ${updated}`, ...reports].join("\n\n"));
  } catch (error) {
    return reply.reply(`Keep提交失败：${err(error)}`);
  }
}

async function queryAccounts(ql, envName) {
  const owner = await ownerKey(s);
  const admin = await s.isAdmin();
  const rows = named(await ql.getEnvs({ searchValue: envName }), envName).filter((item) => admin || owned(item, owner));
  if (!rows.length) return s.reply("没有找到你的 Keep 账号");
  const reports = [];
  for (const item of rows) {
    try {
      reports.push(render(await keepInfo(item.value), remark(item)));
    } catch (error) {
      reports.push(`${remark(item) || uid(item) || "未备注"}：${err(error)}`);
    }
  }
  return s.reply(reports.join("\n\n"));
}

async function maintain(ql, envName) {
  const rows = named(await ql.getEnvs({ searchValue: envName }), envName).filter((item) => !item.status);
  const invalid = [];
  for (const item of rows) {
    try {
      await keepInfo(item.value);
    } catch {
      if (envId(item)) invalid.push(envId(item));
    }
  }
  if (invalid.length) {
    await ql.disableEnvs(invalid);
    await s.pushAdmin(`Keep维护完成：检测 ${rows.length} 个，禁用失效 Token ${invalid.length} 个`);
  }
}

async function removeAccounts(ql, envName) {
  const owner = await ownerKey(s);
  const admin = await s.isAdmin();
  const ids = named(await ql.getEnvs({ searchValue: envName }), envName)
    .filter((item) => admin || owned(item, owner))
    .map(envId)
    .filter(Boolean);
  if (!ids.length) return s.reply("没有可清理的 Keep 账号");
  await ql.deleteEnvs(ids);
  return s.reply(`已清理 ${ids.length} 个 Keep 账号`);
}

async function keepInfo(token) {
  const auth = normalizeToken(token);
  const payload = jwt(auth);
  const userId = String(payload?._id || payload?.sub || "");
  const headers = {
    authorization: auth,
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "user-agent": "Keep/8.7.80 (Android 12; Xiaomi Redmi K30 Pro)",
    "x-app-platform": "keepapp",
    "x-version-name": "8.7.80",
    "x-version-code": "49487",
    "x-os": "Android",
    "x-os-version": "12",
    "x-device-id": randomBytes(16).toString("hex"),
    "x-is-guest": "N",
    "x-channel": "xiaomi_store___",
    "x-locale": "zh--CN",
    "x-keep-timezone": "Asia/Shanghai",
    ...(userId ? { "x-user-id": userId } : {}),
  };
  const home = await get("https://store.gotokeep.com/api/v1/marketing/sportCoin/home", headers);
  if (!home?.ok || home?.data?.userSportsCoinNum === undefined) throw new Error(home?.message || "Token 已失效");
  const sign = await get("https://api.gotokeep.com/dune-webapp/sportcoin/sign/in/info", headers).catch(() => ({}));
  const lotto = await get("https://api.gotokeep.com/dune-webapp/lotto/user/list?page=1&size=5", headers).catch(
    () => ({}),
  );
  const signs = sign?.data?.signInList || [];
  const today = signs.find((item) => String(item?.day || "").includes("今"));
  const signed = sign?.data?.today_already_signed === true || today?.signIn === true;
  const date = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }).replaceAll("/", ".");
  const record = (lotto?.data?.tasks || []).find((item) => item?.roundNote === date);
  const fallback = createHash("md5").update(auth).digest("hex").slice(0, 10);
  return {
    uid: userId || fallback,
    balance: home.data.userSportsCoinNum,
    signed,
    expected: today?.sportCoinNum,
    record,
  };
}

async function get(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 429) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

function parse(input) {
  const rows = String(input)
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (!rows.length) throw new Error("Token 为空");
  return rows.map((value, index) => {
    let remark = `账号${index + 1}`;
    let token = value;
    if (!/^bearer\s+/i.test(value) && value.includes("#") && value.split("#", 1)[0].length <= 20)
      [remark, token] = value.split(/#(.+)/s);
    return { remark: String(remark).trim().slice(0, 20), token: normalizeToken(token) };
  });
}
function normalizeToken(value) {
  let token = String(value || "")
    .trim()
    .replace(/^(authorization|auth|token)\s*[:=]\s*/i, "");
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, "");
  if (token.length < 30) throw new Error("Token 格式错误或过短");
  return `Bearer ${token}`;
}
function jwt(token) {
  try {
    const raw = token.replace(/^Bearer\s+/i, "").split(".")[1];
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
function render(info, name) {
  const award = info.record ? `${info.record.statusNote || ""} ${info.record.awardName || ""}`.trim() : "今日暂无记录";
  return [
    `${name || "Keep账号"}（${mask(info.uid)}）`,
    `运动币：${info.balance}`,
    `签到：${info.signed ? "已签到" : `待签到${info.expected ? `，预计 ${info.expected} 币` : ""}`}`,
    `抽奖：${award}`,
  ].join("\n");
}
function named(value, name) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows.filter((item) => item?.name === name);
}
async function ownerKey(sender) {
  return `Keep|${await sender.getPlatform()}:${await sender.getUserId()}`;
}
function owned(item, owner) {
  return String(item?.remarks || item?.remark || "").startsWith(`${owner}|`);
}
function remark(item) {
  return String(item?.remarks || item?.remark || "").split("|")[2] || "";
}
function uid(item) {
  return String(item?.remarks || item?.remark || "").split("|")[3] || "";
}
function envId(item) {
  return item?.id ?? item?._id;
}
function mask(value) {
  const text = String(value || "");
  return text.length > 8 ? `${text.slice(0, 4)}****${text.slice(-4)}` : `${text.slice(0, 2)}***`;
}
function normalize(raw) {
  const value = raw || {};
  const envName = String(value.env_name || "keep").trim();
  if (!/^[A-Za-z_]\w*$/.test(envName)) throw new Error("环境变量名格式错误");
  return { qinglongId: Number(value.qinglong_id) || 1, envName };
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

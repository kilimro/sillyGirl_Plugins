// [title: 太平洋汽车]
// [name: m096TaiPingYangQiChe]
// [desc: 按 Python 业务流程完成账密登录、积分/钱包实时查询及青龙同步]
// [author: rujingxianghai]
// [version: v1.6.0]
// [rule: ^太平洋(登录|登陆|查询|管理|清理|删除|教程)$|^登录太平洋$]
// [cron: 10 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m096_太平洋汽车_v1.5.0_By.mrconli.py;backup/太平洋汽车_v1.2_By.rujingxianghai.py]
// [depe: []]

const { createHash } = require("crypto");
const { container, plugin, sender: s } = require("sillygirl");

const form = new plugin.Form({
  qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
  env_name: plugin.Form.string().title("环境变量名").default("S_TPYQC"),
});

const LOGIN = "https://mrobot.pcauto.com.cn/auto_passport3_back_intf/passport3/rest/login_new.jsp";
const SIGN = "https://api.pcauto.com.cn/user-growth/sign/getSignCenterInfo";
const WALLET = "https://app-gateway.pcauto.com.cn/wallet/cash/balance";

async function main() {
  try {
    const cfg = normalize(await form.get());
    const content = String((await s.getMsg()) || "").trim();
    const ql = new container.QingLong({ id: cfg.qinglongId });
    if (/教程/.test(content))
      return s.reply("发送“太平洋登录”，再提交 手机号#密码；查询会实时返回积分、余额、已提现和累计收入。");
    if (/查询|管理/.test(content)) return queryAccounts(ql, cfg.envName);
    if (/清理|删除/.test(content)) return removeAccounts(ql, cfg.envName);
    if (/登录|登陆/.test(content)) {
      await s.reply("请发送 手机号#密码，多账号换行，输入 q 取消。");
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
    return s.reply("指令：太平洋登录 / 太平洋查询 / 太平洋管理 / 太平洋清理 / 太平洋教程");
  } catch (error) {
    return s.reply(`太平洋汽车处理失败：${err(error)}`);
  }
}

async function saveAccounts(ql, envName, input, reply) {
  try {
    const owner = await ownerKey(reply);
    const current = named(await ql.getEnvs({ searchValue: envName }), envName);
    let created = 0;
    let updated = 0;
    const reports = [];
    for (const account of parse(input)) {
      const info = await queryAssets(account.phone, account.password);
      const value = `${account.phone}#${account.password}`;
      const old = current.find((item) => owned(item, owner) && first(item.value) === account.phone);
      const env = { name: envName, value, remarks: `${owner}|${account.phone}` };
      if (old) {
        await ql.updateEnv({ ...env, id: envId(old) });
        updated += 1;
      } else {
        await ql.createEnv(env);
        created += 1;
      }
      reports.push(render(info));
    }
    return reply.reply([`太平洋汽车同步完成：新增 ${created}，更新 ${updated}`, ...reports].join("\n\n"));
  } catch (error) {
    return reply.reply(`太平洋汽车提交失败：${err(error)}`);
  }
}

async function queryAccounts(ql, envName) {
  const owner = await ownerKey(s);
  const admin = await s.isAdmin();
  const rows = named(await ql.getEnvs({ searchValue: envName }), envName).filter((item) => admin || owned(item, owner));
  if (!rows.length) return s.reply("没有找到你的太平洋汽车账号");
  const reports = [];
  for (const item of rows) {
    const [phone, password] = String(item.value || "").split("#", 2);
    try {
      reports.push(render(await queryAssets(phone, password)));
    } catch (error) {
      reports.push(`${mask(phone)}：${err(error)}`);
    }
  }
  return s.reply(reports.join("\n\n"));
}

async function removeAccounts(ql, envName) {
  const owner = await ownerKey(s);
  const admin = await s.isAdmin();
  const ids = named(await ql.getEnvs({ searchValue: envName }), envName)
    .filter((item) => admin || owned(item, owner))
    .map(envId)
    .filter(Boolean);
  if (!ids.length) return s.reply("没有可清理的太平洋汽车账号");
  await ql.deleteEnvs(ids);
  return s.reply(`已清理 ${ids.length} 个太平洋汽车账号`);
}

async function queryAssets(phone, password) {
  const login = await json(LOGIN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0" },
    body: new URLSearchParams({ username: phone, password }),
  });
  if (Number(login.status) !== 0 || !login.common_session_id || !login.userId)
    throw new Error(login.msg || login.message || "登录失败");
  const session = String(login.common_session_id);
  const userId = String(login.userId);
  const timestamp = String(Date.now());
  const signature = md5(md5(`PCauto-2025-${timestamp}`));
  const ua =
    "Mozilla/5.0 (Linux; Android 16; PLC110 Build/BP2A.250605.015; wv) AppleWebKit/537.36 Chrome/145.0.7632.159 Mobile Safari/537.36";
  const sign = await json(`${SIGN}?sessionId=${encodeURIComponent(session)}`, {
    headers: {
      "x-auto-signature": signature,
      "x-auto-time": timestamp,
      distinctid: userId,
      sessionid: session,
      cookie: `common_session_id=${session}`,
      "user-agent": ua,
    },
  });
  const wallet = await json(`${WALLET}?common_session_id=${encodeURIComponent(session)}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `common_session_id=${session}`, "user-agent": ua },
    body: "{}",
  });
  if (Number(sign.code) !== 200) throw new Error(sign.message || sign.msg || "积分接口异常");
  if (Number(wallet.code) !== 200) throw new Error(wallet.message || wallet.msg || "钱包接口异常");
  return {
    phone,
    points: sign.data?.myPoint ?? 0,
    balance: wallet.data?.balance ?? "0.00",
    withdrawn: wallet.data?.withdrawn ?? "0.00",
    total: wallet.data?.total ?? "0.00",
  };
}

async function json(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

function parse(input) {
  return String(input)
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row, index) => {
      const [phone, password, ...extra] = row.split("#").map((part) => part.trim());
      if (!/^1\d{10}$/.test(phone) || !password || extra.length)
        throw new Error(`第 ${index + 1} 行格式应为 手机号#密码`);
      return { phone, password };
    });
}
function render(info) {
  return [
    `账号：${mask(info.phone)}`,
    `积分：${info.points}`,
    `余额：${info.balance}`,
    `已提现：${info.withdrawn}`,
    `累计收入：${info.total}`,
  ].join("\n");
}
function md5(value) {
  return createHash("md5").update(String(value)).digest("hex");
}
function named(value, name) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows.filter((item) => item?.name === name);
}
async function ownerKey(sender) {
  return `太平洋汽车|${await sender.getPlatform()}:${await sender.getUserId()}`;
}
function owned(item, owner) {
  return String(item?.remarks || item?.remark || "").startsWith(`${owner}|`);
}
function envId(item) {
  return item?.id ?? item?._id;
}
function first(value) {
  return String(value || "").split("#", 1)[0];
}
function mask(value) {
  const text = String(value || "");
  return text.length > 7 ? `${text.slice(0, 3)}****${text.slice(-4)}` : `${text.slice(0, 2)}***`;
}
function normalize(raw) {
  const value = raw || {};
  const envName = String(value.env_name || "S_TPYQC").trim();
  if (!/^[A-Za-z_]\w*$/.test(envName)) throw new Error("环境变量名格式错误");
  return { qinglongId: Number(value.qinglong_id) || 1, envName };
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

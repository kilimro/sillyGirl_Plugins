// [title: 众安健康]
// [name: zhongAnJianKang]
// [desc: 按 Python 流程使用 Access-Token 完成账号绑定、签到、任务领奖、余额查询和失效检测]
// [author: rujingxianghai]
// [version: v3.1.0]
// [rule: ^众安(登录|登陆|查询|管理|清理|教程|一键运行|总结|检测)$|^登录众安$]
// [cron: 56 6,9,13,16,19,20 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/众安健康_v3.0_By.rujingxianghai.py]
// [depe: []]

const { createHash, randomBytes } = require("crypto");
const { Bucket, plugin, sender: s } = require("sillygirl");

const form = new plugin.Form({
  auto_withdraw: plugin.Form.boolean().title("余额满 5 元自动提现").default(false),
});
const users = new Bucket("s_zajk_user");
const tokens = new Bucket("s_zajk_token");
const phones = new Bucket("s_zajk_phone");
const remarks = new Bucket("s_zajk_remark");
const API = "https://ihealth.zhongan.com";

async function main() {
  try {
    const cfg = await form.get();
    const content = String((await s.getMsg()) || "").trim();
    if (!content) return runAll(cfg, false);
    if (/教程/.test(content))
      return s.reply("发送 众安登录，再提交 Access-Token#备注；查询显示积分和可提现余额，一键运行完成签到与领奖。");
    if (/登录|登陆/.test(content)) return login();
    if (/清理/.test(content)) return clearOwn();
    if (/检测/.test(content)) return checkOwn();
    if (/一键运行/.test(content)) {
      if (!(await s.isAdmin())) return s.reply("仅管理员可运行全部账号");
      return runAll(cfg, true);
    }
    if (/查询|管理|总结/.test(content)) return queryOwn();
    return s.reply("指令：众安登录 / 众安查询 / 众安清理 / 众安一键运行 / 众安检测 / 众安教程");
  } catch (error) {
    return s.reply(`众安健康处理失败：${err(error)}`);
  }
}

async function login() {
  await s.reply("请发送 Access-Token#备注，多账号换行，输入 q 取消。");
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 120000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const input = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(input)) return "已取消";
      try {
        const owner = await ownerKey(next);
        const ids = new Set(await accountIds(owner));
        const reports = [];
        for (const row of parse(input)) {
          const phone = await maskedPhone(row.token);
          const id = createHash("md5").update(row.token).digest("hex").slice(0, 16);
          await tokens.set(id, row.token);
          await phones.set(id, phone);
          await remarks.set(id, row.remark);
          ids.add(id);
          reports.push(`${mask(phone)}（${row.remark}）`);
        }
        await users.set(owner, JSON.stringify([...ids]));
        return next.reply([`众安绑定完成：${reports.length} 个`, ...reports].join("\n"));
      } catch (error) {
        return next.reply(`众安绑定失败：${err(error)}`);
      }
    },
  });
}

async function queryOwn() {
  const owner = await ownerKey(s);
  const ids = await accountIds(owner);
  if (!ids.length) return s.reply("未绑定众安健康账号，请发送 众安登录");
  const reports = [];
  for (const id of ids) {
    const token = await tokens.get(id, "");
    try {
      reports.push(render(await accountInfo(token), await phones.get(id, "未知"), await remarks.get(id, "默认账号")));
    } catch (error) {
      reports.push(`${await remarks.get(id, id)}：${err(error)}`);
    }
  }
  return s.reply(reports.join("\n\n"));
}

async function checkOwn() {
  const owner = await ownerKey(s);
  const ids = await accountIds(owner);
  const valid = [];
  const invalid = [];
  for (const id of ids) {
    try {
      await accountInfo(await tokens.get(id, ""));
      valid.push(id);
    } catch {
      invalid.push(id);
      await tokens.delete(id);
      await phones.delete(id);
      await remarks.delete(id);
    }
  }
  await users.set(owner, JSON.stringify(valid));
  return s.reply(`众安检测完成：有效 ${valid.length}，清理失效 ${invalid.length}`);
}

async function clearOwn() {
  const owner = await ownerKey(s);
  const ids = await accountIds(owner);
  for (const id of ids) {
    await tokens.delete(id);
    await phones.delete(id);
    await remarks.delete(id);
  }
  await users.delete(owner);
  return s.reply(`已清理 ${ids.length} 个众安健康账号`);
}

async function runAll(cfg, notify) {
  let total = 0;
  let success = 0;
  let earned = 0;
  for (const owner of await users.keys()) {
    for (const id of await accountIds(owner)) {
      total += 1;
      try {
        const result = await runTasks(await tokens.get(id, ""), cfg.auto_withdraw === true);
        success += 1;
        earned += Number(result.earned || 0);
      } catch {
        /* 下一账号 */
      }
    }
  }
  const text = `众安任务完成：成功 ${success}/${total}，本轮新增积分 ${earned}`;
  if (notify) return s.reply(text);
  if (total) await s.pushAdmin(text);
}

async function accountInfo(token) {
  const headers = auth(token);
  const home = await request("POST", "/api/lemon/v1/common/activity/homePage", headers, {
    channelCode: "c20195660470001",
    activityCode: "ONA20220411001",
  });
  if (String(home.code) !== "0") throw new Error(home.message || "Token 已失效");
  const award = await request("POST", "/api/lemon/v1/common/activity/awardList", headers, {
    channelCode: "c20195660470001",
    activityCode: "ONA20220411001",
  });
  const details = award?.result?.detailList || [];
  let income = 0;
  let outcome = 0;
  for (const item of details) {
    const raw = String(item?.amount || "");
    const value = Number(raw.replace(/[^\d.-]/g, "")) || 0;
    if (raw.startsWith("+")) income += value;
    else if (raw.startsWith("-")) outcome += Math.abs(value);
  }
  return { points: home?.result?.sumAward ?? 0, balance: income - outcome, income, outcome };
}

async function runTasks(token, autoWithdraw) {
  const headers = auth(token);
  const common = { channelCode: "c20195660470001", activityCode: "ONA20220411001" };
  const wall = infernal();
  await request("POST", "/api/lemon/v1/common/activity/signIn", headers, {
    ...common,
    infernalWallParams: wall,
    envSource: "miniprogram",
  }).catch(() => ({}));
  const home = await request("POST", "/api/lemon/v1/common/activity/homePage", headers, common);
  if (String(home.code) !== "0") throw new Error(home.message || "Token 已失效");
  const taskRows = Object.entries(home?.result?.productRecommend || {}).filter(
    ([, item]) => item?.status === false && item?.link,
  );
  for (const [goodsCode, item] of taskRows) {
    const url = new URL(item.link);
    await request("POST", "/api/lemon/v1/applet/mgm/activity/add/award", headers, {
      activityCode: url.searchParams.get("activityCode") || "",
      channelCode: url.searchParams.get("healthChannelCode") || "",
      goodsCode,
      taskId: url.searchParams.get("taskId") || "",
    }).catch(() => ({}));
  }
  const available = [
    home?.result?.valuableRewardList,
    home?.result?.rewardList,
    home?.result?.taskList,
    home?.result?.activityTasks,
    home?.result?.unclaimedRewards,
  ]
    .flat()
    .filter(Boolean)
    .filter((item) => !(item.received || item.isReceived || item.claimed || item.isClaimed));
  let base = Number(home?.result?.sumAward || 0);
  let earned = 0;
  for (const item of available) {
    const id = item.awardDetailId || item.awardId || item.id || item.taskId;
    if (!id) continue;
    const data = await request("POST", "/api/lemon/v1/common/activity/lottery", headers, {
      ...common,
      id,
      infernalWallParams: infernal(),
      envSource: "miniprogram",
    }).catch(() => ({}));
    const now = Number(data?.result?.sumAward);
    if (Number.isFinite(now)) {
      earned += now - base;
      base = now;
    }
  }
  if (autoWithdraw) {
    const info = await accountInfo(token);
    if (info.balance >= 5)
      await request("POST", "/api/lemon/v1/common/activity/withdraw", headers, {
        ...common,
        infernalWallParams: infernal(),
        envSource: "miniprogram",
      }).catch(() => ({}));
  }
  return { earned, points: base };
}

async function maskedPhone(token) {
  const data = await request("POST", "/api/lemon/v1/wechatApplet/obtainBaseInfo/c20195660470001", auth(token), {});
  if (String(data.code) !== "0" || !data?.result?.phone) throw new Error(data.message || "Token 验证失败");
  return String(data.result.phone);
}
async function request(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}
function auth(token) {
  if (!String(token || "").trim()) throw new Error("Token 为空");
  return {
    accept: "application/json",
    "access-token": String(token).trim(),
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 MicroMessenger/7.0 MiniProgramEnv/Windows",
    referer: "https://servicewechat.com/wxbac45cc1588a5a75/417/page-frame.html",
    scene: "fa339ec6a687#prd#support",
  };
}
function infernal() {
  const ts = Date.now();
  const scene = `frdadbe${Math.floor(10000 + Math.random() * 90000)}`;
  const salt = createHash("md5").update(String(ts)).digest("hex").slice(0, 8);
  const sum = [...salt].reduce((n, c) => n + c.charCodeAt(0), 0) % 100;
  const did = `${createHash("sha1").update(randomBytes(16)).digest("hex")}:35:${createHash("sha256").update(String(ts)).digest("hex")}`;
  return {
    did,
    token: `2:12:${ts}:${scene}::${salt}:896:${createHash("sha256").update(`896_${ts}`).digest("hex")}:${sum}`,
    s: scene,
    scene,
  };
}
function parse(input) {
  return String(input)
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row, index) => {
      const cut = row.indexOf("#");
      const token = (cut < 0 ? row : row.slice(0, cut)).trim();
      const remark = (cut < 0 ? `账号${index + 1}` : row.slice(cut + 1)).trim();
      if (token.length < 8) throw new Error(`第 ${index + 1} 行 Token 格式错误`);
      return { token, remark: remark || `账号${index + 1}` };
    });
}
async function accountIds(owner) {
  try {
    const value = JSON.parse(await users.get(owner, "[]"));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}
async function ownerKey(sender) {
  return `${await sender.getPlatform()}:${await sender.getUserId()}`;
}
function render(info, phone, remark) {
  return [
    `${remark}（${mask(phone)}）`,
    `积分：${info.points}`,
    `可提现：${info.balance.toFixed(2)}`,
    `累计收入：${info.income.toFixed(2)}`,
    `累计支出：${info.outcome.toFixed(2)}`,
  ].join("\n");
}
function mask(value) {
  const text = String(value || "");
  return text.length > 7 ? `${text.slice(0, 3)}****${text.slice(-4)}` : text;
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

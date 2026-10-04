// [title: 爱路桥]
// [name: aiLuQiao]
// [desc: 爱路桥短信或手机号UID批量登录、昵称/积分/红包历史查询、账号管理、授权、青龙同步和到期检测。]
// [author: huawei / mrconli]
// [version: v1.4.1]
// [rule: raw ^爱路桥(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/【自用】-爱路桥_v1.0.4_By.huawei.py;backup/爱路桥_v1.4.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://www.ailuqiao.cn/mobile";
function cookie() {
  return `beegosessionID=${crypto.randomBytes(16).toString("hex")}`;
}
function headers(c) {
  return {
    "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36",
    connection: "Keep-Alive",
    "accept-encoding": "gzip",
    cookie: c,
  };
}
async function userInfo(ctx, uid, c) {
  const d = await ctx.requestJson(`${BASE}/myinfo?uid=${encodeURIComponent(uid)}`, { headers: headers(c) }),
    x = d?.data;
  if (!x?.mobile) throw new Error(d?.message || "UID认证失败");
  return { mobile: String(x.mobile), nickname: x.nickname || "未知用户", integral: x.integral ?? 0 };
}
async function records(ctx, uid, c) {
  const d = await ctx.requestJson(`${BASE}/my_luck?uid=${encodeURIComponent(uid)}&cid=1028`, { headers: headers(c) }),
    rows = Array.isArray(d?.data) ? d.data : [],
    now = new Date(),
    cur = now.getMonth(),
    prev = (cur + 11) % 12;
  let total = 0,
    current = 0,
    last = 0;
  const recent = [];
  for (const r of rows) {
    const amount = Number.parseFloat(String(r.draw || 0).replace("元", "")) || 0,
      time = new Date(r.create_time);
    total += amount;
    if (time.getFullYear() === now.getFullYear() && time.getMonth() === cur) current += amount;
    const py = cur === 0 ? now.getFullYear() - 1 : now.getFullYear();
    if (time.getFullYear() === py && time.getMonth() === prev) last += amount;
    if (recent.length < 5) recent.push(`[${amount.toFixed(2)}元] ${r.create_time || ""}`);
  }
  return { total, current, last, recent };
}
async function sms(ctx) {
  const phone = await ctx.prompt(ctx.sender, "请输入手机号", 120000);
  if (!/^1[3-9]\d{9}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
  const c = cookie(),
    sent = await ctx.requestJson(`${BASE}/service_send`, {
      method: "POST",
      headers: { ...headers(c), "content-type": "application/x-www-form-urlencoded" },
      form: { mobile: phone },
    });
  if (Number(sent?.status) !== 1) throw new Error(sent?.message || "发送验证码失败");
  const code = await ctx.prompt(ctx.sender, "请输入收到的验证码", 300000),
    login = await ctx.requestJson(`${BASE}/service_yz`, {
      method: "POST",
      headers: { ...headers(c), "content-type": "application/x-www-form-urlencoded" },
      form: { mobile: phone, code },
    });
  if (Number(login?.status) !== 1 || !login?.uid) throw new Error(login?.message || "验证码登录失败");
  return { phone: String(phone), uid: String(login.uid), cookie: c };
}
const rt = createAccountRuntime({
  title: "爱路桥",
  shortName: "爱路桥",
  prefix: "mrconli.ailuqiao",
  defaultEnvName: "S_ALQ",
  orderPrefix: "ALQ",
  requireAuthForQuery: true,
  async login(ctx) {
    const choice = await ctx.prompt(ctx.sender, "[1] 短信登录\n[2] 手机号#UID批量登录", 60000);
    if (choice === null) return [];
    if (choice === "1") {
      try {
        const x = await sms(ctx),
          u = await userInfo(ctx, x.uid, x.cookie);
        return [{ account: x.phone, token: `${x.uid}#${x.cookie}`, remark: u.nickname || x.phone }];
      } catch (error) {
        await ctx.sender.reply(`短信登录失败：${error?.message || error}`);
        return [];
      }
    }
    const input = await ctx.prompt(ctx.sender, "请输入手机号#6位UID，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const [phone, uid] = line.trim().split("#"),
          c = cookie();
        if (!/^1[3-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(uid)) throw new Error("格式错误");
        const u = await userInfo(ctx, uid, c),
          masked = `${phone.slice(0, 3)}*****${phone.slice(-2)}`;
        if (u.mobile !== masked && u.mobile !== phone) throw new Error("UID与手机号不匹配");
        rows.push({ account: phone, token: `${uid}#${c}`, remark: u.nickname || phone });
      } catch (error) {
        await ctx.sender.reply(`爱路桥登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const i = item.token.indexOf("#"),
      uid = item.token.slice(0, i),
      c = item.token.slice(i + 1),
      u = await userInfo(ctx, uid, c),
      r = await records(ctx, uid, c);
    return `👤 昵称：${u.nickname}\n🍀 积分：${u.integral}\n🧧 历史汇总：${r.total.toFixed(2)}元\n📈 本月累计：${r.current.toFixed(2)}元\n📊 上月统计：${r.last.toFixed(2)}元\n🎁 最近红包：\n${r.recent.join("\n") || "暂无"}`;
  },
  async cronCheck(ctx, item) {
    try {
      const i = item.token.indexOf("#");
      await userInfo(ctx, item.token.slice(0, i), item.token.slice(i + 1));
      return "";
    } catch (_) {
      return "UID/Cookie检测失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====爱路桥教程=====\n支持短信验证码，或手机号#6位UID批量登录\n查询昵称、积分、红包历史/本月/上月统计\n指令：爱路桥登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`爱路桥执行失败：${e?.message || e}`));

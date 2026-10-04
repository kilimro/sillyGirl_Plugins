// [title: 乐仔生活]
// [name: leZaiShengHuo]
// [desc: 乐仔生活 Token/短信登录、积分查询、签到、扫码及日常任务、授权和青龙同步。]
// [author: yuhualhh]
// [version: v1.1.3]
// [rule: raw ^乐仔(登录|登陆|查询|管理|清理|检测|运行|一键运行|授权|教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/乐仔生活_v1.1.3_By.yuhualhh.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://infor.leyaoyao.com/infor/xiaolelife";
function h(token = "") {
  return {
    xiaoletoken: token,
    "user-agent": "okhttp/4.9.2",
    "content-type": "application/json",
    "accept-encoding": "gzip",
  };
}
async function api(ctx, token, path, opt = {}) {
  return ctx.requestJson(`${BASE}${path}`, { ...opt, headers: { ...h(token), ...(opt.headers || {}) } });
}
function ok(d) {
  return String(d?.code) === "0000000";
}
async function profile(ctx, token) {
  const d = await api(ctx, token, "/user-info");
  if (!ok(d)) throw new Error(d?.message || "Token无效");
  const x = d.body || {};
  return { uid: String(x.userId || ""), phone: String(x.telephone || "") };
}
async function assets(ctx, token) {
  const [a, b] = await Promise.all([api(ctx, token, "/points/wall/v4"), api(ctx, token, "/points/desc")]);
  if (!ok(a)) throw new Error(a?.message || "查询失败");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    records = Array.isArray(b?.body) ? b.body : [],
    todayScore = records
      .filter((x) => String(x.createTime || "").includes(today) && Number(x.points) > 0)
      .reduce((n, x) => n + Number(x.points), 0);
  return { total: a?.body?.totalPoints ?? 0, today: todayScore, wall: a?.body || {}, records };
}
async function finish(ctx, token, id) {
  let payload = { taskId: id };
  try {
    const x = await ctx.requestJson(`https://yuhualhh.250666.xyz/api/lezai_sign.php?taskId=${encodeURIComponent(id)}`);
    if (x?.signedText) payload = { taskId: id, random: x.random, timestamp: x.timestamp, signedText: x.signedText };
  } catch {}
  const d = await api(ctx, token, "/points/mark-finished", { method: "POST", json: payload });
  return ok(d) && d?.body?.flag === true;
}
async function run(ctx, token) {
  const out = [],
    sign = await api(ctx, token, "/sign-in");
  out.push(
    ok(sign)
      ? `🎨 签到：${Number(sign?.body?.points) > 0 ? `获得${sign.body.points}分` : "今日已签"}`
      : `❌ 签到：${sign?.message || "失败"}`,
  );
  const a = await assets(ctx, token),
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    qrDone = a.records.filter(
      (x) => String(x.createTime || "").includes(today) && String(x.desc || "").includes("扫码积分派发任务"),
    ).length;
  let q = qrDone;
  for (; q < 3; q++) {
    const d = await api(ctx, token, "/third/auth/qr-code/wxmini/url/v3", {
      method: "POST",
      json: { authDomain: "c.cooleasy.net", equipmentValue: String(541000 + Math.floor(Math.random() * 9000)) },
    });
    if (!ok(d)) break;
  }
  out.push(`💳 扫码积分派发任务：${Math.min(q, 3)}/3`);
  for (const g of a.wall.types || [])
    for (const t of g.tasks || []) {
      if ([150, 151].includes(Number(t.taskId))) continue;
      const limit = Number(t.limit || 1),
        done = Number(t.doneCount || 0);
      if (t.finished || done >= limit) {
        out.push(`✅ ${t.name}`);
        continue;
      }
      let n = done;
      for (; n < limit; n++) {
        if (!(await finish(ctx, token, t.taskId))) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      out.push(`${n >= limit ? "✅" : "❌"} ${t.name}：${n}/${limit}`);
    }
  const z = await assets(ctx, token);
  out.push(`🎫 总积分：${z.total}，今日+${z.today}`);
  return out;
}
const rt = createAccountRuntime({
  title: "乐仔生活",
  shortName: "乐仔",
  prefix: "yuhua_lezai",
  defaultEnvName: "LE_ZAI_SHENG_HUO",
  orderPrefix: "LEZAI",
  requireAuthForQuery: true,
  async login(ctx) {
    const way = await ctx.prompt(ctx.sender, "[1] Token登录\n[2] 短信登录", 120000);
    if (way === null) return [];
    let token = "";
    if (way === "1") token = await ctx.prompt(ctx.sender, "请输入 xiaoletoken", 120000);
    else if (way === "2") {
      const phone = await ctx.prompt(ctx.sender, "请输入手机号", 120000);
      if (!phone) return [];
      const sd = await api(ctx, "", `/verification-code?phoneNumber=${encodeURIComponent(phone)}`);
      if (!ok(sd)) throw new Error(sd?.message || "短信发送失败");
      const code = await ctx.prompt(ctx.sender, "验证码已发送，请输入验证码", 120000);
      if (!code) return [];
      const ld = await api(ctx, "", "/register-or-login", {
        method: "POST",
        json: {
          phoneNumber: phone,
          verificationCode: code,
          deviceId: "fb965a27c91647849b642751dfbd6e59",
          endpoint: "ANDROID",
          modelName: "default",
          version: "v_1.2.4",
        },
      });
      if (!ok(ld) || !ld?.body?.token) throw new Error(ld?.message || "登录失败");
      token = ld.body.token;
    } else return [];
    const u = await profile(ctx, token);
    return [{ account: u.uid || u.phone, token, remark: u.phone || u.uid }];
  },
  async query(ctx, item) {
    const u = await profile(ctx, item.token),
      a = await assets(ctx, item.token);
    return `📱 手机：${u.phone}\n🆔 UID：${u.uid}\n🎫 总积分：${a.total}\n🎨 今日积分：${a.today}`;
  },
  async handle(ctx, content) {
    if (!/运行/.test(content)) return;
    const uid = await ctx.currentUserId(),
      accounts = JSON.parse(await ctx.users.get(uid, "[]"));
    if (!accounts.length) return ctx.sender.reply("❌ 未找到账号，发送“乐仔登录”绑定");
    for (const account of accounts) {
      const remark = await ctx.remarks.get(account, account);
      try {
        const out = await run(ctx, await ctx.tokens.get(account, ""));
        await ctx.sender.reply(`=====乐仔运行=====\n👤 ${remark}\n${out.join("\n")}\n==================`);
      } catch (e) {
        await ctx.sender.reply(`❌ ${remark}：${e?.message || e}`);
      }
    }
  },
  async cronCheck(ctx, item) {
    return (await run(ctx, item.token)).join("\n");
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====乐仔生活教程=====\n可用 xiaoletoken 或手机号短信登录；查询积分，运行签到、扫码和日常积分任务。授权后同步青龙变量 LE_ZAI_SHENG_HUO。\n==================",
});
rt.main().catch((e) => s.reply(`乐仔生活执行失败：${e?.message || e}`));

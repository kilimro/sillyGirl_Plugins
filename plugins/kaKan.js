// [title: 卡看]
// [name: kaKan]
// [desc: 卡看短信登录、本地RSA签名、金币现金查询及攒钱罐进度任务]
// [author: dandan8]
// [version: v1.1.0]
// [rule: ^卡看(教程|登录|管理|查询|刷进度|授权|清理)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/卡看_v1.0.1_By.dandan8.py]
// [depe: ["./kakanCore.js","./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const core = require("./kakanCore.js"),
  BASE = "https://welfare-user.palmestore.com",
  API = "https://kakan-api.zhangyue.com";
async function sendSms(ctx, phone, d) {
  const p = {
      ...core.common(d),
      app_id: "zya3c0e0",
      data: core.aes(JSON.stringify({ phone })),
      flag: "1",
      usr: d.usr,
      zyeid: d.zyeid,
    },
    r = await core.call(ctx, "POST", `${API}/taiji_user/sms/sendSms`, p, d);
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "验证码发送失败");
  return r.body || {};
}
async function login(ctx, phone, code, d) {
  const p = {
      ...core.common(d),
      app_id: "zya3c0e0",
      data: core.aes(JSON.stringify({ phone })),
      device_no: d.p1,
      p_code: code,
      usr: d.usr,
      visitor_id: d.visitor_id || d.usr,
      zyeid: d.zyeid,
    },
    r = await core.call(ctx, "POST", `${API}/taiji_user/login/loginByPhone`, p, d);
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "验证码登录失败");
  const b = r.body || {};
  if (!b.user_id || !b.session_id) throw new Error("登录响应缺少user_id或session_id");
  d.usr = b.user_id;
  if (b.zyeid) d.zyeid = b.zyeid;
  return {
    user_id: b.user_id,
    encrypt_user_id: b.encrypt_user_id || b.user_id,
    session_id: b.session_id,
    device_info: d,
    name: b.name || phone,
    phone,
    login_time: new Date().toISOString(),
    login_type: "sms",
  };
}
async function api(ctx, sess, path, extra = {}, method = "GET") {
  const p = { ...core.common(sess.device_info, sess), ...extra },
    r = await core.call(ctx, method, `${BASE}${path}`, p, sess.device_info);
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "卡看接口失败");
  return r.body || {};
}
async function summary(ctx, sess) {
  const [user, gold] = await Promise.all([
    api(ctx, sess, "/api/user/info"),
    api(ctx, sess, "/api/user/gold_account", { gold_type: "3" }),
  ]);
  return {
    coin: user.total_coin || 0,
    cash: user.total_cash || 0,
    gold: gold.total_gold_num || 0,
    rmb: gold.total_rmb || 0,
    name: user.name || user.nickname || sess.name || sess.phone,
  };
}
async function task(ctx, sess, count) {
  let ok = 0,
    fail = 0,
    last = "";
  for (let i = 0; i < count; i++) {
    try {
      await api(ctx, sess, "/api/task/task/receive", { task_id: "3812", receive_type: "4", act_id: "1021" }, "POST");
      ok++;
    } catch (e) {
      fail++;
      last = e.message;
    }
  }
  return { ok, fail, last };
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    a = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!a.length) throw new Error("未绑定卡看账号");
  const k = a[0];
  return JSON.parse(await ctx.tokens.get(k, "{}"));
}
const rt = createAccountRuntime({
  title: "卡看",
  shortName: "卡看",
  prefix: "dd_kakan",
  defaultEnvName: "kakan",
  orderPrefix: "KK",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入11位手机号，支持多行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const phone of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error(`${phone}手机号格式错误`);
      const d = core.device(),
        sent = await sendSms(ctx, phone, d),
        code = await ctx.prompt(
          ctx.sender,
          `${phone.slice(0, 3)}****${phone.slice(-4)} 验证码已发送（剩余${sent.remains ?? "?"}次），请输入验证码`,
          120000,
        );
      if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误");
      const sess = await login(ctx, phone, code, d),
        q = await summary(ctx, sess);
      out.push({ account: String(sess.user_id), token: JSON.stringify(sess), remark: q.name || phone });
    }
    return out;
  },
  async query(ctx, item) {
    const q = await summary(ctx, JSON.parse(item.token));
    return `👤 用户：${q.name}\n💰 金币：${Number(q.coin).toLocaleString()}\n💵 余额：${q.cash}元\n🎯 金币账户：${Number(q.gold).toLocaleString()}（约${q.rmb}元）`;
  },
  async handle(ctx, c) {
    if (!/刷进度/.test(c)) return;
    const raw = await ctx.prompt(ctx.sender, "请输入攒钱罐任务执行次数（1-100）", 120000),
      count = Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("次数应为1-100");
    const r = await task(ctx, await owned(ctx), count);
    return ctx.sender.reply(`卡看刷进度完成：成功${r.ok}，失败${r.fail}${r.last ? `\n最后错误：${r.last}` : ""}`);
  },
  async cronCheck(ctx, item) {
    const q = await summary(ctx, JSON.parse(item.token));
    return `会话有效，金币${q.coin}，余额${q.cash}元`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial: "发送卡看登录，输入手机号和短信验证码。卡看查询查看金币现金；卡看刷进度执行 task_id=3812 的攒钱罐任务。",
});
rt.main().catch((e) => s.reply(`卡看执行失败：${e?.message || e}`));

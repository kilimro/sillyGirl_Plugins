// [title: 品赞]
// [name: pinZan]
// [desc: 品赞账号密码登录、Token自动刷新、钱包与推广信息查询、每周签到、套餐IP加白/删除和授权管理。]
// [author: sky2022]
// [version: v1.4.1]
// [rule: raw ^品赞(登录|登陆|上车|新增|查询|管理|授权|清理|教程|任务运行|一键运行|签到|加白|白名单|删除|自动加白|api生成)$]
// [cron: 0 8 * * 1]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/品赞_v1.4.1_By.sky2022.py;backup/wqwl-pzdl_v1.0.0_By.wqwlkj2985.js;backup/品赞管理_v0.1.0_By.xiaoqing.js;backup/品赞管理_v0.1.0_By.xiaoqing.txt]
// [depe: ["./mrconliAccountRuntime.js","./vortoUtils.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime"),
  vorto = require("./vortoUtils");
const BASE = "https://service.ipzan.com";
function ua() {
  return `Mozilla/5.0 (Linux; Android ${10 + Math.floor(Math.random() * 4)}; Xiaomi Build/SP1A.${210812 + Math.floor(Math.random() * 20000)}; wv) AppleWebKit/537.36 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.41`;
}
function h(token) {
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    host: "service.ipzan.com",
    "user-agent": ua(),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
function encode(phone, password) {
  const b = Buffer.from(`${phone}QWERIPZAN1290QWER${password}`).toString("base64"),
    r = crypto.randomBytes(200).toString("hex");
  return (
    r.slice(0, 100) +
    b.slice(0, 8) +
    r.slice(100, 200) +
    b.slice(8, 20) +
    r.slice(200, 300) +
    b.slice(20) +
    r.slice(300, 400)
  );
}
async function login(ctx, phone, password) {
  const d = await ctx.requestJson(`${BASE}/users-login`, {
      method: "POST",
      headers: h(),
      json: { account: encode(phone, password), source: "ipzan-home-one" },
    }),
    token = d?.data?.token;
  if (Number(d?.code) !== 0 || !token) throw new Error(d?.message || "登录失败");
  return token;
}
async function get(ctx, token, path) {
  return ctx.requestJson(BASE + path, { headers: h(token) });
}
async function userInfo(ctx, phone, password) {
  const token = await login(ctx, phone, password),
    u = await get(ctx, token, "/home/users-find"),
    w = await get(ctx, token, "/home/userWallet-find");
  if (Number(u?.code) !== 0 || Number(w?.code) !== 0) throw new Error(u?.message || w?.message || "查询失败");
  return {
    token,
    userId: u.data?.user_id || "",
    popularizeId: u.data?.popularize_id || "",
    balance: w.data?.balance ?? 0,
  };
}
async function checkin(ctx, phone, password) {
  let token = await login(ctx, phone, password),
    d = await get(ctx, token, "/home/userWallet-receive");
  if (Number(d?.code) !== 0 && /过期|未登录|token/i.test(String(d?.message))) {
    token = await login(ctx, phone, password);
    d = await get(ctx, token, "/home/userWallet-receive");
  }
  return { ok: Number(d?.code) === 0, message: d?.message || "签到成功" };
}
async function packageInfo(ctx, token) {
  const d = await get(ctx, token, "/home/userProduct-list?page=1&size=10"),
    p = d?.data?.content?.[0];
  if (Number(d?.code) !== 0 || !p) throw new Error(d?.message || "未找到套餐");
  return p;
}
async function addWhite(ctx, phone, password, ip) {
  const token = await login(ctx, phone, password),
    keyData = await ctx.requestJson(`${BASE}/home/users-get-user-aes`, { method: "POST", headers: h(token) });
  if (Number(keyData?.code) !== 0) throw new Error(keyData?.message || "签名密钥获取失败");
  const p = await packageInfo(ctx, token),
    key = Buffer.from(String(keyData.data)),
    algo = `aes-${key.length * 8}-ecb`,
    cipher = crypto.createCipheriv(algo, key, null);
  cipher.setAutoPadding(true);
  const sign = Buffer.concat([
      cipher.update(
        `${password}:${String(p.status_type || "")
          .slice(0, 15)
          .toLowerCase()}:${Math.floor(Date.now() / 1000)}`,
        "utf8",
      ),
      cipher.final(),
    ]).toString("hex"),
    d = await ctx.requestJson(`${BASE}/whiteList-add`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      form: { no: p.no, ip, sign },
    });
  if (Number(d?.code) !== 0) throw new Error(d?.message || "加白失败");
  return d?.message || "加白成功";
}
async function whiteList(ctx, phone, password) {
  const token = await login(ctx, phone, password),
    u = await get(ctx, token, "/home/users-find"),
    p = await packageInfo(ctx, token),
    d = await get(
      ctx,
      token,
      `/whiteList-get?no=${encodeURIComponent(p.no)}&userId=${encodeURIComponent(u.data?.user_id || "")}`,
    );
  if (Number(d?.code) !== 0) throw new Error(d?.message || "白名单查询失败");
  return { token, userId: u.data?.user_id || "", no: p.no, list: d.data || [] };
}
async function pick(ctx) {
  const id = await ctx.currentUserId(),
    accounts = vorto.parseStoredList(await ctx.users.get(id, "[]"));
  if (!accounts.length) throw new Error("未绑定账号");
  if (accounts.length === 1) return accounts[0];
  const n = await ctx.prompt(ctx.sender, accounts.map((a, i) => `[${i + 1}] ${a}`).join("\n"), 60000);
  const i = Number(n) - 1;
  if (i < 0 || i >= accounts.length) throw new Error("账号序号无效");
  return accounts[i];
}
const rt = createAccountRuntime({
  title: "品赞",
  shortName: "品赞",
  prefix: "dd_pz",
  defaultEnvName: "DD_PZ",
  orderPrefix: "PZ",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：手机号#密码#备注，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = line.trim().split("#"),
          phone = p.shift(),
          password = p.shift(),
          remark = p.join("#") || phone;
        if (!/^1[3-9]\d{9}$/.test(phone) || !password) throw new Error("格式错误");
        const x = await userInfo(ctx, phone, password);
        rows.push({ account: phone, token: password, remark: remark || phone, extra: { remote_id: x.userId } });
      } catch (e) {
        await ctx.sender.reply(`品赞登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await userInfo(ctx, item.account, item.token);
    return `📱 账号：${ctx.mask(item.account)}\n🆔 用户ID：${x.userId}\n🔗 推广ID：${x.popularizeId}\n💰 钱包余额：${x.balance}`;
  },
  async cronCheck(ctx, item) {
    const d = await checkin(ctx, item.account, item.token),
      x = await userInfo(ctx, item.account, item.token);
    return `${d.ok ? "✅" : "❌"} ${d.message}\n当前余额：${x.balance}`;
  },
  async handle(ctx, content) {
    if (/任务运行|一键运行|签到/.test(content)) {
      const account = await pick(ctx),
        item = { account, token: await ctx.tokens.get(account, "") };
      return ctx.sender.reply((await checkin(ctx, item.account, item.token)).message);
    }
    if (/api生成/i.test(content)) {
      const account = await pick(ctx),
        password = await ctx.tokens.get(account, ""),
        token = await login(ctx, account, password),
        p = await packageInfo(ctx, token),
        d = await ctx.requestJson(
          `${BASE}/home/core-get-url?num=1&no=${encodeURIComponent(p.no)}&minute=1&format=json&protocol=1&pool=quality&mode=whitelist`,
          { headers: h(token) },
        );
      if (Number(d?.code) !== 0 || !d?.data?.url) throw new Error(d?.message || "API生成失败");
      return ctx.sender.reply(
        `账号：${ctx.mask(account)}\nAPI生成成功：\n${d.data.url}\n可修改 num、minute、format、pool 参数`,
      );
    }
    if (/自动加白|加白|白名单/.test(content)) {
      const account = await pick(ctx),
        password = await ctx.tokens.get(account, ""),
        automatic = /自动加白|白名单/.test(content);
      if (automatic && !(await ctx.sender.isAdmin())) return ctx.sender.reply("❌ 您不是管理员");
      let ip = automatic
        ? (await ctx.request("https://ipinfo.io/ip")).text.trim()
        : await ctx.prompt(ctx.sender, "请输入IPv4地址", 120000);
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(ip))) throw new Error("IPv4格式错误");
      return ctx.sender.reply(await addWhite(ctx, account, password, ip));
    }
    if (/删除/.test(content)) {
      const account = await pick(ctx),
        password = await ctx.tokens.get(account, ""),
        x = await whiteList(ctx, account, password);
      if (!x.list.length) return ctx.sender.reply("当前账号没有白名单IP");
      const n = await ctx.prompt(ctx.sender, x.list.map((v, i) => `[${i + 1}] ${v.ip || v.id}`).join("\n"), 60000),
        row = x.list[Number(n) - 1];
      if (!row) throw new Error("序号无效");
      const d = await ctx.requestJson(`${BASE}/whiteList-del`, {
        method: "DELETE",
        headers: h(x.token),
        json: { ip: row.id, no: x.no, userId: x.userId },
      });
      return ctx.sender.reply(Number(d?.code) === 0 ? "白名单删除成功" : `删除失败：${d?.message || "未知"}`);
    }
    return undefined;
  },
  envValue(_ctx, item) {
    return `${item.account}#${item.token}#${item.remark}`;
  },
  tutorial:
    "=====品赞教程=====\n格式：手机号#密码#备注；Token过期自动重登\n查询用户ID/推广ID/余额；每周一签到；支持套餐IP加白、自动加白、生成提取API和删除白名单\n指令：品赞登录、新增、查询、管理、签到、api生成、加白、自动加白、删除、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`品赞执行失败：${e?.message || e}`));

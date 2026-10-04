// [title: 朴朴超市]
// [name: puPuChaoShi]
// [desc: 朴朴 refresh_token/微信扫码登录、自动刷新、朴分查询、授权及青龙同步。]
// [author: sky2022 / yuhualhh]
// [version: v1.1.3]
// [rule: raw ^(朴朴登陆|朴朴登录|登录朴朴|登陆朴朴|朴朴查询|查询朴朴|朴朴管理|管理朴朴|朴朴刷新|刷新朴朴|朴朴授权|朴朴清理|朴朴教程)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/朴朴超市_v1.1.3_By.yuhualhh.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s, utils } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.46 miniProgram/wx122ef876a7132eb4";
async function refresh(ctx, token) {
  const d = await ctx.requestJson("https://cauth.pupuapi.com/clientauth/user/refresh_token", {
    method: "PUT",
    headers: { "user-agent": UA },
    json: { refresh_token: token },
  });
  if (Number(d?.errcode) !== 0) throw new Error(d?.message || "refresh_token失效");
  const x = d.data || {},
    i = await ctx.requestJson("https://cauth.pupuapi.com/clientauth/user/info", {
      headers: { "user-agent": UA, authorization: `Bearer ${x.access_token}` },
    }),
    u = i.data || {};
  return {
    access: x.access_token,
    refresh: x.refresh_token,
    userId: String(x.user_id || ""),
    phone: String(u.phone || ""),
    name: String(u.nick_name || ""),
  };
}
async function coin(ctx, access) {
  const headers = {
      authorization: `Bearer ${access}`,
      "user-agent": "Mozilla/5.0 (Linux; Android 13) Chrome/108 Mobile",
    },
    [a, b] = await Promise.all([
      ctx.requestJson("https://j1.pupuapi.com/client/coin", { headers }),
      ctx.requestJson("https://j1.pupuapi.com/client/coin/record?page=1&size=20", { headers }),
    ]),
    x = a.data || {},
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    gain = (b.data || [])
      .filter(
        (y) =>
          Number(y.type) === 0 &&
          new Date(Number(y.time_create)).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) === today,
      )
      .reduce((n, y) => n + Number(y.value || 0), 0);
  return {
    balance: x.balance ?? 0,
    today: gain,
    expiring: x.expiring_coin ?? 0,
    expire: x.expire_time
      ? new Date(Number(x.expire_time)).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
      : "",
  };
}
async function qr(ctx) {
  const api = "https://yuhualhh.250666.xyz/api/wxcode.php",
    c = await ctx.requestJson(api, { method: "POST", json: { project: "pupu", action: "create_qr" } }),
    x = c.data || {};
  if (!c.success || !x.uuid || !x.qr_img_url) throw new Error("二维码获取失败");
  await ctx.sender.reply(utils.image(x.qr_img_url));
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await ctx.requestJson(api, {
        method: "POST",
        json: { project: "pupu", action: "poll_scan_status", uuid: x.uuid },
      }),
      code = p?.data?.code;
    if (code) {
      const d = await ctx.requestJson(
        "https://cauth.pupuapi.com/clientauth/user/society/wechat/login?user_society_type=11",
        {
          method: "POST",
          headers: {
            "user-agent": "Pupumall/4.8.4;Android/13;",
            "pp-version": "2023022500",
            "pp-os": "10",
            pp_store_city_zip: "440100",
            "pp-elder-mode": "false",
          },
          json: {
            code,
            user_device: {
              app_version: 400804,
              device_model: "MEIZU 20",
              device_os: 10,
              device_token: "",
              mac_address: "",
            },
          },
        },
      );
      if (Number(d?.errcode ?? d?.code) !== 0) throw new Error(d?.message || "扫码登录失败");
      return d.data.refresh_token;
    }
  }
  throw new Error("扫码超时");
}
const rt = createAccountRuntime({
  title: "朴朴超市",
  shortName: "朴朴",
  prefix: "yuhua_pp",
  defaultEnvName: "pupuCookie",
  orderPrefix: "PUPU",
  requireAuthForQuery: true,
  async login(ctx) {
    const way = await ctx.prompt(ctx.sender, "[1] refresh_token登录\n[2] 微信扫码登录", 120000);
    if (way === null) return [];
    let token = way === "2" ? await qr(ctx) : await ctx.prompt(ctx.sender, "请输入 refresh_token", 120000);
    if (!token) return [];
    const u = await refresh(ctx, token);
    return [{ account: u.userId, token: u.refresh, remark: u.name || u.phone || u.userId, extra: { mobile: u.phone } }];
  },
  async query(ctx, item) {
    const u = await refresh(ctx, item.token);
    if (u.refresh !== item.token) await ctx.tokens.set(item.account, u.refresh);
    const a = await coin(ctx, u.access);
    return `📱 手机：${u.phone}\n👤 昵称：${u.name}\n🎫 当前朴分：${a.balance}\n🎨 今日朴分：${a.today}\n⛱️ 过期朴分：${a.expiring}${a.expire ? `（${a.expire}）` : ""}`;
  },
  async handle(ctx, content) {
    if (!/刷新/.test(content)) return;
    const uid = await ctx.currentUserId(),
      accounts = JSON.parse(await ctx.users.get(uid, "[]"));
    if (!accounts.length) return ctx.sender.reply("❌ 未找到朴朴账号");
    let n = 0;
    for (const account of accounts)
      try {
        const u = await refresh(ctx, await ctx.tokens.get(account, ""));
        await ctx.tokens.set(account, u.refresh);
        n++;
      } catch (e) {
        await ctx.sender.reply(`❌ ${await ctx.remarks.get(account, account)} 刷新失败：${e?.message || e}`);
      }
    return ctx.sender.reply(`朴朴刷新完成：${n}/${accounts.length}`);
  },
  async cronCheck(ctx, item) {
    const u = await refresh(ctx, item.token);
    if (u.refresh !== item.token) await ctx.tokens.set(item.account, u.refresh);
    const a = await coin(ctx, u.access);
    return `Token有效，朴分${a.balance}，今日+${a.today}${a.expiring ? `，将过期${a.expiring}` : ""}`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====朴朴超市教程=====\n支持 refresh_token 或微信扫码登录；查询朴分、今日获得及即将过期积分，自动轮换 refresh_token。授权后同步变量 pupuCookie。\n==================",
});
rt.main().catch((e) => s.reply(`朴朴超市执行失败：${e?.message || e}`));

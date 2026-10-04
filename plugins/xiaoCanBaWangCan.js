// [title: 小蚕霸王餐]
// [name: xiaoCanBaWangCan]
// [desc: 小蚕霸王餐CK登录、每日任务抽奖、卡券红包、提现、查单、抢单监控及红包雨]
// [author: yuhualhh]
// [version: v11.2.3]
// [rule: ^(小蚕)(教程|登录|查询|提宝|提微|查单|运行|管理|检测|清理|解限|授权|一键运行|一键监控|一键红包雨)$]
// [cron: 0 8,20 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/小蚕霸王餐_v11.2.3_By.yuhualhh.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const crypto = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime"),
  RPC = "https://gw.xiaocantech.com/rpc";
function md5(v) {
  return crypto.createHash("md5").update(String(v)).digest("hex");
}
function session(raw) {
  if (typeof raw === "string" && raw.trim().startsWith("{")) return JSON.parse(raw);
  const [vayne, teemo, sivir] = String(raw || "").split("#");
  if (!vayne || !teemo || !sivir) throw new Error("CK格式应为 x-vayne#x-teemo#x-sivir");
  return { vayne, teemo, sivir, cityCode: "440304", lat: null, lng: null };
}
function device() {
  return {
    model: "M2012K11AC",
    dm: "Xiaomi",
    ua: "Mozilla/5.0 (Linux; Android 13; M2012K11AC Build/TKQ1.221114.001; wv) AppleWebKit/537.36 MicroMessenger/8.0 MiniProgramEnv/android",
  };
}
function headers(x, server, method, extra = {}) {
  const ru = crypto.randomBytes(16).toString("hex"),
    teemo = String(x.teemo || "0"),
    nami = `${ru.slice(0, 4)}${teemo}${ru.slice(4, Math.max(4, 20 - teemo.length))}`.slice(0, 16),
    garen = String(Date.now()),
    ashe = md5(md5(`${server}.${method}`.toLowerCase()) + garen + nami),
    d = device();
  return {
    servername: server,
    methodname: method,
    version: "3.12.5.70",
    "x-version": "3.12.5.70",
    "x-nami": nami,
    "x-garen": garen,
    "x-ashe": ashe,
    "x-annie": "XC",
    "x-platform": "mini",
    "x-teemo": teemo,
    "x-vayne": String(x.vayne || "0"),
    "x-sivir": String(x.sivir || ""),
    "x-model": d.model,
    "x-city": String(extra["x-city"] || x.cityCode || "440304"),
    env: "",
    appid: String(extra.appid || "20"),
    userid: String(x.vayne || "0"),
    referer: "https://servicewechat.com/wx52ae177248081591/666/page-frame.html",
    "user-agent": d.ua,
    ...extra,
  };
}
async function rpc(ctx, x, server, method, payload, extra = {}) {
  const r = await ctx.requestJson(RPC, { method: "POST", json: payload, headers: headers(x, server, method, extra) }),
    st = r?.status || {};
  if (Number(st.code) !== 0) throw new Error(st.msg || `RPC失败 code=${st.code}`);
  return r;
}
async function silk(ctx, x) {
  const r = await rpc(ctx, x, "Silkworm", "SilkwormService.GetClientUserInfo", {
    silk_id: Number(x.teemo),
    if_need_subscribe: true,
    inviter_silk_id: 0,
    up: { rcp: 1, rc: 0, dm: device().dm, re_ch: "" },
    app_id: 20,
  });
  return r.user_info || {};
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function cards(ctx, x) {
  const total = {};
  for (let offset = 0; offset < 100; offset += 10) {
    const r = await rpc(ctx, x, "SilkwormCard", "SilkwormCardService.GetUserCardList", {
        silk_id: Number(x.teemo),
        status: 0,
        offset,
        number: 10,
        app_id: 20,
      }),
      list = r.list || [];
    for (const v of list) {
      const n = v.card?.name || "未知卡券";
      total[n] = (total[n] || 0) + 1;
    }
    if (list.length < 10) break;
  }
  return (
    Object.entries(total)
      .map(([k, v]) => `${k}x${v}`)
      .join("、") || "暂无"
  );
}
async function redpacks(ctx, x) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await rpc(ctx, x, "RedPackService", "RedPackService.GetAppRedPackList", {
        silk_id: Number(x.teemo),
        page,
        page_size: 10,
        app_id: 20,
      }),
      list = r.unused_items || [];
    for (const v of list)
      if (Number(v.user_red_pack_status) === 1)
        out.push(`${v.name || "封紅"}${(Number(v.value_num || 0) / 100).toFixed(2)}元`);
    if (list.length < 10) break;
  }
  return out.join("、") || "暂无";
}
async function run(ctx, x) {
  const logs = [];
  try {
    const r = await rpc(ctx, x, "ActivityTask", "ActivityTaskMobileService.SignIn", {
      silk_id: Number(x.teemo),
      app_id: 20,
    });
    logs.push(`签到获得${r.point || 0}`);
  } catch (e) {
    logs.push(`签到：${e.message}`);
  }
  for (const type of [1, 2, 8, 9, 10, 11]) {
    await wait(300);
    try {
      await rpc(ctx, x, "SilkwormLottery", "SilkwormLotteryMobile.AddLotteryTimes", {
        silk_id: Number(x.teemo),
        type,
        app_id: 20,
      });
      logs.push(`任务${type}完成`);
    } catch (e) {
      logs.push(`任务${type}：${e.message}`);
    }
  }
  for (const [task_type, bus_type] of [
    [6, 2],
    [7, 4],
  ]) {
    const timestamp = Math.floor(Date.now() / 1000),
      nonce = String(Math.floor(100000 + Math.random() * 900000)),
      text = `silk_id=${Number(x.teemo)}&timestamp=${timestamp}&nonce=${nonce}&bus_type=${bus_type}`,
      sign = crypto.createHmac("sha256", "lcjkbqadfrzsewxy").update(text).digest("base64");
    try {
      await rpc(ctx, x, "SilkwormLottery", "SilkwormLotteryMobile.OnAdViewed", {
        silk_id: Number(x.teemo),
        timestamp,
        nonce,
        bus_type,
        sign,
        task_type,
        app_id: 20,
      });
      logs.push(`广告任务${task_type}完成`);
    } catch (e) {
      logs.push(`广告任务${task_type}：${e.message}`);
    }
  }
  for (let i = 0; i < 20; i++) {
    try {
      const r = await rpc(ctx, x, "SilkwormLottery", "SilkwormLotteryMobile.Lottery", {
        silk_id: Number(x.teemo),
        prize_type: 1,
        app_id: 20,
      });
      logs.push(`抽奖：${r.prize?.name || "成功"}`);
    } catch (e) {
      logs.push(`抽奖结束：${e.message}`);
      break;
    }
  }
  for (const step of [1, 2])
    try {
      const r = await rpc(ctx, x, "SilkwormLottery", "SilkwormLotteryMobile.ReceiveExtraLottery", {
        silk_id: Number(x.teemo),
        step,
        app_id: 20,
      });
      logs.push(`累计奖励${step}：${r.prize?.name || "成功"}`);
    } catch (e) {
      logs.push(`累计奖励${step}：${e.message}`);
    }
  return logs;
}
async function withdraw(ctx, x, channel) {
  const u = await silk(ctx, x),
    amount = Number(u.silk || 0);
  if (amount < 100) throw new Error(`蚕豆不足，当前${(amount / 100).toFixed(2)}元`);
  await rpc(ctx, x, "Silkworm", "SilkwormService.ClientWithdraw", {
    silk_id: Number(x.teemo),
    silk: amount,
    channel,
    app_id: 20,
  });
  return amount / 100;
}
async function orders(ctx, x) {
  const r = await rpc(ctx, x, "Silkworm", "SilkwormService.GetPromotionOrderList", {
    silk_id: Number(x.teemo),
    order_status: 0,
    offset: 0,
    number: 50,
    app_id: 20,
  });
  return r.order_list || [];
}
function platform(p) {
  if (Number(p.tp_promotion?.tp_status) === 1) return 3;
  if (Number(p.meituan_status) === 1) return 1;
  if (Number(p.eleme_status) === 1 || Number(p.meituan_status) === 0) return 2;
  return 0;
}
function promoValues(p) {
  const pf = platform(p);
  if (pf === 1) return [pf, p.meituan_left_number, p.meituan_order_money, p.meituan_user_rebate];
  if (pf === 2) return [pf, p.eleme_left_number, p.eleme_order_money, p.eleme_user_rebate];
  return [pf, p.tp_promotion?.left_number, p.tp_promotion?.order_money, p.tp_promotion?.user_rebate];
}
async function promotions(ctx, x) {
  if (x.lat == null || x.lng == null) throw new Error("监控需在登录CK后附加 cityCode#lat#lng");
  const anon = { vayne: "0", teemo: "0", sivir: "", cityCode: x.cityCode };
  const out = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const r = await rpc(
        ctx,
        anon,
        "SilkwormRec",
        "RecService.GetStorePromotionList",
        {
          latitude: Number(x.lat),
          longitude: Number(x.lng),
          promotion_sort: 1,
          store_type: 0,
          offset,
          number: 20,
          silk_id: 0,
          promotion_filter: 0,
          promotion_category: 0,
          city_code: Number(x.cityCode),
          store_category: 0,
          store_platform: 0,
          app_id: 20,
        },
        { "x-city": String(x.cityCode) },
      ),
      list = r.promotion_list || [];
    out.push(...list);
    if (list.length < 20) break;
  }
  return out;
}
async function monitor(ctx, x) {
  const list = await promotions(ctx, x),
    now = new Date().getHours() * 60 + new Date().getMinutes(),
    valid = list
      .map((p) => ({ p, v: promoValues(p) }))
      .filter(
        (o) =>
          Number(o.v[1]) > 0 &&
          Number(o.p.start_time_hour) * 60 + Number(o.p.start_time_minute) <= now &&
          now <= Number(o.p.end_time_hour) * 60 + Number(o.p.end_time_minute),
      )
      .sort((a, b) => Number(b.v[3]) - Number(b.v[2]) - (Number(a.v[3]) - Number(a.v[2])));
  if (!valid.length) return "当前无可抢活动";
  const q = valid[0];
  await rpc(
    ctx,
    x,
    "Silkworm",
    "SilkwormService.GrabPromotionQuota",
    {
      silk_id: Number(x.teemo),
      promotion_id: q.p.promotion_id,
      store_platform: q.v[0],
      if_advance_order: false,
      if_pre_order: false,
      latitude: Number(x.lat),
      longitude: Number(x.lng),
      city_code: Number(x.cityCode),
      app_id: 20,
    },
    { "x-city": String(x.cityCode) },
  );
  return `抢单成功：${q.p.store?.name || q.p.promotion_id}`;
}
async function rain(ctx, x) {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
    r = await rpc(
      ctx,
      x,
      "SilkwormLottery",
      "SilkwormLotteryMobile.GetRedPackRainEventsByDate",
      { silk_id: Number(x.teemo), city_code: Number(x.cityCode), date, app_id: 20 },
      { "x-city": String(x.cityCode) },
    ),
    events = r.events || [];
  if (!events.length) return "当前无红包雨";
  const e = events.find((v) => !v.is_end) || events[0];
  await rpc(
    ctx,
    x,
    "SilkwormLottery",
    "SilkwormLotteryMobile.JoinRedPackRainEvent",
    { silk_id: Number(x.teemo), city_code: Number(x.cityCode), event_id: e.event_id, app_id: 20 },
    { "x-city": String(x.cityCode) },
  );
  const g = await rpc(
      ctx,
      x,
      "SilkwormLottery",
      "SilkwormLotteryMobile.RedPackRainGrabNum",
      { silk_id: Number(x.teemo), event_id: e.event_id, click_num: 18, app_id: 20 },
      { "x-city": String(x.cityCode) },
    ),
    it = g.items?.[0];
  return it ? `红包雨：${it.name || "封紅"}${(Number(it.prize_value || 0) / 100).toFixed(2)}元` : "红包雨完成，无奖品";
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    a = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!a.length) throw new Error("未绑定小蚕账号");
  return Promise.all(
    a.map(async (account) => ({
      account,
      remark: await ctx.remarks.get(account, account),
      x: session(await ctx.tokens.get(account, "")),
    })),
  );
}
async function each(ctx, fn) {
  const out = [];
  for (const a of await owned(ctx))
    try {
      out.push(`${a.remark}：${await fn(a.x)}`);
    } catch (e) {
      out.push(`${a.remark}：${e.message}`);
    }
  return ctx.sender.reply(out.join("\n"));
}
const rt = createAccountRuntime({
  title: "小蚕霸王餐",
  shortName: "小蚕",
  prefix: "yuhua_xcbwc",
  defaultEnvName: "yuhua_xcbwc",
  orderPrefix: "XC",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(
      ctx.sender,
      "请提交 备注#x-vayne#x-teemo#x-sivir，可选追加 #cityCode#lat#lng；多账号换行",
      120000,
    );
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)) {
      const p = line.split("#");
      if (p.length < 4) throw new Error(`${line}格式错误`);
      const remark = p.shift(),
        x = { vayne: p[0], teemo: p[1], sivir: p[2], cityCode: p[3] || "440304", lat: p[4] ?? null, lng: p[5] ?? null };
      const u = await silk(ctx, x);
      out.push({ account: String(x.teemo), token: JSON.stringify(x), remark: remark || u.nickname || x.teemo });
    }
    return out;
  },
  async query(ctx, item) {
    const x = session(item.token),
      u = await silk(ctx, x),
      [c, r] = await Promise.all([cards(ctx, x), redpacks(ctx, x)]),
      days = u.register_time ? Math.max(0, Math.floor((Date.now() - Number(u.register_time) * 1000) / 86400000)) : 0;
    return `🔥 累计已返：${(Number(u.withdraw_total || 0) / 100).toFixed(2)}元\n🗯️ 加入小蚕：${days}天\n⚡ 完成订单：${u.completed_number || 0}笔\n💰 当前蚕豆：${(Number(u.silk || 0) / 100).toFixed(2)}\n🎉 全部卡券：${c}\n✨ 全部封紅：${r}`;
  },
  async handle(ctx, c) {
    if (/运行/.test(c)) return each(ctx, async (x) => (await run(ctx, x)).join("；"));
    if (/提微/.test(c)) return each(ctx, async (x) => `微信提现${(await withdraw(ctx, x, 0)).toFixed(2)}元`);
    if (/提宝/.test(c)) return each(ctx, async (x) => `支付宝提现${(await withdraw(ctx, x, 1)).toFixed(2)}元`);
    if (/查单/.test(c))
      return each(ctx, async (x) => {
        const a = await orders(ctx, x);
        return a.length
          ? a
              .slice(0, 20)
              .map((v) => `${v.store?.name || v.store_name || "店铺"} ${v.order_status_name || v.status || ""}`)
              .join("；")
          : "暂无订单";
      });
    if (/监控/.test(c)) return each(ctx, (x) => monitor(ctx, x));
    if (/红包雨/.test(c)) return each(ctx, (x) => rain(ctx, x));
    if (/解限/.test(c))
      return each(ctx, async (x) => {
        const u = await silk(ctx, x);
        return `会话有效，当前风控状态：${u.risk_status || u.verify_status || "接口未标记"}`;
      });
  },
  async cronCheck(ctx, item) {
    const logs = await run(ctx, session(item.token));
    return logs.join("；");
  },
  envValue(_c, item) {
    return item.token;
  },
  tutorial:
    "发送“小蚕登录”，提交 备注#x-vayne#x-teemo#x-sivir；需要抢单监控时追加 cityCode#纬度#经度。小蚕运行执行签到/任务/抽奖，小蚕提微/提宝提现，小蚕查单查活动订单，小蚕一键监控抢最佳返现单，小蚕一键红包雨报名并开奖。",
});
rt.main().catch((e) => s.reply(`小蚕执行失败：${e?.message || e}`));

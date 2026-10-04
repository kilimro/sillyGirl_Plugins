// [title: 农夫山泉]
// [name: nongFuShanQuan]
// [desc: 农夫山泉 apitoken 绑定、每日任务、双场景抽奖、奖品领取与中奖记录查询。]
// [author: sky2022]
// [version: v7.4.0]
// [rule: raw ^农夫(登录|登陆|上车|批量|查询|管理|运行|一键运行|授权|清理|教程)$]
// [cron: 20 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/农夫山泉_vV7.4_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://sxs-consumer.nfsq.com.cn",
  SCENES = ["SCENE-2510301509021", "SCENE-2510301508361"];
const parse = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};
function splitCk(ck) {
  const p = String(ck || "").split("&");
  return { apitoken: p[0], unique: p[1] || crypto.randomUUID() };
}
function headers(x) {
  return {
    authority: "sxs-consumer.nfsq.com.cn",
    apitoken: x.apitoken,
    "content-type": "application/json",
    unique_identity: x.unique,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
    xweb_xhr: "1",
  };
}
async function verify(ctx, x) {
  const d = await ctx.requestJson(`${BASE}/geement.usercenter/api/v1/user/seniority?sencodes=SEN2510301505321`, {
    headers: headers(x),
  });
  if (Number(d?.code) !== 200) throw new Error(d?.msg || "apitoken失效");
  return d;
}
async function prizes(ctx, x) {
  const d = await ctx.requestJson(
    `${BASE}/geement.actjextra/api/v1/act/win/goods/simple?act_codes=ACT2510301507191%2CACT2510301505581`,
    { headers: headers(x) },
  );
  if (!d?.success && Number(d?.code) !== 200) throw new Error(d?.msg || "中奖记录查询失败");
  return d.data || [];
}
async function tasks(ctx, x) {
  const url = `${BASE}/geement.marketingplay/api/v1/task?pageNum=1&pageSize=10&task_status=2&status=1&group_id=2510301511011&is_db=1`,
    d = await ctx.requestJson(url, { headers: { ...headers(x), "content-type": "application/x-www-form-urlencoded" } }),
    out = [];
  if (Number(d?.code) !== 200) return [`任务列表失败：${d?.msg || d?.code}`];
  for (const t of d.data || []) {
    if (Number(t.complete_status) !== 0) continue;
    const action_time = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace("T", " "),
      r = await ctx.requestJson(
        `${BASE}/geement.marketingplay/api/v1/task/join?action_time=${encodeURIComponent(action_time)}&task_id=${encodeURIComponent(t.id)}`,
        { headers: { ...headers(x), "content-type": "application/x-www-form-urlencoded" } },
      );
    out.push(`${t.name}：${r?.success || String(r?.msg || "").includes("已参与") ? "完成" : r?.msg || "失败"}`);
  }
  return out.length ? out : ["任务已全部完成"];
}
async function receive(ctx, x, g) {
  if (!g?.log_id) return;
  const kind = Number(g.goods_type) === 160 ? "160goods" : "youzan";
  try {
    await ctx.requestJson(`${BASE}/geement.actjextra/api/v1/act/win/goods/${kind}/receive`, {
      method: "POST",
      headers: { ...headers(x), "content-type": "application/x-www-form-urlencoded" },
      form: { log_ids: g.log_id },
    });
  } catch {}
}
async function lottery(ctx, x) {
  if (!x.longitude || !x.latitude) return ["未配置经纬度，登录格式末尾填写 经度#纬度"];
  const loc = {
      provice_name: x.province || "",
      city_name: x.city || "",
      area_name: x.district || "",
      address: x.address || "",
      longitude: Number(x.longitude),
      dimension: Number(x.latitude),
    },
    out = [];
  for (let i = 1; i <= 8; i++) {
    let active = false;
    for (const code of SCENES) {
      const d = await ctx.requestJson(`${BASE}/geement.marketinglottery/api/v1/marketinglottery`, {
        method: "POST",
        headers: headers(x),
        json: { ...loc, code },
      });
      if (d?.success) {
        active = true;
        const p = d?.data?.prizedto;
        if (p) {
          out.push(`第${i}次 [${p.prize_level || ""}] ${p.prize_name || "中奖"}`);
          await receive(ctx, x, p.goods?.[0]);
        } else out.push(`第${i}次 未中奖`);
        break;
      }
      const m = String(d?.msg || "");
      if (/登录|token/i.test(m)) throw new Error(m);
      if (/达到最大|上限/.test(m)) return out.concat(m);
      if (!/不足|资格/.test(m)) {
        active = true;
        out.push(`第${i}次 ${m || "异常"}`);
        break;
      }
    }
    if (!active) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return out;
}
const rt = createAccountRuntime({
  title: "农夫山泉",
  shortName: "农夫",
  prefix: "dd_nfsqcks",
  defaultEnvName: "NFSQ_TOKEN",
  orderPrefix: "NFSQ",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "请输入 备注#apitoken[&unique_identity]#经度#纬度，可追加#省#市#区#详细地址，支持批量换行",
      180000,
    );
    if (input === null) return [];
    const rows = [];
    for (const raw of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = raw.split("#"),
          remark = p.shift(),
          ck = p.shift(),
          c = splitCk(ck);
        Object.assign(c, {
          longitude: p.shift() || "",
          latitude: p.shift() || "",
          province: p.shift() || "",
          city: p.shift() || "",
          district: p.shift() || "",
          address: p.join("#") || "",
        });
        if (!remark || !c.apitoken) throw new Error("格式错误");
        await verify(ctx, c);
        rows.push({
          account: `nfsq_${crypto.createHash("sha256").update(c.apitoken).digest("hex").slice(0, 16)}`,
          token: JSON.stringify(c),
          remark,
        });
      } catch (e) {
        await ctx.sender.reply(`农夫登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token);
    await verify(ctx, x);
    const list = await prizes(ctx, x),
      out = list.slice(0, 5).map((p) => `${p.win_prize_level || ""} ${p.win_prize_name || ""} ${p.scan_time || ""}`);
    return `✅ Token有效\n📍 位置：${x.province || ""}${x.city || ""}${x.district || ""}${x.address || `${x.longitude || "?"},${x.latitude || "?"}`}\n🎁 近5条中奖：\n${out.join("\n") || "暂无"}`;
  },
  async cronCheck(ctx, item) {
    const x = parse(item.token);
    await verify(ctx, x);
    const a = await tasks(ctx, x),
      b = await lottery(ctx, x),
      p = await prizes(ctx, x);
    return `每日任务：\n${a.join("\n")}\n抽奖：\n${b.join("\n") || "无可用资格"}\n中奖记录：${p.length}条`;
  },
  async handle(ctx, c) {
    if (!/(运行|一键运行)/.test(c)) return undefined;
    let list = [];
    try {
      list = JSON.parse(await ctx.users.get(await ctx.currentUserId(), "[]"));
    } catch {}
    if (!list.length) return ctx.sender.reply("未找到农夫账号");
    for (const a of list) {
      const x = parse(await ctx.tokens.get(a, ""));
      try {
        const t = await tasks(ctx, x),
          l = await lottery(ctx, x);
        await ctx.sender.reply(
          `${await ctx.remarks.get(a, a)}\n每日任务：\n${t.join("\n")}\n抽奖：\n${l.join("\n") || "无可用资格"}`,
        );
      } catch (e) {
        await ctx.sender.reply(`${await ctx.remarks.get(a, a)} 运行失败：${e?.message || e}`);
      }
    }
    return true;
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.apitoken}&${x.unique}`;
  },
  tutorial:
    "=====农夫山泉教程=====\n抓包 sxs-consumer.nfsq.com.cn 请求头 apitoken，可同时记录 unique_identity。\n登录格式：备注#apitoken&unique_identity#经度#纬度#省#市#区#详细地址。\n定时完成每日任务、双场景抽奖、自动领取奖品并查询近5条记录。\n指令：农夫登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`农夫山泉执行失败：${e?.message || e}`));

// [title: 某手极速版管理]
// [name: mouShouJiSuBanGuanLi]
// [desc: 某手极速版完整CK解析、有效性校验、金币/余额/累计收益查询与面板同步]
// [author: 8165799]
// [version: v1.6.0]
// [rule: ^某手极速版(登录|登陆|查询|管理|教程|授权|清理)?$|^登(录|陆)某手极速版$|^(查询|管理)某手极速版$|^ks(login|query|manage)$]
// [cron: 15 19 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 51]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/settings.svg]
// [origin: backup/某手极速版_v1.5_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
function cookieMap(text) {
  const o = {};
  for (const seg of String(text || "").split(";")) {
    const i = seg.indexOf("=");
    if (i > 0) o[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  return o;
}
function looks(v) {
  return /kuaishou\.api_st=|kpn=/.test(v) || (v.includes("=") && (v.match(/;/g) || []).length >= 2);
}
function parse(raw) {
  const token = String(raw || "").trim();
  let remark = "",
    cookie = "",
    salt = "";
  const first = token.indexOf("#");
  if (first > 0 && looks(token.slice(first + 1))) {
    remark = token.slice(0, first).trim();
    cookie = token.slice(first + 1).trim();
  } else if (looks(token)) cookie = token;
  else {
    const p = token
        .split("#")
        .map((x) => x.trim())
        .filter(Boolean),
      ci = p.findIndex(looks);
    if (ci >= 0) {
      cookie = p[ci];
      remark = ci > 0 ? p[0] : "";
      salt = p[ci + 1] || "";
    } else {
      cookie = p[0] || "";
      salt = p[1] || "";
      remark = p[2] || "";
    }
  }
  const map = cookieMap(cookie),
    uid = map.ud || map.userId || map.did || crypto.createHash("md5").update(token).digest("hex").slice(0, 8);
  if (!cookie.includes("kuaishou.api_st=")) throw new Error("CK缺少 kuaishou.api_st");
  return { token, cookie, salt, remark, map, uid, final: salt ? `${cookie}#${salt}` : cookie };
}
async function overview(ctx, a) {
  const r = await ctx.requestJson("https://nebula.kuaishou.com/rest/n/nebula/account/overview", {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 10; MI 8 Build/QKQ1.190828.002; wv) AppleWebKit/537.36 Version/4.0 Chrome/83.0.4103.101 Mobile Safari/537.36 Yoda/3.2.16-rc4 ksNebula/13.7.20.10468",
      accept: "*/*",
      "x-requested-with": "com.kuaishou.nebula",
      cookie: a.cookie,
    },
  });
  if (Number(r?.result) !== 1) throw new Error(r?.error_msg || r?.message || "账号详情获取失败");
  const d = r.data || {};
  return {
    nickname: d.nickname || d.userData?.nickname || a.remark || a.uid,
    coin: Number(d.coinBalance) || 0,
    cash: String(d.cashBalance || "0"),
    totalCash: Number(d.accumulativeAmount || 0).toFixed(2),
    coinRecords: d.coinAccountPage?.data || [],
  };
}
const rt = createAccountRuntime({
  title: "某手极速版",
  shortName: "某手极速版",
  prefix: "ks_nebula",
  defaultEnvName: "ksjsb",
  orderPrefix: "KSN",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请输入 备注#完整CK，一行一个；也兼容直接提交CK或CK#salt", 120000);
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const a = parse(line),
        d = await overview(ctx, a);
      out.push({
        account: a.uid,
        token: a.final,
        remark: a.remark || d.nickname,
        extra: { aliases: [...new Set([a.map.did, a.map.oDid, a.map.egid].filter(Boolean))] },
      });
    }
    return out;
  },
  async query(ctx, item) {
    const a = parse(item.token),
      d = await overview(ctx, a);
    return `👤 昵称：${d.nickname}\n🆔 UID：${a.uid.length > 6 ? `${a.uid.slice(0, 3)}****${a.uid.slice(-3)}` : a.uid}\n💰 金币：${d.coin}（${(d.coin / 10000).toFixed(2)}元）\n💵 余额：${d.cash}元\n💎 累计收益：${d.totalCash}元`;
  },
  async cronCheck(ctx, item) {
    const d = await overview(ctx, parse(item.token));
    return `CK有效，金币${d.coin}，余额${d.cash}元，累计${d.totalCash}元`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial:
    "发送某手极速版登录，按“备注#完整CK”提交；CK必须包含 kuaishou.api_st。查询返回金币、余额和累计收益，授权后同步青龙/呆呆面板。",
});
rt.main().catch((e) => s.reply(`某手极速版执行失败：${e?.message || e}`));

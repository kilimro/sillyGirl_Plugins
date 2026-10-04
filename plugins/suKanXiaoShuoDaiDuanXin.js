// [title: 速看小说带短信]
// [name: suKanXiaoShuoDaiDuanXin]
// [desc: 速看小说短信登录、完整福利链接生成、凭证校验及金币查询]
// [author: 8165799,rujingxianghai]
// [version: v3.6.0]
// [rule: ^速看(登录|登陆|查询|管理|教程|授权|清理)$|^登(录|陆)速看$|^(查询|管理)速看$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/速看_v3.6_By.8165799.py;backup/速看免费小说_v1.0.3_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js","./sukanCore.js"]]

const { sender: s } = require("sillygirl");
const { randomUUID } = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const core = require("./sukanCore.js"),
  DJ = "https://dj.palmestore.com",
  WELFARE = "https://welfare-user.palmestore.com";
function uid() {
  return randomUUID().replace(/-/g, "");
}
function createDevice() {
  const d = {
    ...core.SMS,
    zyeid: randomUUID(),
    imei: "____" + uid().slice(0, 16),
    p7: "__" + uid().slice(0, 16),
    p28: uid().toUpperCase() + uid().slice(0, 32),
    guest: `j${Math.floor(Date.now() / 1000)}${Math.floor(100 + Math.random() * 900)}`,
    p1: "",
    usr: "",
    ku: "",
    kt: "",
    p35: "",
  };
  d.usr = d.ku = d.guest;
  return d;
}
function base(d) {
  const u = d.ku || d.usr || d.guest;
  return {
    zyeid: d.zyeid,
    usr: u,
    rgt: d.rgt,
    p1: d.p1,
    ku: u,
    pc: d.pc,
    p2: d.p2,
    p3: d.p3,
    p4: d.p4,
    p5: d.p5,
    p7: d.p7,
    p9: d.p9,
    p12: "",
    p16: d.p16,
    p21: d.p21,
    p22: d.p22,
    p25: d.p25,
    p26: d.p26,
    p28: d.p28,
    p29: d.p29,
    p30: "",
    p31: d.p7,
    p33: d.p33,
    p34: d.p34,
    p36: d.p36,
    firm: d.firm,
    d1: d.d1,
  };
}
function qs(o) {
  return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v ?? "")])).toString();
}
function signContent(p) {
  return Object.keys(p)
    .sort()
    .filter((k) => p[k] !== "")
    .map((k) => `${k}=${p[k]}`)
    .join("&");
}
function headers(d) {
  return {
    "user-agent": `Dalvik/2.1.0 (Linux; U; Android ${d.p22 || 14}; ${d.device} Build/BP2A.250605.015)`,
    accept: "application/json",
    "accept-encoding": "gzip",
    "content-type": "application/x-www-form-urlencoded",
  };
}
async function sms(ctx, phone, d) {
  const timestamp = String(Date.now()),
    encrypted = core.rsaEncrypt(phone),
    sp = {
      channelId: d.channelId,
      device: d.device,
      flag: "1",
      imei: d.imei,
      phone: encrypted,
      sendType: "0",
      times: "1",
      timestamp,
      versionId: d.versionId,
    },
    r = await ctx.requestJson(`${DJ}/dj_user/out/sms/sendSms/V2?${qs(base(d))}`, {
      method: "POST",
      form: { ...sp, sign: core.rsaSign(signContent(sp)) },
      headers: headers(d),
    });
  if (Number(r?.code) !== 0 && r?.msg !== "success") throw new Error(r?.msg || "验证码发送失败");
}
async function login(ctx, phone, code, d) {
  const timestamp = String(Date.now()),
    encrypted = core.rsaEncrypt(phone),
    desKey = String(Math.floor(10000000 + Math.random() * 90000000)),
    encryptedKey = core.rsaEncrypt(desKey),
    pInfo = JSON.stringify({
      DesKey: encryptedKey,
      Data: core.desEncrypt(JSON.stringify({ phone, pCode: code }), desKey),
    }),
    sp = {
      channelId: d.channelId,
      device: d.device,
      imei: d.imei,
      phone: encrypted,
      timestamp,
      versionId: d.versionId,
    },
    q = { ...base(d), p35: encryptedKey },
    r = await ctx.requestJson(`${DJ}/dj_user/out/login/loginByPhoneV3?${qs(q)}`, {
      method: "POST",
      form: {
        smboxid: encryptedKey,
        versionId: d.versionId,
        device: d.device,
        userName: q.usr,
        imei: d.imei,
        sign: core.rsaSign(signContent(sp)),
        timestamp,
        pInfo,
        phone: encrypted,
        utdId: d.p1,
        loginSource: "我的_马上登录",
        channelId: d.channelId,
      },
      headers: headers(d),
    });
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "登录失败");
  const b = r.body || {};
  d.kt = b.token || b.kt || "";
  d.p1 = b.utdId || b.signUser || b.p1 || "";
  d.usr = b.userName || b.usr || d.usr;
  d.ku = b.signUser || b.ku || d.usr;
  d.p35 = encryptedKey;
  if (!d.kt) throw new Error("登录响应缺少token");
  return d;
}
function welfareUrl(d) {
  const t = {
      ...core.TASK,
      p16: d.p16 || d.device || core.TASK.p16,
      p22: d.p22 || core.TASK.p22,
      p34: d.firm || d.p34 || core.TASK.p34,
      firm: d.firm || d.p34 || core.TASK.firm,
    },
    p = {
      zyeid: d.zyeid,
      rgt: t.rgt,
      p1: d.p1,
      kt: d.kt,
      source: "welfare",
      showContentInStatusBar: "1",
      ecpmMix: "0.0",
      ecpmVideo: "0.0",
      mcTacid: "",
      pc: t.pc,
      p2: t.p2,
      p3: t.p3,
      p4: t.p4,
      p5: t.p5,
      p7: d.p7,
      p9: t.p9,
      p12: "",
      p16: t.p16,
      p21: t.p21,
      p22: t.p22,
      p25: t.p25,
      p26: t.p26,
      p28: d.p28,
      p29: t.p29,
      p30: "",
      p31: d.p7,
      p33: t.p33,
      p34: t.p34,
      p36: t.p36,
      firm: t.firm,
      d1: t.d1,
      pca: "channel-visit",
      p35: d.p35,
      usr: d.ku,
      ku: d.ku,
    };
  return `${WELFARE}/sukanread/welfare-package/sudu/welfare.html?${qs(p)}`;
}
function parse(raw) {
  const text = String(raw || "").trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    const j = JSON.parse(text);
    if (j.url) return parse(j.url);
    if (j.credential) return parse(j.credential);
    const b = j.body || j;
    if (b.token || b.kt)
      return {
        url: `${WELFARE}/sukanread/welfare-package/sudu/welfare.html?${qs({ kt: b.token || b.kt, zyeid: b.zyeid || b.zyeId, source: "welfare" })}`,
        params: { kt: b.token || b.kt, zyeid: b.zyeid || b.zyeId, source: "welfare" },
      };
  }
  const query = text.includes("?") ? text.split("?", 2)[1] : text,
    p = Object.fromEntries(new URLSearchParams(query));
  return {
    url: text.startsWith("http") ? text : `${WELFARE}/sukanread/welfare-package/sudu/welfare.html?${query}`,
    params: p,
  };
}
async function userInfo(ctx, raw) {
  const x = parse(raw);
  if (!(x.params.kt || x.params.token) || !(x.params.zyeid || x.params.zyeId))
    throw new Error("凭证缺少kt/token或zyeid");
  x.params.source ||= "welfare";
  const r = await ctx.requestJson(`${WELFARE}/api/user/info?${qs(x.params)}`, {
    headers: {
      origin: WELFARE,
      referer: `${WELFARE}/sukanread/welfare-package/sudu/welfare.html`,
      "x-requested-with": "com.chaozh.xincao.only.sk",
      "user-agent": "Mozilla/5.0 (Linux; Android 13; wv) zyApp/SuKanRead zyVersion/8.0.2 zyChannel/801004",
    },
  });
  if (Number(r?.code) !== 0) throw new Error(r?.msg || "速看凭证失效");
  const b = r.body || {};
  return {
    url: x.url,
    zyeid: x.params.zyeid || x.params.zyeId,
    coin: b.total_coin || 0,
    cash: b.total_cash || b.total_money || 0,
    phone: String(b.phone || b.mobile || ""),
  };
}
const rt = createAccountRuntime({
  title: "速看小说",
  shortName: "速看",
  prefix: "dd_sk",
  defaultEnvName: "sukan",
  orderPrefix: "SK",
  requireAuthForQuery: false,
  async login(ctx) {
    const mode = await ctx.prompt(ctx.sender, "[1] 短信登录\n[2] 提交完整福利链接/QueryString", 120000);
    if (mode === null) return [];
    if (mode === "2") {
      const raw = await ctx.prompt(ctx.sender, "请提交包含 kt 和 zyeid 的完整福利链接，多账号换行", 120000);
      if (raw === null) return [];
      const out = [];
      for (const line of raw
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean)) {
        const q = await userInfo(ctx, line),
          account = String(q.phone || q.zyeid);
        out.push({ account, token: q.url, remark: q.phone || `速看-${q.zyeid.slice(-6)}` });
      }
      return out;
    }
    const phones = await ctx.prompt(ctx.sender, "请输入11位手机号，多账号换行", 120000);
    if (phones === null) return [];
    const out = [];
    for (const phone of phones
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)) {
      if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error(`${phone}手机号错误`);
      const d = createDevice();
      await sms(ctx, phone, d);
      const code = await ctx.prompt(ctx.sender, `${phone.slice(0, 3)}****${phone.slice(-4)} 验证码已发送`, 120000);
      if (!/^\d{4,8}$/.test(String(code || ""))) throw new Error("验证码格式错误");
      await login(ctx, phone, code, d);
      const url = welfareUrl(d);
      await userInfo(ctx, url);
      out.push({ account: phone, token: url, remark: phone.slice(0, 3) + "****" + phone.slice(-4) });
    }
    return out;
  },
  async query(ctx, item) {
    const q = await userInfo(ctx, item.token);
    return `🪙 当前金币：${Number(q.coin).toLocaleString()}\n💵 当前余额：${q.cash}\n🆔 zyeid：${q.zyeid}`;
  },
  async cronCheck(ctx, item) {
    const q = await userInfo(ctx, item.token);
    return `凭证有效，金币${q.coin}`;
  },
  envValue(_c, item) {
    return item.token;
  },
  tutorial:
    "发送“速看登录”，可选短信登录自动生成完整福利链接，或直接提交抓包所得含 kt、zyeid 及设备参数的链接。速看查询调用 /api/user/info 校验并显示金币。",
});
rt.main().catch((e) => s.reply(`速看执行失败：${e?.message || e}`));

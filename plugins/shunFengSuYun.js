// [title: 顺丰速运]
// [name: shunFengSuYun]
// [desc: 顺丰CK校验、积分/今日收入/临期积分查询及APP快递列表查询]
// [author: sky2022]
// [version: v9.8.0]
// [rule: ^顺丰(登录|登陆|查询|管理|教程|Token刷新|刷新|快递查询|同步|授权|清理)$|^登(录|陆)顺丰$|^(查询|管理)顺丰$]
// [cron: 35 18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/顺丰速运_v9.7_By.sky2022.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const MIMP = "https://mcs-mimp-web.sf-express.com/mcs-mimp",
  APP = "https://ccsp-egmas.sf-express.com";
function parse(raw) {
  const text = String(raw || "").trim();
  try {
    const j = JSON.parse(text);
    if (j && j.ck) return { ...j, mobile: String(j.mobile || extract(j.ck, "_login_mobile_") || "") };
  } catch {}
  if (!/sessionId=/.test(text)) throw new Error("请输入包含 sessionId 和 _login_mobile_ 的顺丰CK，或完整JSON凭证");
  return {
    ck: text,
    mobile: extract(text, "_login_mobile_") || "",
    userId: extract(text, "_login_user_id_") || "",
    memNo: "",
    deviceId: "",
    appToken: "",
  };
}
function extract(v, k) {
  return String(v).match(new RegExp(`${k}=([^;]+)`))?.[1] || "";
}
function session(v) {
  const id = extract(v, "sessionId");
  if (!id) throw new Error("CK缺少sessionId");
  return id;
}
async function post(ctx, path, sid, body) {
  const r = await ctx.requestJson(`${MIMP}${path}`, {
    method: "POST",
    headers: { cookie: `sessionId=${sid}`, "content-type": "application/json", syscode: "MCS-MIMP-CORE" },
    json: body,
  });
  if (!r?.success) throw new Error(r?.errorMessage || r?.message || "顺丰接口返回失败");
  return r;
}
async function info(ctx, cred) {
  const sid = session(cred.ck),
    user = await post(ctx, "/commonPost/~memberIntegral~userInfoService~queryUserInfo", sid, {
      sysCode: "ESG-CEMP-CORE",
      optionalColumns: ["usablePoint", "cycleSub", "leavePoint"],
      token: "zeTLTYeG0bLetfRk",
    }),
    o = user.obj || {},
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  let earned = 0,
    page = 1,
    total = o.usablePoint || 0;
  while (page <= 20) {
    const r = await post(ctx, "/commonPost/~memberIntegral~memberPoint~queryMemberPointDetail", sid, {
        type: "ALL",
        pageNo: page,
        pageSize: 20,
      }),
      list = r?.obj?.data || [];
    total = r?.obj?.usablePoint ?? total;
    if (!list.length) break;
    let hasToday = false;
    for (const x of list) {
      if (String(x.createTm).slice(0, 10) === today) {
        hasToday = true;
        if (x.opCode === "ADD") earned += Number(x.pointVal) || 0;
      }
    }
    if (!hasToday || list.length < 20) break;
    page++;
  }
  return {
    total,
    earned,
    cycleAdd: o.cycleAdd || 0,
    expiring: Math.max(0, (o.usablePoint || 0) - (o.cycleAdd || 0)),
    clearDate: o.pointClearCycle || "",
  };
}
function md5(v) {
  return crypto.createHash("md5").update(v).digest("hex");
}
function signedHeaders(body, cred) {
  const clientVersion = cred.clientVersion || "9.77.0",
    deviceId = cred.deviceId,
    languageCode = "sc",
    regionCode = "CN",
    jsbundle = "705088894ad6ef475bdf4875c9d533b8",
    ts = String(Date.now()),
    bodyMd5 = md5(body + "&080R3MAC57J2{A19!$3:WO{I<1N$31BI"),
    secret = "2NBF+BE4{@P:@X${Q9BAE>{PAK!D:N*^",
    mix = deviceId + ts + clientVersion + secret + regionCode + languageCode + bodyMd5 + jsbundle,
    sytToken = md5(md5(mix + "&" + secret) + "&0HQ%H91K&AA{DH$*XV>XR)VKL:QFE{&%");
  return {
    "user-agent": "okhttp/4.9.1",
    "content-type": "application/json",
    jsbundle,
    srcDeviceGuid: cred.srcDeviceGuid || crypto.randomBytes(28).toString("base64url").slice(0, 38),
    clientVersion,
    languageCode,
    systemVersion: "13",
    deviceId,
    regionCode,
    carrier: "unknown",
    screenSize: "1080x2400",
    sytToken,
    timeInterval: ts,
    model: "MEIZU 20",
    mediaCode: "AndroidML",
    token: cred.appToken,
    memberId: cred.memNo,
    cookie: cred.ck,
  };
}
async function expressList(ctx, cred, type = 0) {
  if (!cred.appToken || !cred.memNo || !cred.deviceId)
    throw new Error("快递查询需要JSON凭证中的 appToken、memNo、deviceId");
  const body = JSON.stringify({
      pageRows: 10,
      orderType: "1",
      payTypeList: [],
      accountMobile: cred.mobile,
      pageNo: 1,
      dataType: type,
      orderStatusList: [],
      mobile: cred.mobile,
      memberId: cred.memNo,
      timeRange: "",
      queryLastRouter: true,
      supportWaybillStatusNew: true,
      userInfos: [],
      selectedFamily: false,
    }),
    r = await ctx.requestJson(`${APP}/cx-app-query/query/app/waybill/queryMultAccountBillListComplex`, {
      method: "POST",
      headers: signedHeaders(body, cred),
      body,
    });
  if (r?.success === false) throw new Error(r.errorMessage || "快递查询失败");
  return r?.obj?.data || r?.obj?.list || r?.data || [];
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    a = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!a.length) throw new Error("未绑定顺丰账号");
  return { account: a[0], token: String(await ctx.tokens.get(a[0], "")) };
}
const rt = createAccountRuntime({
  title: "顺丰速运",
  shortName: "顺丰",
  prefix: "dd_sf",
  defaultEnvName: "sfsyUrl",
  orderPrefix: "SF",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(
      ctx.sender,
      "请提交顺丰CK（含sessionId与_login_mobile_）；高级快递查询可提交含ck/appToken/memNo/deviceId的JSON，多账号换行",
      120000,
    );
    if (raw === null) return [];
    const out = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const c = parse(line),
        i = await info(ctx, c);
      out.push({ account: c.mobile || c.userId || session(c.ck), token: line, remark: c.mobile || `积分${i.total}` });
    }
    return out;
  },
  async query(ctx, item) {
    const c = parse(item.token),
      i = await info(ctx, c);
    return `📱 手机：${c.mobile ? c.mobile.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2") : "未知"}\n💰 当前积分：${i.total}\n📈 今日新增：${i.earned}\n⏳ 临期积分：${i.expiring}${i.clearDate ? `\n📅 清零周期：${i.clearDate}` : ""}`;
  },
  async handle(ctx, c) {
    if (!/快递查询/.test(c)) return;
    const item = await owned(ctx),
      cred = parse(item.token),
      [sent, received] = await Promise.all([expressList(ctx, cred, 0), expressList(ctx, cred, 1)]);
    const lines = [
      ...sent.map((x) => `寄件 ${x.waybillNo || x.mailNo || ""} ${x.statusDesc || x.statusName || ""}`),
      ...received.map((x) => `收件 ${x.waybillNo || x.mailNo || ""} ${x.statusDesc || x.statusName || ""}`),
    ];
    return ctx.sender.reply(lines.length ? lines.join("\n") : "近期没有快递记录");
  },
  async cronCheck(ctx, item) {
    const i = await info(ctx, parse(item.token));
    return `账号有效，积分${i.total}，今日新增${i.earned}，临期${i.expiring}`;
  },
  envValue(_c, i) {
    return i.token;
  },
  tutorial:
    "抓取顺丰小程序CK（sessionId、_login_mobile_）后发送顺丰登录。顺丰查询显示积分；APP登录JSON带 appToken/memNo/deviceId 时可用顺丰快递查询。",
});
rt.main().catch((e) => s.reply(`顺丰执行失败：${e?.message || e}`));

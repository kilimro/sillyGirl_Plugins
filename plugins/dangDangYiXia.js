// [title: 铛铛一下]
// [name: dangDangYiXia]
// [desc: 铛铛一下、快宝和支付宝端JWT批量登录，实时余额/累计提现查询，账号管理、授权、青龙同步和过期清理。]
// [author: mrconli / 8165799]
// [version: v2.0.1]
// [rule: raw ^(铛铛|铛铛一下)(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 5 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m110_铛铛一下_v1.1.0_By.mrconli.py;backup/铛铛一下_v2.0_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const TYPES = {
  wxe378d2d7636c180e: { code: "ddyx", name: "铛铛一下" },
  wxbe2f25800165b6f8: { code: "kb", name: "快宝" },
  2018120362447108: { code: "zfb", name: "支付宝" },
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows";

function decodeJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("JWT必须为3段");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (_) {
    throw new Error("JWT载荷解析失败");
  }
  const identityKeys = [
    "mobile",
    "user_id",
    "userId",
    "userid",
    "uid",
    "member_id",
    "memberId",
    "customer_id",
    "customerId",
    "account_id",
    "accountId",
    "openId",
    "openid",
    "unionId",
    "unionid",
    "sub",
    "id",
  ];
  const identity = identityKeys
    .map((key) => payload?.[key])
    .find((value) => value !== undefined && value !== null && String(value).trim().length >= 4);
  const appId = String(payload?.appId || "");
  if (!identity) throw new Error("JWT未包含可用账号标识");
  if (!TYPES[appId]) throw new Error(`未知小程序appId：${appId || "空"}`);
  return { identity: String(identity).trim(), appId, type: TYPES[appId], payload };
}

function headersFor(token, appId) {
  if (appId === "2018120362447108")
    return {
      "user-agent": UA,
      "accept-encoding": "gzip",
      "content-type": "application/json",
      "accept-charset": "UTF-8",
      alipayminimark:
        "i/PofbtYH5bQuPIsFYS0NVZY5LSVWxzxcJbDfdt1hoZ8G3W96cu6k6zSq3lDUMwZ2ZDawThWif7hkNKazfkDxUu5FsxSO//E4eQk7nAVagk=",
      referer:
        "https://2018120362447108.hybrid.alipay-eco.com/2018120362447108/0.2.2512151439.1/index.html#pageMine/pages/walletWithdraw/walletWithdraw?__appxPageId=2&channelId=147",
      token,
      "x-release-type": "ONLINE",
    };
  return {
    "content-type": "application/json",
    accept: "*/*",
    referer: `https://servicewechat.com/${appId}/page-frame.html`,
    "user-agent": UA,
    token,
  };
}

async function getInfo(ctx, token) {
  const identity = decodeJwt(token);
  const data = await ctx.requestJson("https://vues.dd1x.cn/api/h/get_account_detailed", {
    headers: headersFor(token, identity.appId),
  });
  if (Number(data?.code) !== 0 || !data?.data || typeof data.data !== "object")
    throw new Error(data?.msg || data?.message || "token认证失败");
  return {
    ...identity,
    redEnvelope: data.data.red_envelope ?? 0,
    total: data.data.total ?? data.data.red_envelope ?? 0,
    recoveryAmount: data.data.recovery_amount ?? 0,
    accumulated: data.data.accumulated ?? 0,
    unaudited: data.data.unauditedAmount ?? 0,
  };
}

const runtime = createAccountRuntime({
  title: "铛铛一下",
  shortName: "铛铛",
  prefix: "mrconli.ddyx",
  defaultEnvName: "m_ddyx",
  orderPrefix: "DDYX",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "请发送抓包得到的JWT token\n支持批量，一行一个；可用 token#备注",
      120000,
    );
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#"),
        token = (cut >= 0 ? line.slice(0, cut) : line)
          .replace(/^Bearer\s+/i, "")
          .replace(/^["']|["']$/g, "")
          .trim(),
        customRemark = cut >= 0 ? line.slice(cut + 1).trim() : "";
      try {
        const info = await getInfo(ctx, token),
          account = `${info.identity}_${info.type.code}`;
        const fallback =
          info.identity.length === 11
            ? info.identity
            : `${info.type.name}_${crypto.createHash("md5").update(token).digest("hex").slice(0, 8)}`;
        rows.push({ account, token, remark: customRemark || `${fallback}[${info.type.name}]` });
      } catch (error) {
        await ctx.sender.reply(`JWT登录失败：${error?.message || error}`);
      }
    }
    return rows;
  },
  async query(ctx, item) {
    const info = await getInfo(ctx, item.token);
    return `🚀 小程序：${info.type.name}\n💰 当前余额：${info.total}元\n🧧 红包余额：${info.redEnvelope}元\n♻️ 回收金额：${info.recoveryAmount}元\n💸 累计提现：${info.accumulated}元\n⏳ 待审核：${info.unaudited}元`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====铛铛一下教程=====\n入口：铛铛一下旧衣服回收小程序\n登录提交抓包JWT token，支持铛铛一下、快宝和支付宝端，支持 token#备注\n指令：铛铛登录、查询、管理、授权、清理、教程\n查询当前余额、红包、回收金额、累计提现和待审核金额\n==================",
});

runtime.main().catch(async (error) => s.reply(`铛铛一下执行失败：${error?.message || error}`));

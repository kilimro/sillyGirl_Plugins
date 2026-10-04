// [title: m108_潇洒桐庐]
// [name: m108XiaoSaTongLu]
// [desc: 潇洒桐庐手机号密码批量登录、积分与最近抽奖记录查询、账号管理、授权、青龙同步和过期清理。]
// [author: mrconli]
// [version: v1.2.1]
// [rule: raw ^潇洒(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 39 8,18 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m108_潇洒桐庐_v1.2.0_By.mrconli.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXizPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXFc+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlTHMlluw4ZYmnOwg+thwIDAQAB
-----END PUBLIC KEY-----`;
const SESSION_SEED = "6565886da95d5a47f651317f";
const SIGN_SECRET = "FR*r!isE5W";
const TENANT = "59";
const APP_UA = "1.1.9;00000000-67f7-45bf-ffff-ffffa7397b83;Xiaomi MI 8 Lite;Android;10;Release";

function rsaEncrypt(value) {
  return crypto
    .publicEncrypt({ key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(String(value)))
    .toString("base64");
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function requestId() {
  return Math.floor(Math.random() * 2147483648).toString(16);
}

function signedHeaders(path, sessionId) {
  const request = requestId(),
    timestamp = Date.now();
  return {
    "x-session-id": sessionId,
    "x-request-id": request,
    "x-timestamp": String(timestamp),
    "x-signature": sha256(`${path}&&${sessionId}&&${request}&&${timestamp}&&${SIGN_SECRET}&&${TENANT}`),
    "x-tenant-id": TENANT,
    "user-agent": APP_UA,
    "cache-control": "no-cache",
    host: "vapp.tmuyun.com",
    connection: "Keep-Alive",
  };
}

async function loginXstl(ctx, mobile, password) {
  const passport = await ctx.requestJson("https://passport.tmuyun.com/web/oauth/credential_auth", {
    method: "POST",
    headers: {
      host: "passport.tmuyun.com",
      "content-type": "application/x-www-form-urlencoded",
      "accept-encoding": "gzip, deflate, br",
    },
    form: { client_id: "10017", password: rsaEncrypt(password), phone_number: mobile },
  });
  const code = passport?.data?.authorization_code?.code;
  if (Number(passport?.code) !== 0 || !code) throw new Error(passport?.message || "潇洒桐庐账号鉴权失败");
  const path = "/api/zbtxz/login";
  const data = await ctx.requestJson(`https://vapp.tmuyun.com${path}`, {
    method: "POST",
    headers: signedHeaders(path, SESSION_SEED),
    form: { check_token: "", code, token: "", type: "-1", union_id: "" },
  });
  if (Number(data?.code) !== 0 || !data?.data?.account?.id || !data?.data?.session?.id)
    throw new Error(data?.message || "潇洒桐庐会话登录失败");
  return {
    accountId: String(data.data.account.id),
    sessionId: data.data.session.id,
    nickname: data.data.account.nick_name || "未设置",
  };
}

async function getAccountDetail(ctx, accountId, sessionId) {
  const path = "/api/user_mumber/account_detail";
  const data = await ctx.requestJson(`https://vapp.tmuyun.com${path}?osTypeCode=2`, {
    headers: signedHeaders(path, sessionId),
  });
  if (Number(data?.code) !== 0) throw new Error(data?.message || "获取积分失败");
  const point = data?.data?.rst?.total_integral ?? 0;
  let records = [],
    lotteryError = "";
  try {
    const url = new URL("https://wxapi.hoolo.tv/event/dtqp/index.php");
    url.searchParams.set("s", "home/ChoujiangNew/getUserCj/");
    url.searchParams.set("openid", accountId);
    url.searchParams.set("type_id", "122");
    const response = await ctx.request(url, {
      headers: {
        host: "wxapi.hoolo.tv",
        accept: "application/json, text/javascript, */*; q=0.01",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 10; MI 8 Lite Build/QKQ1.190910.002; wv) AppleWebKit/537.36 Version/4.0 Chrome/81.0.4044.138 Mobile Safari/537.36;xsb_xiaosatonglu;xsb_xiaosatonglu;1.0.60;native_app;6.5.1",
        origin: "https://tp.hoolo.tv",
        "x-requested-with": "com.chinamcloud.wangjie.b87d8fb20e29a0328c6e21045e8b500e",
        referer: "https://tp.hoolo.tv/h5/tlread/index.html",
      },
    });
    const raw = response.text.trim(),
      json = raw.includes("(") && raw.endsWith(")") ? raw.slice(raw.indexOf("(") + 1, -1) : raw;
    records = (JSON.parse(json)?.msg || []).slice(0, 5);
  } catch (error) {
    lotteryError = `获取失败：${error?.message || error}`;
  }
  return {
    point,
    lottery: records.length
      ? records.map((item) => `${item.create_time || ""}[${item.prize_name || "谢谢参与"}]`).join("\n")
      : lotteryError || "暂无记录",
  };
}

const runtime = createAccountRuntime({
  title: "潇洒桐庐",
  shortName: "潇洒",
  prefix: "mrconli.xstl",
  defaultEnvName: "xiaosa",
  orderPrefix: "XSTL",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入账号#密码\n支持批量，每行一个", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#");
      if (cut <= 0 || cut === line.length - 1) {
        await ctx.sender.reply(`${line} 格式错误`);
        continue;
      }
      const mobile = line.slice(0, cut).trim(),
        password = line.slice(cut + 1);
      try {
        const info = await loginXstl(ctx, mobile, password);
        rows.push({ account: mobile, token: `${mobile}#${password}`, remark: info.nickname || mobile });
      } catch (error) {
        await ctx.sender.reply(`${mobile} 登录认证失败：${error?.message || error}`);
      }
    }
    return rows;
  },
  async query(ctx, item) {
    const cut = item.token.indexOf("#");
    if (cut <= 0) throw new Error("保存的账号密码格式错误");
    const login = await loginXstl(ctx, item.token.slice(0, cut), item.token.slice(cut + 1));
    const detail = await getAccountDetail(ctx, login.accountId, login.sessionId);
    return `👤 昵称：${login.nickname}\n💎 积分：${detail.point}分\n🎁 最近5次阅读抽奖：\n${detail.lottery}`;
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====潇洒桐庐教程=====\n入口：应用商店下载『潇洒桐庐』APP\n登录格式：手机号#密码（支持多行）\n指令：潇洒登录、查询、管理、授权、清理、教程\n查询积分及最近5次阅读抽奖记录\n==================",
});

runtime.main().catch(async (error) => s.reply(`潇洒桐庐执行失败：${error?.message || error}`));

// [title: 芳华未来]
// [name: fangHuaWeiLai]
// [desc: 芳华未来手机号密码批量登录、积分查询、账号管理、付费或积分授权、青龙同步和到期检测。]
// [author: 8165799]
// [version: v1.1.1]
// [rule: raw ^(芳华未来|芳华)(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 12 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/芳华未来_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");

const API = "https://api.cdwjyyh.com";
const UA =
  "Mozilla/5.0 (Linux; Android 16; 2509FPN0BC Build/BP2A.250605.031.A3; wv) AppleWebKit/537.36 Version/4.0 Chrome/140.0.7339.207 Mobile Safari/537.36 (Immersed/48.0) Html5Plus/1.0";
function mobile(value) {
  return /^1[3-9]\d{9}$/.test(String(value));
}
function makeJpush(phone) {
  return `1a0018970ae5${crypto.createHash("md5").update(`${phone}:${Date.now()}:${crypto.randomUUID()}`).digest("hex").slice(0, 16)}`;
}

function parseCredential(raw) {
  const parts = String(raw)
    .split("#")
    .map((item) => item.trim())
    .filter(Boolean);
  let remark = "",
    phone,
    password,
    jpush;
  if ((parts.length === 2 || parts.length === 3) && mobile(parts[0])) [phone, password, jpush] = parts;
  else if ((parts.length === 3 || parts.length === 4) && mobile(parts[1])) [remark, phone, password, jpush] = parts;
  else throw new Error("格式应为 手机号#密码[#jpushId] 或 备注#手机号#密码[#jpushId]");
  jpush = jpush && jpush.toLowerCase() !== "auto" ? jpush : makeJpush(phone);
  return { remark, phone, password, jpush, credential: `${phone}#${password}#${jpush}` };
}

async function loginApi(ctx, item) {
  const data = await ctx.requestJson(`${API}/app/app/login`, {
    method: "POST",
    headers: { "content-type": "application/json;charset=UTF-8", "user-agent": UA },
    json: {
      phone: item.phone,
      password: item.password,
      jpushId: item.jpush,
      loginType: 1,
      source: "yyb",
    },
  });
  if (Number(data?.code) !== 200 || !data?.token || !data?.user?.userId)
    throw new Error(data?.msg || data?.message || "登录失败");
  return {
    token: String(data.token),
    userId: String(data.user.userId),
    nickname: data.user.name || data.user.nickName || "",
    score: data.user.integral ?? 0,
  };
}

async function getProfile(ctx, raw) {
  const item = parseCredential(raw),
    login = await loginApi(ctx, item);
  const data = await ctx.requestJson(`${API}/app/user/getUserInfo`, {
    headers: { "content-type": "application/json;charset=UTF-8", "user-agent": UA, apptoken: login.token },
  });
  if (Number(data?.code) !== 200) throw new Error(data?.msg || data?.message || "查询积分失败");
  const user = data.user || {};
  return {
    ...item,
    token: login.token,
    userId: String(user.userId || login.userId),
    nickname: user.name || login.nickname || "",
    score: user.integral ?? login.score ?? 0,
  };
}

const runtime = createAccountRuntime({
  title: "芳华未来",
  shortName: "芳华",
  prefix: "fang_hua_wei_lai",
  defaultEnvName: "fhb",
  orderPrefix: "FHWL",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "请输入 手机号#密码 或 备注#手机号#密码\n可追加#jpushId，支持批量每行一个",
      120000,
    );
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        const info = await getProfile(ctx, line);
        rows.push({
          account: info.phone,
          token: info.credential,
          remark: info.remark || info.nickname || info.phone,
          extra: { app_token: info.token },
        });
      } catch (error) {
        await ctx.sender.reply(`芳华未来登录失败：${error?.message || error}`);
      }
    }
    return rows;
  },
  async query(ctx, item) {
    const info = await getProfile(ctx, item.token);
    return `📱 手机号：${info.phone}\n👤 昵称：${info.nickname || "未设置"}\n🪙 当前积分：${info.score}`;
  },
  async cronCheck(ctx, item) {
    try {
      await getProfile(ctx, item.token);
      return "";
    } catch (_) {
      return "账号凭证检测异常，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====芳华未来教程=====\n登录格式：手机号#密码，或备注#手机号#密码；jpushId可省略自动生成\n支持批量登录、积分查询、账号管理、授权、青龙同步和过期检测\n指令：芳华登录、查询、管理、授权、清理、教程\n==================",
});

runtime.main().catch(async (error) => s.reply(`芳华未来执行失败：${error?.message || error}`));

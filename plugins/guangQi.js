// [title: 广汽]
// [name: guangQi]
// [desc: 广汽手机号、AT、RT批量绑定，G豆查询、Token刷新、账号管理、授权、青龙同步和到期检测。]
// [author: 8165799]
// [version: v1.1.1]
// [rule: raw ^广汽(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 16 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/广汽_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const BASE = "https://next.gacmotor.com",
  APP_VERSION = "6.0.42",
  APP_ID = "8c4131ff-e326-43ea-b333-decb23936673",
  APP_KEY = "46856407-b211-4a10-9cb2-5a9b94361614",
  API_KEY = "a361588rt20dpol";
function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}
function parse(raw) {
  const parts = String(raw)
    .split("#")
    .map((v) => v.trim())
    .filter(Boolean);
  if (parts.length < 3 || !/^1[3-9]\d{9}$/.test(parts[0])) throw new Error("格式应为 手机号#AT#RT");
  return { mobile: parts[0], at: parts[1], rt: parts[2] };
}
function headers(at, method = "GET") {
  const timestamp = Date.now(),
    current = Date.now(),
    nonce = Math.floor(100000 + Math.random() * 900000);
  const value = {
    accept: "application/json",
    apptoken: at,
    devicecode: "",
    "current-time": String(current),
    deviceid: "",
    version: APP_VERSION,
    nonce: String(nonce),
    token: at,
    authorization: `Bearer ${at}`,
    sig: md5(`${timestamp}${nonce}${APP_ID}${APP_KEY}`),
    platformno: "Android",
    osversion: "10",
    operatesystem: "android",
    appid: APP_ID,
    registrationid: "",
    "api-sign": md5(`${current}${API_KEY}`).toUpperCase(),
    devicemodel: "IQOO 10",
    timestamp: String(timestamp),
    host: "next.gacmotor.com",
    connection: "Keep-Alive",
    "accept-encoding": "gzip",
    "user-agent": "okhttp/4.8.1",
  };
  if (method === "POST") value["content-type"] = "application/json; charset=UTF-8";
  return value;
}
async function app(ctx, path, item, options = {}) {
  const data = await ctx.requestJson(`${BASE}${path}`, {
    method: options.method || "GET",
    headers: headers(item.at, options.method || "GET"),
    json: options.json,
  });
  if (
    String(data?.resultCode ?? "0") !== "0" ||
    (data?.code !== undefined && !["", "0", "0000"].includes(String(data.code)))
  )
    throw new Error(data?.resultMsg || data?.msg || "广汽接口返回失败");
  return data;
}
async function refresh(ctx, item) {
  const data = await app(ctx, "/app/app-api/login/refreshAt", item, {
    method: "POST",
    json: { refreshToken: item.rt },
  });
  const value = data?.data || {};
  if (!value.accessToken) throw new Error("refreshToken刷新失败");
  return { ...item, at: value.accessToken, rt: value.refreshToken || item.rt };
}
async function gdou(ctx, item) {
  try {
    const data = await app(ctx, "/app/app-api/user/getUserGdou", item);
    return { item, gdou: data?.data ?? 0 };
  } catch (error) {
    const renewed = await refresh(ctx, item);
    const data = await app(ctx, "/app/app-api/user/getUserGdou", renewed);
    return { item: renewed, gdou: data?.data ?? 0, refreshed: true };
  }
}
const runtime = createAccountRuntime({
  title: "广汽",
  shortName: "广汽",
  prefix: "gacmotor",
  defaultEnvName: "GacMotor",
  orderPrefix: "GAC",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#AT#RT，支持批量每行一个", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean))
      try {
        const item = parse(line),
          result = await gdou(ctx, item);
        rows.push({ account: item.mobile, token: `${result.item.at}#${result.item.rt}`, remark: item.mobile });
      } catch (error) {
        await ctx.sender.reply(`广汽登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, stored) {
    const raw = String(stored.token).split("#"),
      result = await gdou(ctx, { mobile: stored.account, at: raw[0], rt: raw[1] });
    if (result.refreshed) await ctx.tokens.set(stored.account, `${result.item.at}#${result.item.rt}`);
    return `📱 APP状态：正常\n🫘 G豆：${result.gdou}${result.refreshed ? "\n🔄 AT/RT已自动刷新保存" : ""}`;
  },
  async cronCheck(ctx, stored) {
    try {
      const raw = String(stored.token).split("#");
      await gdou(ctx, { mobile: stored.account, at: raw[0], rt: raw[1] });
      return "";
    } catch (_) {
      return "AT/RT检测失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====广汽教程=====\n抓包提交格式：手机号#AT#RT，支持批量\n查询手机号、APP状态、G豆，AT失效时尝试用RT刷新\n指令：广汽登录、查询、管理、授权、清理、教程\n==================",
});
runtime.main().catch(async (error) => s.reply(`广汽执行失败：${error?.message || error}`));

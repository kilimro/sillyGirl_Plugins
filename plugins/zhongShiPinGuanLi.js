// [title: 中视频管理]
// [name: zhongShiPinGuanLi]
// [desc: 中视频SecretId/SecretKey/设备码批量登录、面板收入与App签到查询、账号管理、授权、青龙同步和到期检测。]
// [author: 8165799]
// [version: v1.9.1]
// [rule: raw ^中视频(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 30 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/settings.svg]
// [origin: backup/中视频管理_v1.9_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const API = "https://x1.zsptv.online";
function parse(raw) {
  const p = String(raw)
    .split("#")
    .map((v) => v.trim());
  if (p.length === 2 && p[0] && p[1]) return { secretId: p[0], secretKey: p[1], deviceId: "", remark: "" };
  if (p.length === 3 && p.every(Boolean)) return { secretId: p[0], secretKey: p[1], deviceId: p[2], remark: "" };
  if (p.length >= 4 && p.slice(0, 4).every(Boolean))
    return { remark: p[0], secretId: p[1], secretKey: p[2], deviceId: p[3] };
  throw new Error("格式应为 SecretId#SecretKey[#deviceId] 或 备注#SecretId#SecretKey#deviceId");
}
function credential(item) {
  return `${item.secretId}#${item.secretKey}${item.deviceId ? `#${item.deviceId}` : ""}`;
}
function appHeaders(item, token = "") {
  const headers = {
    accept: "*/*",
    "content-type": "application/json",
    "accept-encoding": "gzip",
    connection: "Keep-Alive",
    host: "x1.zsptv.online",
    "user-agent":
      "Mozilla/5.0 (Linux; Android 14; LE2120 Build/UKQ1.230924.001; wv) AppleWebKit/537.36 Version/4.0 Chrome/146.0.7680.119 Mobile Safari/537.36 (Immersed/32.0) Html5Plus/1.0",
    "app-device": JSON.stringify({
      id: item.deviceId || "default_dev_id",
      brand: "oneplus",
      model: "LE2120",
      platform: "android",
      system: "Android 14",
    }),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
function webHeaders(token) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "accept-encoding": "gzip",
    connection: "Keep-Alive",
    host: "x1.zsptv.online",
    origin: "https://zsp.99panel.top",
    referer: "https://zsp.99panel.top/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
  };
  if (token) headers.authorization = `bearer ${token}`;
  return headers;
}
async function secretLogin(ctx, item) {
  const data = await ctx.requestJson(`${API}/api/app/v1/auth/secretKeyLogin`, {
    method: "POST",
    headers: appHeaders(item),
    json: { secretId: item.secretId, secretKey: item.secretKey },
  });
  if (Number(data?.code) !== 0 || !data?.data?.token) throw new Error(data?.message || "SecretKey登录失败");
  return data.data.token;
}
async function getInfo(ctx, item) {
  const token = await secretLogin(ctx, item);
  try {
    const panel = await ctx.requestJson(`${API}/api/web/v1/dashboard/getPanelData`, { headers: webHeaders(token) });
    if (Number(panel?.code) === 0) {
      const d = panel.data || {};
      return {
        mode: "panel",
        value: d.incomeScore ?? 0,
        message: `💵 今日收入：¥${d.todayMoney ?? 0}\n📊 今日广告投播：${d.viewAdCount ?? 0}\n👥 团队规模：${d.userCount ?? 0}`,
      };
    }
  } catch (_) {}
  const sign = await ctx.requestJson(`${API}/api/app/v1/device/userSign`, {
    method: "POST",
    headers: appHeaders(item, token),
    json: {},
  });
  const msg = sign?.message || "";
  if (Number(sign?.code) === 0)
    return {
      mode: "app",
      value: sign?.data?.qiandao_money ?? 0,
      message: "✅ 签到成功\nℹ️ Secret登录仅能查询App接口，广告收益需脚本执行任务后统计",
    };
  if (msg.includes("已签到"))
    return {
      mode: "app",
      value: 0,
      message: "✅ 今日已签到\nℹ️ Secret登录仅能查询App接口，广告收益需脚本执行任务后统计",
    };
  return { mode: "app", value: 0, message: `⚠️ 签到查询：${msg || "接口未返回详情"}` };
}
const runtime = createAccountRuntime({
  title: "中视频管理",
  shortName: "中视频",
  prefix: "zsp_video",
  defaultEnvName: "ZSPTV",
  orderPrefix: "ZSP",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(
      ctx.sender,
      "请输入 SecretId#SecretKey[#deviceId]\n或 备注#SecretId#SecretKey#deviceId，支持批量",
      120000,
    );
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const item = parse(line);
        await secretLogin(ctx, item);
        rows.push({
          account: item.secretId,
          token: credential(item),
          remark: item.remark || `中视频_${item.secretId.slice(0, 4)}***`,
        });
      } catch (error) {
        await ctx.sender.reply(`中视频登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, stored) {
    const result = await getInfo(ctx, parse(stored.token));
    return `💰 查询数值：${result.value}\n${result.message}`;
  },
  async cronCheck(ctx, stored) {
    try {
      await secretLogin(ctx, parse(stored.token));
      return "";
    } catch (_) {
      return "SecretId/SecretKey检测失效，请更新凭证";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====中视频管理教程=====\n提交SecretId#SecretKey，可追加#deviceId，支持备注前缀和批量\n查询Web面板今日收入/广告/团队，面板不可用时查询App签到\n指令：中视频登录、查询、管理、授权、清理、教程\n==================",
});
runtime.main().catch(async (error) => s.reply(`中视频管理执行失败：${error?.message || error}`));

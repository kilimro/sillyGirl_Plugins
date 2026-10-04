// [title: 嘉善]
// [name: jiaShan]
// [desc: 嘉善手机号密码批量登录、阅读活动与近5天抽奖记录查询、账号管理、授权、青龙同步和到期检测。]
// [author: 8165799]
// [version: v1.1.1]
// [rule: raw ^嘉善(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 21 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/嘉善_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const APP_API = "https://api.app.injs.jsxww.cn",
  YAPI = "https://yapi.y-h5.iyunxh.com/api",
  OAPI = "https://oapi.injs.jsxww.cn",
  ORIGIN = "https://jsxww.y-h5.iyunxh.com",
  OSS = "https://oss.injs.jsxww.cn";
const SIGN_SALT = "0c3eafb13e9f1ac110a432798b021862",
  API_SIGN_SALT = "3a82b6ac78145c2a6c4ff1f7d3dced1b",
  CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function md5(v) {
  return crypto.createHash("md5").update(String(v)).digest("hex");
}
function randomText(length) {
  return Array.from({ length }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}
function signature() {
  const time = Date.now(),
    nonce = randomText(32);
  return `jsxww;${nonce};${time};${md5(`jsxww${nonce}${time}${API_SIGN_SALT}`)}`;
}
function parse(raw) {
  const parts = String(raw)
    .split("#")
    .map((v) => v.trim())
    .filter(Boolean);
  if (parts.length === 2 && /^1[3-9]\d{9}$/.test(parts[0])) return { mobile: parts[0], password: parts[1], remark: "" };
  if (parts.length >= 3 && /^1[3-9]\d{9}$/.test(parts.at(-2)))
    return { mobile: parts.at(-2), password: parts.at(-1), remark: parts[0] };
  throw new Error("格式应为 手机号#密码 或 备注#手机号#密码");
}
function queryString(object) {
  return Object.entries(object)
    .map(([k, v]) => `${k}=${encodeURIComponent(v == null ? "" : String(v)).replace(/~/g, "%7E")}`)
    .join("&");
}
function apiHeaders(state, json = false, anonymous = false) {
  const headers = {
    connection: "Keep-Alive",
    "access-user-id": String(anonymous ? 0 : state.readUserId || 0),
    "access-api-signature": signature(),
    "access-t-id-in": "49",
    "access-wxclient-type": "wx_app",
    "user-agent": state.ua,
    "access-token": anonymous ? "" : state.readToken,
    "access-api-unique-token": "1",
    "access-api-dt": anonymous ? String(Date.now()) : state.apiDt,
    "access-t-id": "49",
    accept: "*/*",
    origin: ORIGIN,
    "x-requested-with": "info.ltit.www.cloudjiashan",
    referer: `${ORIGIN}/`,
    "accept-encoding": "gzip, deflate",
    "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  };
  if (json) headers["content-type"] = "application/json";
  return headers;
}
async function requestOk(ctx, url, options = {}) {
  const data = await ctx.requestJson(url, options);
  if (data?.code !== undefined && String(data.code) !== "0" && data.msg) throw new Error(data.msg);
  return data;
}
async function loginChain(ctx, credential) {
  const state = {
    ...credential,
    clientId: crypto.randomUUID().replace(/-/g, ""),
    appToken: "",
    apiDt: "",
    readToken: "",
    readUserId: "",
  };
  state.ua = `injs;android:11;version:1.1.12;clientid:${state.clientId};Mozilla/5.0 (Linux; Android 11; 21091116AC Build/RP1A.200720.011; wv) AppleWebKit/537.36 Version/4.0 Chrome/94.0.4606.85 Mobile Safari/537.36`;
  const appHeaders = () => ({
    connection: "Keep-Alive",
    clientid: state.clientId,
    authorization: state.appToken,
    "user-agent": `injs;android:11;version:1.1.12;clientid:${state.clientId}`,
    "content-type": "application/json; charset=utf-8",
    "accept-encoding": "gzip",
  });
  const login = await requestOk(ctx, `${APP_API}/login`, {
    method: "POST",
    headers: appHeaders(),
    json: { username: state.mobile, password: state.password },
  });
  if (Number(login?.code) !== 0 || !login?.data?.token) throw new Error(login?.msg || "嘉善登录失败");
  state.appToken = login.data.token;
  state.user = login.data.userinfo || {};
  const layout = await requestOk(
    ctx,
    `${APP_API}/app/layout/dynamic/component/data?layoutId=7853114638635438077&layoutDatasourceId=7853114638635438096&pageNo=1&pageSize=20`,
    { headers: appHeaders() },
  );
  const activityId = JSON.stringify(layout).match(/\/module-study\/home\/home\?hide_back=1&id=(\d+)/)?.[1];
  if (!activityId) throw new Error("获取阅读活动失败");
  state.activityId = activityId;
  const dt = await requestOk(ctx, `${YAPI}/aosbase/_auth_dt`, { headers: apiHeaders(state, false, true) });
  state.apiDt = String(dt?.data || "").slice(32, 68);
  const access = await requestOk(
    ctx,
    `${YAPI}/admin/_service_custom_jsxww_getaccesstoken?access_t_id=1&access_t_id_in=1`,
    { headers: apiHeaders(state, false, true) },
  );
  const openid = await requestOk(
    ctx,
    `${OAPI}/auth/openid?access_token=${encodeURIComponent(access?.data || "")}&app_token=${encodeURIComponent(state.appToken)}`,
    { headers: appHeaders() },
  );
  const payload = {
    app_user_token: `${openid?.data?.openid}.${openid?.data?.ticket}`,
    appid: "jsxww",
    noncestr: randomText(6),
    phone: state.mobile,
    portrait_url: OSS + String(state.user.avatarUrl || ""),
    timestamp: String(Math.round(Date.now() / 1000)),
    user_id: state.user.id,
    user_name: state.user.nickname || "",
    wx_openid: "",
    wx_unionid: "",
  };
  payload.signature = md5(queryString(payload) + `&appkey=${SIGN_SALT}`);
  const read = await requestOk(ctx, `${YAPI}/aosbase/_auth_appuserinit`, {
    method: "POST",
    headers: apiHeaders(state, true),
    json: payload,
  });
  if (!read?.data?.access_token) throw new Error(read?.msg || "阅读登录失败");
  state.readToken = read.data.access_token;
  state.readUserId = String(read.data?.data?.user_id || "");
  return state;
}
function prize(row) {
  const title = String(row?.title || row?.goods_title || row?.goods_name || row?.prize_title || "").trim(),
    value = String(row?.value || row?.amount || row?.money || "").trim();
  if (value && /随机|红包|现金/.test(title)) return `${value}元${title.includes("现金") ? "现金红包" : "红包"}`;
  return title || (value ? `${value}元红包` : "谢谢参与");
}
async function lottery(ctx, state) {
  const detail = await requestOk(ctx, `${YAPI}/aoslearnfoot/_ac_detail?id=${state.activityId}`, {
    headers: apiHeaders(state),
  });
  let setting = detail?.data?.other_set || "{}";
  if (typeof setting === "string") setting = JSON.parse(setting);
  const lotteryId = setting?.lottery?.id;
  if (!lotteryId) throw new Error("获取抽奖活动失败");
  const activity = await requestOk(ctx, `${YAPI}/aoslottery/_ac_detail?id=${lotteryId}`, {
      headers: apiHeaders(state),
    }),
    moduleId = activity?.data?.m_id || "";
  const data = await requestOk(
    ctx,
    `${YAPI}/aoslottery/act_user?offset=0&count=20&activity_id=${lotteryId}${moduleId ? `&module_id=${moduleId}` : ""}`,
    { headers: apiHeaders(state) },
  );
  const cutoff = Date.now() - 4 * 86400000;
  return (Array.isArray(data?.data) ? data.data : [])
    .filter((row) => {
      const t = Date.parse(String(row.created_at || row.createdAt || row.add_time || ""));
      return !Number.isFinite(t) || t >= cutoff;
    })
    .slice(0, 10)
    .map(
      (row) =>
        `${String(row.created_at || row.createdAt || row.add_time || "").slice(0, 10) || "未知日期"} ${prize(row)}`,
    );
}
const runtime = createAccountRuntime({
  title: "嘉善",
  shortName: "嘉善",
  prefix: "jiashan",
  defaultEnvName: "JiaShan",
  orderPrefix: "JS",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入 手机号#密码 或 备注#手机号#密码，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const item = parse(line),
          state = await loginChain(ctx, item);
        rows.push({
          account: item.mobile,
          token: `${item.mobile}#${item.password}`,
          remark: item.remark || state.user.nickname || item.mobile,
        });
      } catch (error) {
        await ctx.sender.reply(`嘉善登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const state = await loginChain(ctx, parse(item.token)),
      records = await lottery(ctx, state);
    return `📱 手机号：${state.mobile}\n👤 昵称：${state.user.nickname || "未设置"}\n🎁 近5天抽奖记录：${records.length ? `\n${records.join("\n")}` : "暂无"}`;
  },
  async cronCheck(ctx, item) {
    try {
      await loginChain(ctx, parse(item.token));
      return "";
    } catch (_) {
      return "账号密码登录失败，请更新凭证";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====嘉善教程=====\n登录格式：手机号#密码 或 备注#手机号#密码，支持批量\n查询阅读活动近5天抽奖记录\n指令：嘉善登录、查询、管理、授权、清理、教程\n==================",
});
runtime.main().catch(async (error) => s.reply(`嘉善执行失败：${error?.message || error}`));

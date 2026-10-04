// [title: Hook 依赖模块]
// [name: hookGuanLi]
// [desc: funyhook 旧版公共依赖的 CommonJS 迁移版，提供日期、随机、URL、哈希、二维码、推送及青龙 API 工具]
// [author: funyhook]
// [version: v6.2.1]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [module: true]
// [carry: true]
// [origin: backup/hook_v6.2_By.funyhook.js;backup/hook_v6.2_By.funyhook.txt]
// [depe: []]

const crypto = require("node:crypto");
let sg = {};
try {
  sg = require("sillygirl");
} catch {
  sg = {};
}

const API_MAP = {
  imt_sms_: {
    //茅台登陆
    host: "app.moutai519.com.cn",
    code_url: "https://app.moutai519.com.cn/xhr/front/user/register/vcode",
    login_url: "https://app.moutai519.com.cn/xhr/front/user/register/login",
    mtv_url: "http://82.157.10.108:8086/get_mtv?DeviceID={0}&MTk={1}&version={2}&key=yaohuo",
    param_url: `http://82.157.10.108:8086/get_actParam?key=yaohuo&actParam={0}`,
    add_url: `https://app.moutai519.com.cn/xhr/front/mall/reservation/add`,
    limit: 10,
  },
  bohai_: {
    //渤海
    host: "gms.ihaoqu.com",
    checkInUrl: "https://gms.ihaoqu.com/gmswx/app.php?rid=28&ogid=10&noauth=1&r=api2&apiAction=SignIn",
    userInfoUrl: "https://gms.ihaoqu.com/gmswx/app.php?rid=28&ogid=10&noauth=1&r=api2&apiAction=getUserInfo",
    rechargeUrl: "https://gms.ihaoqu.com/gmswx/app.php?rid=28&ogid=10&noauth=1&r=api2&apiAction=Recharge",
    limit: 10,
  },
  vhook_wool_: {
    //线报引擎
    host: "app.xiaodigu.cn",
    woolUrl:
      "https://app.xiaodigu.cn/mag/info/v2/channel/infoListByCatId?step=10&channel_id=52&uniqid=61c5dcf4edb4c&is_app_first=-1&cat_id=112&p=1",
    limit: 10,
  },
  haidilao_: {
    //海底捞
    host: "superapp-public.kiwa-tech.com",
    checkInUrl: "https://superapp-public.kiwa-tech.com/activity/wxapp/signin/signin",
    pointUrl: "https://superapp-public.kiwa-tech.com/activity/wxapp/signin/queryFragment",
    limit: 10,
  },
  xkqd_: {
    //星空签到
    host: "www.xkdaili.com",
    loginSignUrl: "http://www.xkdaili.com/tools/submit_ajax.ashx?action=user_login&site_id=1",
    pointUrlL: "http://www.xkdaili.com/tools/submit_ajax.ashx?action=user_receive_point",
    apiKeyUrl: "http://api2.xkdaili.com/tools/XApi.ashx?apikey=#apikey&qty=1&format=txt&split=0&sign=&check=1",
  },
  yunshanfu_: {
    //云闪付
    host: "95516.com",
    checkInUrl: "https://youhui.95516.com/newsign/api/daily_sign_in",
    checkInUhUrl: "https://bjchx.95516.com/uhcpmobile/interest/signinInfo/signin",
  },
  wangchao_: {
    //望潮
    task_host: "xmt.taizhou.com.cn",
    login_url: "https://xmt.taizhou.com.cn/prod-api/user-read/app/login?id=#id&sessionId=#sessionId",
    taskUrl: "https://xmt.taizhou.com.cn/prod-api/user-read/list",
    read_host: "",
    readUrl: "https://bjchx.95516.com/uhcpmobile/interest/signinInfo/signin",
    loginWC_url: "https://srv-app.taizhou.com.cn/tzrb/user/loginWC?accountId=#accountId&sessionId=#sessionId",
    drawUrl: "https://srv-app.taizhou.com.cn/tzrb/userAwardRecordUpgrade/save",
    draw_prize_url: "https://srv-app.taizhou.com.cn/tzrb/awardUpgrade/list?activityId=#activityId",
    draw_record_url:
      "https://srv-app.taizhou.com.cn/tzrb/userAwardRecordUpgrade/pageList?pageSize=10&pageNum=1&activityId=#activityId",
    integral_url: "https://xmt.taizhou.com.cn/prod-api/integral",
    checkInUrl: "https://vapp.taizhou.com.cn/api/user_mumber/sign",
    draw_id: 67,
  },
  gehuadongyang_: {
    //歌画东阳
    host: "https://vapp.tmuyun.com",
    account_detail_url: "/api/user_mumber/account_detail",
    channel_list_url: "/api/article/channel_list",
    article_detail_url: "/api/article/detail",
    draw_host: "https://fijdzpur.act.tmuact.com",
    draw_url: "/activity/api.php",
    tx_url: "/activity/api.php",
    limit: 10,
  },
  jinriyuecheng_: {
    //今日越城
    host: "https://vapp.tmuyun.com",
    account_detail_url: "/api/user_mumber/account_detail",
    channel_list_url: "/api/article/channel_list",
    article_detail_url: "/api/article/detail",
    draw_host: "https://fijdzpur.act.tmuact.com",
    draw_url: "/activity/api.php",
    tx_url: "/activity/api.php",
    limit: 10,
  },
  alicloud_: {
    //阿里云
    qr_url: "https://aliyundriver-refresh-token-one.vercel.app/api/generate?img=true",
    qr_status_url: "https://aliyundriver-refresh-token-one.vercel.app/api/state-query?ck=#ck&t=#t",
    token_url: "https://auth.aliyundrive.com/v2/account/token",
    sign_url: "https://member.aliyundrive.com/v1/activity/sign_in_list",
    sign_reward_url: "https://member.aliyundrive.com/v1/activity/sign_in_reward",
    limit: 10,
  },
  jingdahuisuan_: {
    //京打惠算
    checkInUrl: "https://zhelihaoquan.yzgnet.com/prod-api/app/signIn",
    danSignInUrl: "https://zhelihaoquan.yzgnet.com/prod-api/app/danSignIn",
    poinrUrl: "http://aliyun.vhook.cn/api/state-query?ck=#ck&t=#t",
    userInfoUrl: "https://zhelihaoquan.yzgnet.com/prod-api/app/getUserInfo/ad",
    drawCountUrl: "https://zhelihaoquan.yzgnet.com/prod-api/app/drawCount",
    drawListUrl:
      "https://zhelihaoquan.yzgnet.com/prod-api/app/userDrawList?pageSize=20&pageNum=1&orderByColumn=draw_time&isAsc=desc",
    appid: "wx0583b73e21ce4931",
    platformKey: "43fdf5a241a94207a8a5d274235f5fae",
    limit: 10,
  },
  zhangshangouhai_: {
    //掌上瓯海
    host: "https://vapp.tmuyun.com",
    login_url: "https://passport.tmuyun.com/web/account/check_phone_number?client_id=10032&phone_number=",
    auth_url: "https://passport.tmuyun.com/web/oauth/credential_auth",
    channel_list_url: "'https://vapp.tmuyun.com/api/article/channel_list",
    article_detail_url: "/api/article/detail",
    draw_host: "https://fijdzpur.act.tmuact.com",
    draw_url: "/activity/api.php",
    tx_url: "/activity/api.php",
    limit: 10,
  },
  meituan_: {
    //美团
    host: "game.meituan.com",
    login_url:
      "https://game.meituan.com/earn-daily/login/loginMgc?gameType=10402&mtUserId={0}&mtToken={1}&mtDeviceId={2}&nonceStr={3}&externalStr={4}",
    earn_daily_url: "https://game.meituan.com/earn-daily/msg/post",
    limit: 10,
  },
};

function get_qr_url(url) {
  return `https://v.api.aa1.cn/api/api-qrcode/sc.php?text=${encodeURIComponent(url)}`;
}
function get_qr_url2(url) {
  return get_qr_url(url);
}
function hookCreateQR(url) {
  const value = `https://api.pwmqr.com/qrcode/create/?url=${encodeURIComponent(url)}`;
  return sg.utils?.image ? sg.utils.image(value) : value;
}
function createQR(url) {
  return hookCreateQR(url);
}
function encryphoneCard(value) {
  const text = String(value ?? "");
  if (text.length === 11) return text.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
  if (text.length === 18 || text.length === 15) return text.replace(/^(\d{6})\d+(\d{4})$/, "$1******$2");
  return text;
}
async function pingstrUrl(rawUrl) {
  const target = new URL(rawUrl);
  const response = await fetch(`https://v.api.aa1.cn/api/api-ping/ping.php?url=${encodeURIComponent(target.origin)}`, {
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  return data?.host || "";
}
function pad(value) {
  return String(value).padStart(2, "0");
}
function getDateTime(dateTime = new Date()) {
  const d = new Date(dateTime);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function getNextMonthDate(dateTime = new Date()) {
  const d = new Date(dateTime);
  d.setMonth(d.getMonth() + 1);
  return d;
}
function getNextMonthTimestamp(dateTime = new Date()) {
  return getNextMonthDate(dateTime).getTime();
}
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function getTodayStartTime() {
  return new Date(`${getToday()}T00:00:00`).getTime();
}
function getTodayEndTime() {
  return new Date(`${getToday()}T23:59:59`).getTime();
}
function getTodayEnd() {
  return new Date(getTodayEndTime());
}
function getTimestamp() {
  return Date.now();
}
function getHour() {
  return new Date().getHours();
}
function local_hours() {
  return getHour();
}
function local_minutes() {
  return new Date().getMinutes();
}
function ts13() {
  return String(Date.now());
}
function ts10() {
  return String(Math.round(Date.now() / 1000));
}
function randomInt(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}
function randomNumber(min = 0, max = 100) {
  return Math.min(Math.floor(min + Math.random() * (max - min)), max);
}
function randomString(length = 32) {
  return randomStr("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", length);
}
function randomArr(arr, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += arr[Math.floor(Math.random() * arr.length)];
  return out;
}
function randomStr(chars, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
function random_device_id() {
  const x = (n) => randomStr("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", n);
  return `${x(8)}-${x(4)}-${x(4)}-${x(4)}-${x(12)}`;
}
function userAgent() {
  const ios = `${randomInt(13, 17)}.${randomInt(0, 6)}`;
  return `jdltapp;iPhone;3.7.0;${ios};${randomString(40)};network/wifi;Mozilla/5.0 (iPhone; CPU iPhone OS ${ios.replace(".", "_")} like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148;supportJDSHWK/1`;
}
function randomUserAgent_jd() {
  const ios = `${randomInt(14, 17)}.${randomInt(0, 6)}`;
  return `jdapp;iPhone;12.6.0;${ios};${randomString(40)};network/wifi;ADID/${random_device_id()};model/iPhone${randomInt(10, 15)},1;appBuild/168858;Mozilla/5.0 (iPhone; CPU iPhone OS ${ios.replace(".", "_")} like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148;supportJDSHWK/1`;
}
function platformArr(name) {
  return ["qq", "wx", "wb", "tg", "bt", "qb", "mqindiv"].map((imType) => ({ platform: `${name}${imType}`, imType }));
}
async function pushMsg(userId, imType, groupCode, content, sender = sg.sender) {
  if (!sender) return false;
  try {
    const adapter = await sender.getAdapter(imType);
    if (adapter?.push) {
      await adapter.push({
        user_id: userId ? String(userId) : undefined,
        group_id: groupCode ? String(groupCode) : undefined,
        chat_id: groupCode ? String(groupCode) : undefined,
        content: String(content),
      });
      return true;
    }
  } catch {}
  await sender.pushAdmin?.(String(content), { platform: imType ? [String(imType)] : undefined });
  return true;
}
async function pushMasters(content, sender = sg.sender) {
  if (!sender?.pushAdmin) return false;
  await sender.pushAdmin(String(content));
  return true;
}
function getDaysBetween(a, b) {
  return (Date.parse(b) - Date.parse(a)) / 86400000;
}
function arrayAminusB(a, b) {
  return a.filter((value) => !b.includes(value));
}
function checkCode(plugin) {
  return { success: true, msg: "success", data: { api: API_MAP[plugin] } };
}
function check(plugin) {
  return checkCode(plugin).data;
}
function check_plugin_ver() {
  return true;
}
function check_aut_ver() {
  return true;
}
function checkPlugin(name, _tips, registry = {}) {
  return Boolean(registry?.[name] ?? true);
}
async function plugin_notify(name, type, message, notify) {
  if (typeof notify === "function") return notify({ name, type, message });
  return { name, type, message };
}
async function install_notify(title, notify) {
  return plugin_notify(title, "install", "新用户安装", notify);
}
async function error_notify(title, error, notify) {
  return plugin_notify(title, "error", String(error?.message || error), notify);
}
function plugin_log(name, content) {
  return { name, content };
}
function decodeUnicode(text) {
  return String(text).replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
function jsonSort2Str(obj, encodeUrl = false) {
  return Object.keys(obj)
    .sort()
    .map((key) => `${key}=${encodeUrl ? encodeURIComponent(obj[key]) : obj[key]}`)
    .join("&");
}
function str2json(text, decodeUrl = false) {
  const out = {};
  for (const item of String(text).split("&")) {
    const index = item.indexOf("=");
    if (index < 1) continue;
    const key = item.slice(0, index),
      value = item.slice(index + 1);
    out[key] = decodeUrl ? decodeURIComponent(value) : value;
  }
  return out;
}
function trimAll(value) {
  return typeof value === "string" ? value.replace(/[\n\f\r\t\s]+/g, "") : value;
}
function removeSpecialChars(obj) {
  for (const key of Object.keys(obj || {})) obj[key] = trimAll(obj[key]);
  return obj;
}
function getUrlParamValue(url, name) {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}
function getUrlValueByName(name, url) {
  const text = String(url);
  const query = text.includes("?") ? text.slice(text.indexOf("?")) : text;
  return new URLSearchParams(query).get(name);
}
function UrlParamHash(url) {
  const params = [];
  const query = String(url).includes("?") ? String(url).split("?").slice(1).join("?") : String(url);
  for (const [key, value] of new URLSearchParams(query)) {
    params.push(key);
    params[key] = value;
  }
  return params;
}
function httpString(value) {
  return String(value).match(/(?:https?|ftp|file):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+/g);
}
function containsUrl(value) {
  return Boolean(httpString(value));
}
function clearUrl(value) {
  const text = String(value);
  return /(?:…|item\.jd\.com| \.\.\. )/.test(text)
    ? text.replace(/(?:https?|ftp|file):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+/g, "")
    : text;
}
function MD5Encrypt(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}
function SHA1Encrypt(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}
const Base64 = {
  encode: (value) => Buffer.from(String(value), "utf8").toString("base64"),
  decode: (value) => Buffer.from(String(value), "base64").toString("utf8"),
};
class Qinglong {
  constructor(host, client_id, client_secret) {
    this.host = String(host || "").replace(/\/$/, "");
    this.client_id = client_id;
    this.client_secret = client_secret;
    this.token = "";
  }
  async getToken() {
    const data = await this.request(
      `/open/auth/token?client_id=${encodeURIComponent(this.client_id)}&client_secret=${encodeURIComponent(this.client_secret)}`,
      { auth: false },
    );
    this.token = data?.data?.token || "";
    return this.token || null;
  }
  async request(path, { method = "GET", body, auth = true } = {}) {
    if (auth && !this.token) await this.getToken();
    const response = await fetch(this.host + path, {
      method,
      headers: {
        "content-type": "application/json;charset=UTF-8",
        ...(auth ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`青龙 HTTP ${response.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }
  envsGet(keyword = "") {
    return this.request(`/open/envs?searchValue=${encodeURIComponent(keyword)}&t=${Date.now()}`);
  }
  envsSet(envs) {
    return this.request(`/open/envs?t=${Date.now()}`, { method: "POST", body: envs });
  }
  envsUpdate(envs) {
    return this.request(`/open/envs?t=${Date.now()}`, { method: "PUT", body: envs });
  }
  cronsGet(keyword = "") {
    return this.request(`/open/crons?searchValue=${encodeURIComponent(keyword)}&t=${Date.now()}`);
  }
  cronsRun(ids) {
    return this.request(`/open/crons/run?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  cronsStop(ids) {
    return this.request(`/open/crons/stop?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  cronsEnable(ids) {
    return this.request(`/open/crons/enable?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  cronsDisable(ids) {
    return this.request(`/open/crons/disable?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  cronLogs(id) {
    return this.request(`/open/crons/${encodeURIComponent(id)}/logs?t=${Date.now()}`);
  }
  cronLog(id) {
    return this.request(`/open/crons/${encodeURIComponent(id)}/log?t=${Date.now()}`);
  }
  subsGet(keyword = "") {
    return this.request(`/open/subscriptions?searchValue=${encodeURIComponent(keyword)}&t=${Date.now()}`);
  }
  subsRun(ids) {
    return this.request(`/open/subscriptions/run?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  subsEnable(ids) {
    return this.request(`/open/subscriptions/enable?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  subsDisable(ids) {
    return this.request(`/open/subscriptions/disable?t=${Date.now()}`, { method: "PUT", body: ids });
  }
  logs_all() {
    return this.request(`/open/logs?t=${Date.now()}`);
  }
  logs_file(file) {
    return this.request(`/open/logs/${encodeURIComponent(file)}`);
  }
  logs_dir_file(dir, file) {
    return this.request(`/open/logs/${encodeURIComponent(file)}?path=${encodeURIComponent(dir)}`);
  }
}
class aut {
  constructor(name, local_ver, title, content) {
    this.name = name;
    this.local_ver = local_ver;
    this.title = title;
    this.content = content;
    this.data = plugin_log(name, content);
    this.update = false;
  }
  check_plugin_ver() {
    return false;
  }
}
class autMan {
  constructor(info = {}) {
    Object.assign(this, info);
  }
  userId(v) {
    return v;
  }
  chatId(v) {
    return v;
  }
  imType(v) {
    return v;
  }
  plugin_title(v) {
    return typeof v === "function" ? v() : v;
  }
  plugin_ver(v) {
    return v;
  }
  msg(v) {
    return v;
  }
}
class LegacyPlugin {
  ver(v) {
    return v;
  }
  title(v) {
    return v;
  }
  platformArr(key) {
    return platformArr(key);
  }
  auth(key) {
    return check(key);
  }
  user_data_arr() {
    return [];
  }
}
module.exports = {
  API_MAP,
  get_qr_url,
  get_qr_url2,
  hookCreateQR,
  createQR,
  encryphoneCard,
  pingstrUrl,
  getDateTime,
  getNextMonthDate,
  getNextMonthTimestamp,
  getToday,
  getTodayStartTime,
  getTodayEndTime,
  getTodayEnd,
  getTimestamp,
  getHour,
  local_hours,
  local_minutes,
  ts13,
  ts10,
  randomInt,
  randomNumber,
  randomString,
  randomArr,
  randomStr,
  random_device_id,
  userAgent,
  randomUserAgent_jd,
  platformArr,
  pushMsg,
  pushMasters,
  getDaysBetween,
  arrayAminusB,
  checkCode,
  check,
  check_plugin_ver,
  check_aut_ver,
  checkPlugin,
  plugin_notify,
  install_notify,
  error_notify,
  plugin_log,
  decodeUnicode,
  jsonSort2Str,
  str2json,
  trimAll,
  removeSpecialChars,
  getUrlParamValue,
  getUrlValueByName,
  UrlParamHash,
  httpString,
  containsUrl,
  clearUrl,
  MD5Encrypt,
  SHA1Encrypt,
  Base64,
  Qinglong,
  aut,
  autMan,
  plugin: LegacyPlugin,
};

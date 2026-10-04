// [title: 白鲸鱼回收]
// [name: baiJingYuHuiShou]
// [desc: 白鲸鱼手机号密码批量登录、回收金额查询、每日签到、授权、青龙/呆呆面板同步和账号管理。]
// [author: yueiqiu4523 / rujingxianghai]
// [version: v1.5.1]
// [rule: raw ^(白鲸鱼|bjy)(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/白鲸鱼_v1.5.1_By.yueiqiu4523.py;backup/白鲸鱼回收_v1.3.0_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const MEMBER = "https://www.52bjy.com/api/app/member.php",
  USER = "https://www.52bjy.com/api/app/user.php",
  UA =
    "Mozilla/5.0 (Linux; Android 11; SHARK KLE-A0 Build/KLEN2202130CN00MR4; wv) AppleWebKit/537.36 Version/4.0 Chrome/83.0.4103.106 Mobile Safari/537.36 uni-app Html5Plus/1.0";
function headers() {
  return { "user-agent": UA, connection: "Keep-Alive", "accept-encoding": "gzip", envconnection: "test" };
}
async function login(ctx, phone, password) {
  const data = await ctx.requestJson(MEMBER, {
    method: "POST",
    headers: headers(),
    form: { action: "login", username: phone, password, app: "self", sign: "" },
  });
  if (data?.message !== "登录成功" || !data?.data?.token) throw new Error(data?.message || "登录失败");
  return data.data.token;
}
async function balance(ctx, phone, password, sign = false) {
  const token = await login(ctx, phone, password);
  let signMessage = "";
  if (sign) {
    const r = await ctx.requestJson(
      `${USER}?action=qiandao&app=self&auth=${encodeURIComponent(token)}&username=${encodeURIComponent(phone)}`,
      { headers: headers() },
    );
    signMessage = r?.message || "签到接口无结果";
  }
  const url = new URL(USER);
  Object.entries({
    action: "userinfo",
    app: "self",
    appkey: "a9827e37ed2becd8",
    auth: token,
    is_pop: "0",
    username: phone,
    version: "2",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const data = await ctx.requestJson(url, { headers: headers() }),
    raw = data?.data?.credit_to_cash;
  if (raw === undefined) throw new Error(data?.message || "金额查询失败");
  const cash = Number(String(raw).match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return { cash, signMessage };
}
const rt = createAccountRuntime({
  title: "白鲸鱼回收",
  shortName: "白鲸鱼",
  prefix: "JQB.bjy",
  defaultEnvName: "bjy",
  orderPrefix: "BJY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入手机号#密码，支持批量换行", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const cut = line.indexOf("#"),
          phone = line.slice(0, cut).trim(),
          password = line.slice(cut + 1).trim();
        if (!/^1[3-9]\d{9}$/.test(phone) || cut < 0 || !password) throw new Error("格式应为手机号#密码");
        await login(ctx, phone, password);
        rows.push({ account: phone, token: password, remark: phone });
      } catch (error) {
        await ctx.sender.reply(`白鲸鱼登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await balance(ctx, item.account, item.token);
    return `📱 账号：${ctx.mask(item.account)}\n💰 当前可回收金额：${x.cash.toFixed(2)}元`;
  },
  async cronCheck(ctx, item) {
    const x = await balance(ctx, item.account, item.token, true);
    return `${x.signMessage}，当前可回收金额：${x.cash.toFixed(2)}元`;
  },
  envValue(_ctx, item) {
    return `${item.account}#${item.token}`;
  },
  tutorial:
    "=====白鲸鱼教程=====\n发送白鲸鱼登录，按手机号#密码提交，支持批量\n查询可回收金额；每天8点登录、签到并回查金额\n支持青龙或呆呆面板同步\n指令：白鲸鱼登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`白鲸鱼执行失败：${e?.message || e}`));

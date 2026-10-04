// [title: 江淮卡友]
// [name: jiangHuaiKaYou]
// [desc: 江淮卡友手机号密码批量登录、RSA签名、用户资料与积分查询、发帖/回帖开关、授权和面板同步。]
// [author: rujingxianghai]
// [version: v1.7.0]
// [rule: raw ^(江淮|jh)(登录|登陆|上车|查询|管理|授权|清理|教程|迁移)$]
// [cron: 0 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/江淮卡友_v1.7.0_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const HTTPS = "https://jacwxmp.starnetah.com",
  HTTP = "http://jacwxmp.starnetah.com",
  PUB = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIj9Wu0HmxAazAeXaERwuuirtc
AQRFnYq6ZA/inXdgHB8DVmwYTG8PWsDsDoZjbzmxe7j8uMrmev0q6oOh3nJRuF+3
J4oTtTP5Pp5t+Y8L5xuqYbdN4PL0hHf3omarX0sMeIpXtn2KiKYybHUR67oFv/R4
eOty05luqQfTKyhfEQIDAQAB
-----END PUBLIC KEY-----`;
function ua() {
  return "Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 Chrome/135.0.7049.37 Mobile Safari/537.36";
}
function rsa(phone) {
  return crypto
    .publicEncrypt({ key: PUB, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(`jac+${phone}`))
    .toString("base64");
}
async function passwordLogin(ctx, phone, password) {
  const loginBody = { login_type: "password", phone, password },
    d = await ctx.requestJson(`${HTTP}:18280/v2driver/v2/login`, {
      method: "POST",
      headers: {
        "user-agent": ua(),
        "accept-encoding": "gzip",
        "content-type": "application/json",
        host: "jacwxmp.starnetah.com:18280",
        devicetype: "1",
        devicemodal: "iPhone",
        referer: `${HTTP}:9201/`,
        origin: `${HTTP}:9201`,
        osname: "iOS 16.6.1",
        versiontype: "2",
      },
      json: {
        appType: "0",
        deviceType: "1",
        password: crypto.createHash("md5").update(password).digest("hex"),
        phone,
        sendMessageKey: "default",
        sign: rsa(phone),
      },
    });
  if (Number(d?.resultCode) !== 200 || !d?.data?.token) throw new Error(d?.message || "登录失败");
  return { phone, token: d.data.token, userId: String(d.data.id || d.data.userId || ""), loginBody };
}
function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}
async function api(ctx, x, path) {
  const d = await ctx.requestJson(`${HTTPS}:19000${path}`, {
    method: "POST",
    headers: {
      "user-agent": ua(),
      "accept-encoding": "gzip",
      "content-type": "application/json",
      apptype: "0",
      token: x.token,
    },
    json: { uc_id: x.userId },
  });
  if (Number(d?.resultCode) !== 200) throw new Error(d?.message || "接口失败");
  return d.data || {};
}
const rt = createAccountRuntime({
  title: "江淮卡友",
  shortName: "江淮",
  prefix: "s_jh",
  defaultEnvName: "S_JHKY",
  orderPrefix: "JHKY",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "格式：备注#手机号#密码[#发帖开关#回帖开关]，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = line.trim().split("#"),
          remark = p.shift(),
          phone = p.shift(),
          password = p.shift(),
          enablePost = /^(true|1)$/i.test(p.shift() || "false"),
          enableComment = /^(true|1)$/i.test(p.shift() || "false");
        if (!remark || !/^1[3-9]\d{9}$/.test(phone) || !password) throw new Error("格式错误");
        const x = await passwordLogin(ctx, phone, password);
        x.remark = remark;
        x.enablePost = enablePost;
        x.enableComment = enableComment;
        rows.push({ account: phone, token: JSON.stringify(x), remark });
      } catch (e) {
        await ctx.sender.reply(`江淮登录失败：${e?.message || e}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = parse(item.token),
      u = await api(ctx, x, "/v2driver/getUserInfo"),
      p = await api(ctx, x, "/v2driver/queryIntegral");
    return `👤 用户：${u.nickName || u.name || item.remark}\n📱 手机：${ctx.mask(x.phone)}\n🆔 用户ID：${x.userId}\n💰 积分：${p.integralCounts ?? 0}\n📝 发帖：${x.enablePost ? "开启" : "关闭"}\n💬 回帖：${x.enableComment ? "开启" : "关闭"}`;
  },
  async cronCheck(ctx, item) {
    try {
      const x = parse(item.token),
        p = await api(ctx, x, "/v2driver/queryIntegral");
      return `登录有效，当前积分${p.integralCounts ?? 0}`;
    } catch (_) {
      return "江淮登录凭证已失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${item.remark}#${JSON.stringify(x.loginBody)}#${String(x.enableComment)}#${String(x.enablePost)}`;
  },
  tutorial:
    "=====江淮卡友教程=====\n格式：备注#手机号#密码#发帖开关#回帖开关，两个开关可省略，默认false\n插件使用MD5密码和RSA(jac+手机号)签名登录，查询用户资料与积分，并同步面板供任务脚本使用\n指令：江淮登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`江淮卡友执行失败：${e?.message || e}`));

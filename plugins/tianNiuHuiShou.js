// [title: 天牛回收]
// [name: tianNiuHuiShou]
// [desc: 天牛旧衣token批量登录、积分/金额/签到次数查询、账号管理、授权、青龙同步和凭证到期检测。]
// [author: 8165799]
// [version: v1.1.1]
// [rule: raw ^天牛(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 25 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/天牛回收_v1.1_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
function normalizeToken(raw) {
  let value = String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (value.includes("token=")) {
    try {
      const parsed = new URL(value.includes("://") ? value : `https://local/?${value}`),
        token = parsed.searchParams.get("token");
      if (token) value = token;
    } catch (_) {
      const token = value.match(/(?:^|[?&])token=([^&#]+)/)?.[1];
      if (token) value = decodeURIComponent(token);
    }
  }
  return value.trim();
}
async function profile(ctx, token) {
  const data = await ctx.requestJson("https://tianniunew.fzjingzhou.com/api/Person/index", {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "zh-CN,zh;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      platform: "MP-WEIXIN",
      referer: "https://servicewechat.com/wx887c2f947bffa76e/6/page-frame.html",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
      xweb_xhr: "1",
    },
    form: { token },
  });
  if (Number(data?.code) !== 1000 || !data?.data) throw new Error(data?.msg || "token认证失败");
  const item = data.data;
  if (!item.mobile) throw new Error("未识别到手机号，请先在天牛旧衣小程序授权手机号");
  return {
    mobile: String(item.mobile),
    nickname: item.nickname || "",
    score: item.score ?? 0,
    exchange: item.exchange ?? item.money ?? "0.00",
    signCount: item.sign_in_num ?? 0,
  };
}
const runtime = createAccountRuntime({
  title: "天牛回收",
  shortName: "天牛",
  prefix: "tian_niu",
  defaultEnvName: "tnhs",
  orderPrefix: "TNHS",
  requireAuthForQuery: true,
  async login(ctx) {
    const input = await ctx.prompt(ctx.sender, "请输入token或含token参数的URL\n支持 备注#token，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)) {
      const cut = line.indexOf("#"),
        remark = cut >= 0 ? line.slice(0, cut).trim() : "",
        token = normalizeToken(cut >= 0 ? line.slice(cut + 1) : line);
      try {
        const info = await profile(ctx, token);
        rows.push({ account: info.mobile, token, remark: remark || info.nickname || info.mobile });
      } catch (error) {
        await ctx.sender.reply(`天牛登录失败：${error?.message || error}`);
      }
    }
    return rows;
  },
  async query(ctx, item) {
    const info = await profile(ctx, item.token);
    return `👤 昵称：${info.nickname || "未设置"}\n🪙 当前积分：${info.score}\n💰 当前金额：${info.exchange}元\n📅 签到次数：${info.signCount}`;
  },
  async cronCheck(ctx, item) {
    try {
      await profile(ctx, item.token);
      return "";
    } catch (_) {
      return "token检测失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====天牛回收教程=====\n入口：天牛旧衣小程序，先授权手机号\n提交token、含token参数的URL或备注#token，支持批量\n查询当前积分、金额和签到次数\n指令：天牛登录、查询、管理、授权、清理、教程\n==================",
});
runtime.main().catch(async (error) => s.reply(`天牛回收执行失败：${error?.message || error}`));

// [title: 看余杭]
// [name: kanYuHang]
// [desc: 看余杭手机号短信登录、Token与lotteryActivityUid提取、中奖记录查询、授权和青龙同步。]
// [author: huawei / rujingxianghai]
// [version: v1.2.2]
// [rule: raw ^看余杭(登录|登陆|上车|查询|管理|授权|清理|教程|中奖记录)$]
// [cron: 28 9 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/【插件】-看余杭_v1.2.2_By.huawei.py;backup/看余杭_v1.3.1_By.rujingxianghai.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const API = "https://app.eyh.cn/gateway/api",
  EQUIP = "8765B063-3A14-4B96-A305-46906482D5A5",
  GTCID = "fbb032d8742f3db47d4274098811fd0a";
function trace() {
  return crypto.randomBytes(5).toString("hex") + Math.floor(Date.now() / 1000);
}
function device(id = EQUIP) {
  return {
    device: "ios",
    equipmentId: id,
    deviceId: "000000",
    os: "17.6",
    deviceType: "iPhone15,4",
    clientVersion: "5.2.6",
    gtCid: GTCID,
    deviceBrand: "iphone",
  };
}
function headers() {
  return {
    "user-agent": "kan yu hang/5.2.6 (iPhone; iOS 17.6; Scale/3.00)",
    "content-type": "application/json",
    "accept-language": "zh-Hans-CN;q=1",
  };
}
async function call(ctx, api, data, token = "", service = "core", equipment = EQUIP) {
  const d = await ctx.requestJson(API, {
    method: "POST",
    headers: headers(),
    json: { api, data, traceId: trace(), userDevice: device(equipment), token, service },
  });
  if (String(d?.code) !== "0") throw new Error(d?.message || d?.msg || `${api}失败`);
  return d.data;
}
async function login(ctx) {
  const phone = await ctx.prompt(ctx.sender, "请输入手机号", 60000);
  if (!/^1[3-9]\d{9}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
  const sent = await call(ctx, "v2/login/sendLoginCode", { mobilePhone: phone }),
    serial =
      typeof sent === "object"
        ? sent.serialNum || sent.serial_num || sent.serialNumber || sent.serialNo || sent.smsSerialNum
        : sent;
  const code = await ctx.prompt(ctx.sender, "验证码已发送，请输入验证码", 300000);
  if (!/^\d+$/.test(String(code || ""))) throw new Error("验证码格式错误");
  const auth = await call(ctx, "v2/login/codeLogin", { serialNum: serial, code }, "", "core", EQUIP),
    token = typeof auth === "object" ? auth.token : auth;
  if (!token) throw new Error("登录接口未返回Token");
  const spread = await call(ctx, "spreadActivity/getAppUserSpreadActivity", {}, token, "media"),
    uid = spread?.lotteryActivityUid || "";
  return { phone, token, uid, equipment: EQUIP };
}
function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}
async function records(ctx, x) {
  return (await call(ctx, "lottery/queryActivityAwardRecordList", { uid: x.uid }, x.token, "media", x.equipment)) || [];
}
const rt = createAccountRuntime({
  title: "看余杭",
  shortName: "看余杭",
  prefix: "G_kyh",
  defaultEnvName: "G_KYH",
  orderPrefix: "KYH",
  requireAuthForQuery: true,
  async login(ctx) {
    try {
      const x = await login(ctx),
        account = `kyh_${crypto.createHash("md5").update(x.phone).digest("hex").slice(0, 10)}`;
      return [{ account, token: JSON.stringify(x), remark: x.phone }];
    } catch (e) {
      await ctx.sender.reply(`看余杭登录失败：${e?.message || e}`);
      return [];
    }
  },
  async query(ctx, item) {
    const x = parse(item.token),
      list = await records(ctx, x),
      out = [`📱 手机号：${ctx.mask(x.phone)}`, `🎁 中奖记录：${list.length}条`];
    for (const row of list.slice(0, 10))
      out.push(
        `- ${row.awardName || row.prizeName || row.name || "未知奖品"} ${row.createTime || row.awardTime || ""}`,
      );
    return out.join("\n");
  },
  async cronCheck(ctx, item) {
    try {
      const x = parse(item.token),
        list = await records(ctx, x);
      return `Token有效，当前中奖记录${list.length}条`;
    } catch (_) {
      return "看余杭Token已失效，请重新短信登录";
    }
  },
  envValue(_ctx, item) {
    const x = parse(item.token);
    return `${x.phone}#${x.token}#${x.uid}#${x.equipment}`;
  },
  tutorial:
    "=====看余杭教程=====\n发送看余杭登录，输入手机号和短信验证码\n插件自动提取Token、lotteryActivityUid、设备ID，查询中奖记录并按 手机号#Token#UID#DEVICEID 同步青龙\n指令：看余杭登录、查询、中奖记录、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`看余杭执行失败：${e?.message || e}`));

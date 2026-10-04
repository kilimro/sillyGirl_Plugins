// [title: app_武义]
// [name: appWuYi]
// [desc: 掌上武义账号登录、金华学习阅读、点赞分享、抽奖滑块、积分查询、账号管理、收费续期、代理与青龙同步。]
// [author: 601712460]
// [version: v1.0.0]
// [rule: raw ^武义(登陆|登录|签到|管理|超管|配置)$|^wyfk$]
// [cron: 12 7 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/app_武义_v0_By.601712460.py]
// [depe: ["./tmuyunJinhuaRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createRuntime } = require("./tmuyunJinhuaRuntime");

const runtime = createRuntime({
  name: "武义",
  prefix: "vhook_zhangshangwuyi_",
  defaultEnvName: "ZS_WUYI",
  tenantId: "73",
  clientId: "10024",
  jinhuaAppId: "vKmnytOp9GrPa7kLbWTx",
  jinhuaKey: "35c782a2",
  configChannelId: "657a5b3d79f6be03b8fd7fb1",
  configSize: 20,
  configMode: "column",
  taskChannelId: "6423f0a579f6be58d033d816",
  taskSize: 20,
  visitStudyArticles: true,
  localServiceTask: true,
  prizeMode: "legacy",
  adminRunCommand: "wyfk",
  jinhuaUa:
    "Mozilla/5.0 (Linux; Android 11; wv) AppleWebKit/537.36 Chrome/94.0.4606.85 Mobile Safari/537.36;xsb_wuyi;xsb_wuyi;3.1.0;native_app;6.6.1",
});

runtime.main().catch(async (error) => s.reply(`武义执行失败：${error?.message || error}`));

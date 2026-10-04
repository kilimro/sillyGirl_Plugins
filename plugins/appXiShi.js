// [title: app_西施]
// [name: appXiShi]
// [desc: 西施眼账号登录、金华学习阅读、点赞分享、抽奖滑块、积分查询、账号管理、收费续期、代理与青龙同步。]
// [author: 601712460]
// [version: v1.0.0]
// [rule: raw ^西施(登陆|登录|签到|管理|超管|配置)$|^xishifk$]
// [cron: 0 8 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/app_西施_v0_By.601712460.py]
// [depe: ["./tmuyunJinhuaRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createRuntime } = require("./tmuyunJinhuaRuntime");

const runtime = createRuntime({
  name: "西施",
  prefix: "vhook_xishiyan_",
  defaultEnvName: "XISHIYAN",
  tenantId: "34",
  clientId: "50",
  jinhuaAppId: "uhzfzpj5l78yq6di",
  jinhuaKey: "35c782a2",
  configChannelId: "5de768411b011b48a65b772f",
  configSize: 30,
  configMode: "focus",
  taskChannelId: "5de768411b011b48a65b772f",
  taskSize: 80,
  visitStudyArticles: false,
  localServiceTask: false,
  prizeMode: "title",
  adminRunCommand: "xishifk",
  jinhuaUa:
    "Mozilla/5.0 (Linux; Android 11; wv) AppleWebKit/537.36 Chrome/94.0.4606.85 Mobile Safari/537.36;xsb_zhuji;xsb_zhuji;1.3.2;native_app;6.10.0",
});

runtime.main().catch(async (error) => s.reply(`西施执行失败：${error?.message || error}`));

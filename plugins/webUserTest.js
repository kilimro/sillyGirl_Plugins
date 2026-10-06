// [title: 用户信息测试]
// [name: webUserTest]
// [desc: Web 用户中心测试插件：用户填写表单提交信息]
// [author: Mianpro官方]
// [version: v1.0.1]
// [status: true]
// [admin: false]
// [public: false]
// [web: true]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [depe: []]

const { user } = require("sillygirl");

// 用户表单：用户在 Web 端填写
user
  .Form({
    nickname: user.Form.string().title("昵称").description("你的昵称").default(""),
    phone: user.Form.string().title("手机号").description("11位手机号").default(""),
    birthday: user.Form.string().title("生日").description("如 1990-01-01").default(""),
    city: user.Form.string().title("城市").description("所在城市").default(""),
    vip: user.Form.boolean().title("VIP用户").default(false),
  })
  .multiple(5)
  .keyBy("nickname");

console.log("[用户信息测试] Web插件已加载");

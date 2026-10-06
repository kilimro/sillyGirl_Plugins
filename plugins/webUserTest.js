// [title: 用户信息测试]
// [name: webUserTest]
// [desc: Web 用户中心测试插件：用户填写表单提交信息]
// [author: Mianpro官方]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: false]
// [web: true]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [depe: []]

const { user, plugin, Bucket } = require("sillygirl");

// 用户表单：用户在 Web 端填写
user.Form({
  nickname: user.Form.string().title("昵称").description("你的昵称").default(""),
  phone: user.Form.string().title("手机号").description("11位手机号").pattern("^1\\d{10}$").default(""),
  birthday: user.Form.string().title("生日").description("如 1990-01-01").default(""),
  city: user.Form.string().title("城市").description("所在城市").default(""),
  vip: user.Form.boolean().title("VIP用户").default(false),
}).multiple(5).keyBy("nickname");

// 管理员配置
const config = new plugin.Form({
  welcome_msg: plugin.Form.string().title("欢迎语").default("欢迎使用用户中心测试插件"),
});

// 这个插件是 web 插件，不需要 main 函数处理消息
// 用户在 Web 端填写的表单数据会自动保存到 plugin_user_form_records
// 其他插件可以通过 Bucket 读取用户提交的数据

console.log("[用户信息测试] Web插件已加载");

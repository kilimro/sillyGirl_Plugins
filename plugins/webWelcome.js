// [title: 温馨提醒]
// [name: webWelcome]
// [desc: 欢迎使用MIANPRO多平台管理]
// [author: Mianpro官方]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: false]
// [web: true]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [depe: []]

const { user } = require("sillygirl");

// 占位表单：让插件出现在开放服务列表
user.Form({
  tip: user.Form.string().title("温馨提醒").default("欢迎使用MIANPRO多平台管理"),
});

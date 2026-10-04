// [title: 魔幻手机语录]
// [name: moHuanShouJiYuLu]
// [desc: 随机回复傻妞和陆小千相关短句]
// [author: sillyGirl]
// [version: v1.0.3]
// [rule: raw ^\s*(傻妞语录|傻妞台词|陆小千语录|小千语录|小千台词|魔幻手机语录|魔幻手机台词)\s*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 娱乐]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: 自定义]
// [depe: []]

const { sender: s } = require("sillygirl");

const LINES = [
  "傻妞为您服务。",
  "请进入真人模式。",
  "维护正义，也要讲究方法。",
  "小千，先想清楚再行动。",
  "能力越大，越要守住自己的选择。",
  "别急，时间还有转机。",
  "今天的任务，靠智慧完成。",
  "有些答案，要亲自走一遍才知道。",
  "真正的勇敢，是明知困难仍然向前。",
  "手机只是工具，决定方向的是人。",
];

s.reply(LINES[Math.floor(Math.random() * LINES.length)]);

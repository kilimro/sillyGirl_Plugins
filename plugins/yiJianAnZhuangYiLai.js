// [title: 一键安装依赖]
// [name: yiJianAnZhuangYiLai]
// [desc: 安装 backup 原插件声明的 Python 与 Node.js 公共依赖]
// [author: 601712460]
// [version: v1.0.0]
// [rule: ^一键安装依赖$]
// [status: false]
// [admin: true]
// [public: true]
// [priority: 6666666]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/一键安装依赖_v0_By.601712460.py]
// [depe: []]

const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { sender: s, plugin } = require("sillygirl");
const run = promisify(execFile);
const form = new plugin.Form({
  install_python: plugin.Form.boolean().title("安装 Python 依赖").default(true),
  install_node: plugin.Form.boolean().title("安装 Node.js 依赖").default(true),
  timeout_ms: plugin.Form.integer().title("单项安装超时毫秒").min(10000).max(600000).default(180000),
});
const PYTHON = ["colorlog", "js2py", "pycryptodome", "sseclient", "fake_useragent", "urllib3==1.25.11", "redis"];
const NODE = ["moment", "axios@0.27.2", "request", "md5", "jsencrypt"];

async function install(command, args, label, timeout) {
  try {
    await run(command, args, { timeout, windowsHide: true });
    return `${label}：安装成功`;
  } catch (error) {
    return `${label}：安装失败（${String(error?.stderr || error?.message || error)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 160)}）`;
  }
}
async function main() {
  if (!(await s.isAdmin())) return s.reply("仅管理员可执行依赖安装");
  const cfg = (await form.get()) || {},
    timeout = Number(cfg.timeout_ms) || 180000,
    out = [];
  await s.reply("开始安装依赖，请耐心等待");
  if (cfg.install_python !== false)
    for (const name of PYTHON) {
      const result = await install("python", ["-m", "pip", "install", name], `Python ${name}`, timeout);
      out.push(result);
      await s.reply(result);
    }
  if (cfg.install_node !== false)
    for (const name of NODE) {
      const result = await install("npm", ["install", name], `Node ${name}`, timeout);
      out.push(result);
      await s.reply(result);
    }
  return s.reply(`依赖安装结束：成功 ${out.filter((x) => x.includes("安装成功")).length}/${out.length}`);
}
main().catch((error) => s.reply(`依赖安装失败：${error.message}`));

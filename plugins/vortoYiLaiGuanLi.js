// [title: Vorto依赖管理]
// [name: vortoYiLaiGuanLi]
// [desc: 检查和初始化内置 vortoUtils.js 公共模块及支付、青龙配置]
// [author: rujingxianghai]
// [version: v3.6.0]
// [rule: ^(vorto|Vorto)(初始化|下载|更新|清理)$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/settings.svg]
// [origin: backup/【必装】Vorto插件依赖_v3.6_By.rujingxianghai.py]
// [depe: ["./vortoUtils.js"]]

const fs = require("node:fs");
const path = require("node:path");
const { sender: s, plugin } = require("sillygirl");
const config = new plugin.Form({
  qinglong: plugin.Form.string().title("青龙 Host丨ClientID丨ClientSecret").default(""),
  dumbpanel: plugin.Form.string().title("DumbPanel Host丨AppKey丨AppSecret").default(""),
  pay_gateway: plugin.Form.string().title("码支付网关").default(""),
  pay_pid: plugin.Form.string().title("码支付商户ID").default(""),
  pay_key: plugin.Form.string().title("码支付密钥").default(""),
});
async function main() {
  const content = String((await s.getMsg()) || ""),
    file = path.join(__dirname, "vortoUtils.js");
  if (/清理$/.test(content)) return s.reply("当前版本使用仓库内置 vortoUtils.js，没有 Python 旧模块需要清理");
  if (!fs.existsSync(file)) return s.reply(`缺少公共模块：${file}`);
  delete require.cache[require.resolve("./vortoUtils")];
  const api = require("./vortoUtils"),
    cfg = (await config.get()) || {};
  const functions = ["QingLongClient", "DumbPanelClient", "MaPayClient", "generateQrcodeUrl"].filter(
    (key) => typeof api[key] === "function",
  );
  return s.reply(
    [
      "Vorto JS 公共模块可用",
      `文件：${file}`,
      `导出能力：${functions.join("、")}`,
      `青龙配置：${cfg.qinglong ? "已填写" : "未填写"}`,
      `DumbPanel：${cfg.dumbpanel ? "已填写" : "未填写"}`,
      `码支付：${cfg.pay_gateway && cfg.pay_pid && cfg.pay_key ? "已填写" : "未填写"}`,
    ].join("\n"),
  );
}
main().catch((error) => s.reply(`Vorto依赖管理失败：${error.message}`));

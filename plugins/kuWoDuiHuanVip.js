// [title: 酷我兑换VIP]
// [name: kuWoDuiHuanVip]
// [desc: 酷我账号验证码登录并兑换1至5个月VIP]
// [author: sky2022]
// [version: v1.1.0]
// [rule: ^酷我兑换$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/酷我兑换VIP_v1.1_By.sky2022.py]
// [depe: ["./kuwoCore.js"]]

const { sender: s, plugin } = require("sillygirl");
const kuwo = require("./kuwoCore.js");

const form = new plugin.Form({
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
async function request(url, options = {}, cfg = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), cfg.timeout_ms || 15000),
    headers = { ...(options.headers || {}) };
  let body = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers["content-type"] ||= "application/json";
  }
  try {
    const response = await fetch(url, { method: options.method || "GET", headers, body, signal: controller.signal }),
      text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return { text };
  } finally {
    clearTimeout(timer);
  }
}
async function main() {
  try {
    const cfg = (await form.get()) || {};
    const ctx = {
      async requestJson(url, opt) {
        const r = await request(url, opt, cfg);
        try {
          return JSON.parse(r.text);
        } catch (_) {
          throw new Error(`接口返回非JSON：${r.text.slice(0, 160)}`);
        }
      },
    };
    const raw = await prompt("请输入手机号#密码", 120000);
    if (raw === null) return;
    const cut = raw.indexOf("#"),
      phone = raw.slice(0, cut).trim(),
      password = raw.slice(cut + 1);
    if (cut < 1 || !/^1[3-9]\d{9}$/.test(phone) || !password) throw new Error("格式应为11位手机号#密码");
    const countRaw = await prompt("请输入兑换次数(1-5)", 60000),
      count = Number(countRaw);
    if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("兑换次数必须是1-5");
    const session = await kuwo.login(ctx, phone, password),
      lines = [];
    for (let i = 0; i < count; i++) {
      const result = await kuwo.exchangeVip(ctx, session),
        description = result?.data?.description || result?.data?.text || result?.msg || JSON.stringify(result);
      lines.push(`${i + 1}. ${JSON.stringify(result).includes("成功") ? "兑换成功" : "兑换结果"}：${description}`);
      if (i + 1 < count) await new Promise((r) => setTimeout(r, 1000));
    }
    return s.reply(lines.join("\n"));
  } catch (error) {
    return s.reply(`酷我兑换VIP执行失败：${error?.message || error}`);
  }
}
async function prompt(text, timeout) {
  await s.reply(text);
  const child = await s.listen({ timeout });
  if (!child) return null;
  return String((await child.getMsg()) || "").trim();
}
main();

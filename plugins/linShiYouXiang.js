// [title: 临时邮箱]
// [name: linShiYouXiang]
// [desc: 创建 Mail.tm 临时邮箱并等待第一封来信]
// [author: sillyGirl]
// [version: v1.0.3]
// [rule: ^临时邮箱$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/临时邮箱_v1.0.0_By.yss.py]
// [depe: []]

const { randomBytes } = require("node:crypto");
const { plugin, sender: s } = require("sillygirl");

const API = "https://api.mail.tm";
const config = new plugin.Form({
  wait_seconds: plugin.Form.number().title("等待邮件秒数").default(120),
});

async function main() {
  const cfg = (await config.get()) || {};

  try {
    const domains = await request("/domains");
    const domain = domains?.["hydra:member"]?.find((item) => item?.isActive && !item?.isPrivate)?.domain;
    if (!domain) throw new Error("没有可用的公开邮箱域名");

    const address = `${randomText(10)}@${domain}`;
    const password = randomText(20);
    await request("/accounts", { method: "POST", body: { address, password } });
    const auth = await request("/token", { method: "POST", body: { address, password } });
    if (!auth?.token) throw new Error("邮箱令牌为空");

    await s.reply(`临时邮箱：${address}\n密码：${password}\n正在等待来信……\n服务：mail.tm`);
    const waitSeconds = clamp(Number(cfg.wait_seconds ?? 120), 10, 300);
    const summary = await waitForMessage(auth.token, waitSeconds);
    await s.reply(summary || `等待 ${waitSeconds} 秒仍未收到邮件，可重新发送“临时邮箱”创建新地址。`);
  } catch (error) {
    await s.reply(`临时邮箱创建失败：${message(error)}`);
  }
}

async function waitForMessage(token, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const list = await request("/messages", { token });
    const item = list?.["hydra:member"]?.[0];
    if (item?.id) {
      const mail = await request(`/messages/${encodeURIComponent(item.id)}`, { token });
      const body = clean(mail?.text || stripHtml(mail?.html?.join("\n") || "") || item.intro || "（无正文）");
      return [
        "收到新邮件",
        `发件人：${mail?.from?.address || item?.from?.address || "未知"}`,
        `主题：${mail?.subject || item?.subject || "（无主题）"}`,
        `正文：${body.slice(0, 1500)}`,
      ].join("\n");
    }
    await sleep(5000);
  }
  return "";
}

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.message || `HTTP ${response.status}`);
  return data;
}

function randomText(length) {
  return randomBytes(Math.ceil(length * 0.75))
    .toString("base64url")
    .slice(0, length)
    .toLowerCase();
}

function stripHtml(value) {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function clean(value) {
  return String(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function message(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();

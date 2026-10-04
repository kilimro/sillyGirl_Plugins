// [title: IP变动通知]
// [name: ipChange]
// [desc: 查询公网 IP，并在定时检查发现变化时通知管理员]
// [author: smallfawn]
// [version: v1.1.1]
// [rule: ^(IP|IP查询|ip)$]
// [cron: */5 * * * *]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: smallfawn/Bncr_Plugins]
// [depe: []]

const { sender: s, Bucket, plugin } = require("sillygirl");

const config = new plugin.Form({
  endpoint: plugin.Form.string().title("公网 IP 接口").default("https://api64.ipify.org"),
});
const store = new Bucket("ipChange");

async function getIP(endpoint) {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`IP 接口 HTTP ${response.status}`);
  const ip = (await response.text()).trim();
  if (!ip) throw new Error("IP 接口返回为空");
  return ip;
}

async function main() {
  const { endpoint } = await config.get();
  const ip = await getIP(endpoint || "https://api64.ipify.org");
  const oldIP = await store.get("last_ip", "");
  const changed = Boolean(oldIP && oldIP !== ip);
  if (oldIP !== ip) await store.set("last_ip", ip);

  const command = String(await s.getMsg().catch(() => "")).trim();
  if (command) {
    await s.reply(changed ? `IP 已变动：${oldIP} -> ${ip}` : `当前 IP：${ip}`);
  } else if (changed) {
    await s.pushAdmin(`IP 已变动：${oldIP} -> ${ip}`);
  }
}

main().catch((error) => s.reply(`IP 查询失败：${error.message}`));

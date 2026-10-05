// [title: 快递查询]
// [name: kuaidiChaXun]
// [desc: 发"查快递773443987038423"查快递物流，自动识别快递公司]
// [author: Mianpro官方]
// [version: v1.0.1]
// [rule: ^查快递(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://cdn.kuaidi100.com/images/openApiWeb/common/favicon.ico]
// [origin: 自定义]
// [depe: []]

const { sender: s, plugin } = require("sillygirl");

const form = new plugin.Form({
  api_key: plugin.Form.string().title("API Key (id)").default("").required(),
});

async function main() {
  const cfg = (await form.get()) || {};
  if (!String(cfg.api_key || "").trim()) return;

  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(/^查快递(.+)$/);
  if (!m) return;
  const nu = m[1].trim();
  if (!nu) return;

  try {
    const url = `https://api.kuaidi.com/openapi.html?id=${cfg.api_key}&nu=${encodeURIComponent(nu)}&show=0&muti=1&order=desc`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return s.reply(`查询失败 HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.data) || !data.data.length) {
      return s.reply(data?.reason || "未查到物流信息，请确认单号是否正确");
    }
    const lines = data.data.map((item) => `${item.time}\n  ${item.context}`);
    await s.reply(`快递 ${nu} 物流：\n\n${lines.join("\n\n")}`);
  } catch (error) {
    await s.reply(`快递查询失败：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`快递查询异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

// [title: 火车票查询]
// [name: huoChePiao]
// [desc: 查12306余票。发"火车票北京到南京"或"火车票北京到南京 10月8日"查询，日期可选，默认今天。]
// [author: kilimro]
// [version: v1.0.0]
// [rule: ^火车票(.+?)\s*(?:到|->|—)\s*(.+?)(?:\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}/\d{1,2}))?$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://www.12306.cn/index/images/favicon.ico]
// [origin: 自定义]
// [depe: []]

const { sender: s, plugin } = require("sillygirl");

const form = new plugin.Form({
  apikey: plugin.Form.string().title("API Key").default("").required(),
  max_results: plugin.Form.integer()
    .title("最多显示车次")
    .description("结果太多时只显示前N趟，默认15")
    .min(5)
    .max(50)
    .default(15),
});

function parseDate(input) {
  if (!input) return null;
  input = input.trim();
  const now = new Date();
  const year = now.getFullYear();
  let m = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = input.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (m) return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

async function main() {
  const cfg = (await form.get()) || {};
  if (!String(cfg.apikey || "").trim()) return;

  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(
    /^火车票(.+?)\s*(?:到|->|—)\s*(.+?)(?:\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}))?$/,
  );
  if (!m) return;

  const go = m[1].trim();
  const to = m[2].trim();
  const date = parseDate(m[3]) || new Date().toISOString().slice(0, 10);

  const url = `https://api.key5.site/API/12306/huoche/index.php?go=${encodeURIComponent(go)}&to=${encodeURIComponent(to)}&date=${date}&apikey=${cfg.apikey}`;
  const res = await fetch(url, {
    headers: { "user-agent": "PostmanRuntime/1.1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return s.reply(`查询失败 HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 1 || !Array.isArray(data.list) || !data.list.length) {
    return s.reply(`${go} → ${to} 没有查到车次`);
  }

  const lines = [`🚄 ${data.go} → ${data.to}（${data.date}）`, ""];
  const limit = Number(cfg.max_results) || 15;
  for (const train of data.list.slice(0, limit)) {
    const prices = (train.prices || []).map((p) => `${p.name}${p.status === "有" ? "✓" : "⚠"}¥${p.price}`).join(" ");
    lines.push(
      `${train.TrainNumber} ${train.Depart}→${train.Dest} ${train.DepartTime}-${train.DestTime} ${train.TotalTime}\n  ${prices}`,
    );
  }
  if (data.list.length > limit) lines.push(`\n…还有 ${data.list.length - limit} 趟未显示`);

  await s.reply(lines.join("\n"));
}

main().catch(async (error) => {
  try {
    await s.reply(`火车票查询异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});

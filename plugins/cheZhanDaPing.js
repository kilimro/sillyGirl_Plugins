// [title: 车站大屏]
// [name: cheZhanDaPing]
// [desc: 查车站发车大屏。发"大屏北京"查看北京站实时发车信息。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: ^大屏(.+)$]
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
  max_results: plugin.Form.integer().title("最多显示车次").min(5).max(50).default(20),
});

async function main() {
  const cfg = (await form.get()) || {};
  if (!String(cfg.apikey || "").trim()) return;

  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(/^大屏(.+)$/);
  if (!m) return;
  const city = m[1].trim();
  if (!city) return;

  const url = `https://api.key5.site/API/12306/index.php?city=${encodeURIComponent(city)}&apikey=${cfg.apikey}`;
  const res = await fetch(url, {
    headers: { "user-agent": "PostmanRuntime/1.1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return s.reply(`查询失败 HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200 || !data?.data?.data?.length) {
    return s.reply(`${city} 没有查到发车信息`);
  }

  const rows = data.data.data;
  const fetchTime = data.data.fetch_time?.slice(11, 16) || "";
  const lines = [`车站大屏 ${data.data.station}（更新于 ${fetchTime}）`, ""];
  const limit = Number(cfg.max_results) || 20;
  for (const row of rows.slice(0, limit)) {
    const [train, from, to, time, gate, status] = row;
    lines.push(`${train.padEnd(7)} ${time.slice(11, 16)}  ${from}→${to}  ${gate}  ${status}`);
  }
  if (rows.length > limit) lines.push(`\n…还有 ${rows.length - limit} 趟未显示`);

  await s.reply(lines.join("\n"));
}

main().catch(async (error) => {
  try {
    await s.reply(`车站大屏异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});
